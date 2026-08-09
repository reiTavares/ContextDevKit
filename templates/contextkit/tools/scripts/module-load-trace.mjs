#!/usr/bin/env node
/**
 * Dynamic module-load trace and v4 legacy fence.
 *
 * The file doubles as a Node ESM loader and a small driver. The driver starts a
 * fresh process per lifecycle scenario; the loader records repository-local
 * modules only. No symlink is followed and every output path is root-contained.
 */
import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildLegacyInventory, normalizeRelativePath, resolveContainedPath } from './legacy-inventory.mjs';

const DEFAULT_SCENARIOS = Object.freeze([
  ['boot', 'templates/contextkit/runtime/hooks/governance-session-context.mjs'],
  ['no-op', 'templates/contextkit/runtime/hooks/governance-prompt-preflight.mjs'],
  ['direct', 'templates/contextkit/runtime/hooks/governance-write-preflight.mjs'],
  ['batch', 'templates/contextkit/runtime/hooks/governance-write-preflight.mjs'],
  ['workflow', 'templates/contextkit/runtime/hooks/governance-write-preflight.mjs'],
  ['completion', 'templates/contextkit/runtime/hooks/governance-completion.mjs'],
]);

const SCENARIO_INPUTS = Object.freeze({
  boot: { hook_event_name: 'SessionStart', session_id: 'trace-boot' },
  'no-op': { hook_event_name: 'UserPromptSubmit', session_id: 'trace-no-op', prompt: 'Explain how intake works without changing files.' },
  direct: { hook_event_name: 'PreToolUse', session_id: 'trace-direct', tool_name: 'Write', tool_input: { file_path: 'src/direct.txt' }, prompt: 'Correct one typo.' },
  batch: { hook_event_name: 'PreToolUse', session_id: 'trace-batch', tool_name: 'Write', tool_input: { file_path: 'src/batch.txt' }, prompt: 'Update five independent texts.' },
  workflow: { hook_event_name: 'PreToolUse', session_id: 'trace-workflow', tool_name: 'Write', tool_input: { file_path: 'src/workflow.txt' }, prompt: 'Migrate the task store with cutover and rollback.' },
  completion: { hook_event_name: 'Stop', session_id: 'trace-completion' },
});

/** Node loader hook. @param {string} specifier @param {object} context @param {Function} nextResolve */
export async function resolveHook(specifier, context, nextResolve) {
  return nextResolve(specifier, context);
}

/** Node loader hook. @param {string} url @param {object} context @param {Function} nextLoad */
export async function loadHook(url, context, nextLoad) {
  const loaded = await nextLoad(url, context);
  const traceRoot = process.env.CONTEXTKIT_TRACE_ROOT;
  const traceFile = process.env.CONTEXTKIT_TRACE_FILE;
  if (traceRoot && traceFile && url.startsWith('file:')) {
    try {
      const absoluteRoot = resolve(traceRoot);
      const absoluteTemporaryRoot = resolve(tmpdir());
      const safeTraceFile = resolveContainedPath(
        absoluteTemporaryRoot,
        normalizeRelativePath(relative(absoluteTemporaryRoot, resolve(traceFile))),
      );
      if (safeTraceFile !== resolve(traceFile)) return loaded;
      const absoluteModule = fileURLToPath(url);
      const boundary = `${absoluteRoot}${sep}`;
      if (absoluteModule === absoluteRoot || absoluteModule.startsWith(boundary)) {
        const stat = lstatSync(absoluteModule);
        const path = normalizeRelativePath(relative(absoluteRoot, absoluteModule));
        appendFileSync(safeTraceFile, `${stat.isSymbolicLink() ? 'SYMLINK:' : ''}${path}\n`, 'utf8');
      }
    } catch {
      // Trace diagnostics must never change the behavior of the traced process.
    }
  }
  return loaded;
}

// Node expects these exact hook names when this file is used with --experimental-loader.
export { resolveHook as resolve, loadHook as load };

/** @param {string} value @returns {[string,string]} */
export function parseScenario(value) {
  const separator = value.indexOf('=');
  if (separator < 1 || separator === value.length - 1) throw new Error(`scenario must be name=relative-entrypoint: ${value}`);
  return [value.slice(0, separator), value.slice(separator + 1)];
}

/**
 * Traces lifecycle entrypoints and refuses any loaded legacy implementation.
 * @param {{root:string, scenarios?:Array<[string,string]>, legacyPaths?:string[], timeoutMs?:number}} options
 * @returns {object}
 */
export function traceModuleLoads({ root, scenarios = DEFAULT_SCENARIOS, legacyPaths, timeoutMs = 5_000 }) {
  const absoluteRoot = resolve(root);
  const inventory = legacyPaths ? null : buildLegacyInventory({ root: absoluteRoot });
  const blockedPaths = new Set(legacyPaths ?? inventory.items.filter((item) => item.releaseBlocking && /\.(?:cjs|js|mjs)$/.test(item.path)).map((item) => item.path));
  const traceDirectory = mkdtempSync(resolve(tmpdir(), 'contextdevkit-v4-load-trace-'));
  const results = [];
  try {
    for (const [name, rawEntrypoint] of scenarios) {
      const entrypoint = normalizeRelativePath(rawEntrypoint);
      let absoluteEntrypoint;
      try { absoluteEntrypoint = resolveContainedPath(absoluteRoot, entrypoint); }
      catch (error) { results.push({ name, entrypoint, status: 'refuse', error: error.message, loaded: [], legacyLoaded: [] }); continue; }
      if (!existsSync(absoluteEntrypoint) || lstatSync(absoluteEntrypoint).isSymbolicLink()) {
        results.push({ name, entrypoint, status: 'refuse', error: 'missing or symbolic-link entrypoint', loaded: [], legacyLoaded: [] });
        continue;
      }
      const traceFile = resolve(traceDirectory, `${results.length}-${name.replace(/[^a-z0-9-]/gi, '_')}.txt`);
      const scenarioDirectory = resolve(traceDirectory, `${results.length}-cwd`);
      mkdirSync(scenarioDirectory);
      writeFileSync(traceFile, '', 'utf8');
      const execution = spawnSync(process.execPath, [
        '--no-warnings',
        '--experimental-loader', import.meta.url,
        absoluteEntrypoint,
      ], {
        cwd: scenarioDirectory,
        encoding: 'utf8',
        env: { ...process.env, CONTEXTKIT_TRACE_ROOT: absoluteRoot, CONTEXTKIT_TRACE_FILE: traceFile, CONTEXTKIT_TRACE_SCENARIO: name },
        input: `${JSON.stringify(SCENARIO_INPUTS[name] ?? { contextdevkitTrace: true, scenario: name })}\n`,
        timeout: timeoutMs,
        windowsHide: true,
      });
      const rawLoads = readFileSync(traceFile, 'utf8').split(/\r?\n/).filter(Boolean);
      const symlinks = rawLoads.filter((path) => path.startsWith('SYMLINK:')).map((path) => path.slice(8));
      const loaded = [...new Set(rawLoads.map((path) => path.replace(/^SYMLINK:/, '')))].sort();
      const legacyLoaded = loaded.filter((path) => blockedPaths.has(path));
      const error = execution.error?.message ?? (execution.status !== 0 ? `entrypoint exited ${execution.status}: ${(execution.stderr || execution.stdout).trim().slice(0, 500)}` : null);
      results.push({
        name,
        entrypoint,
        status: !error && !symlinks.length && !legacyLoaded.length ? 'pass' : 'refuse',
        error,
        loaded,
        legacyLoaded,
        symlinks,
        elapsedSignal: execution.signal ?? null,
      });
    }
  } finally {
    rmSync(traceDirectory, { recursive: true, force: true });
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    timeoutMs,
    scenarioCount: results.length,
    scenarios: results,
    verdict: results.length === scenarios.length && results.every((item) => item.status === 'pass') ? 'pass' : 'refuse',
  };
}

/** @param {object} report @returns {string} */
export function renderModuleLoadMarkdown(report) {
  const lines = [
    '# ContextDevKit 4 module-load trace', '',
    `Verdict: **${report.verdict.toUpperCase()}**`, '',
    '| Scenario | Entrypoint | Loaded | Legacy loaded | Status |',
    '| --- | --- | ---: | ---: | --- |',
  ];
  for (const scenario of report.scenarios) {
    lines.push(`| ${scenario.name} | \`${scenario.entrypoint}\` | ${scenario.loaded.length} | ${scenario.legacyLoaded.length} | ${scenario.status} |`);
    if (scenario.error) lines.push('', `- ${scenario.name}: ${scenario.error}`, '');
    for (const path of scenario.legacyLoaded) lines.push(`- ${scenario.name} loaded legacy \`${path}\``);
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/** @returns {Record<string,unknown>} */
function parseArgs(argv) {
  const args = { root: '.', scenarios: [], check: false, timeoutMs: 5_000 };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--root') args.root = argv[++index];
    else if (token === '--scenario') args.scenarios.push(parseScenario(argv[++index]));
    else if (token === '--timeout-ms') args.timeoutMs = Number(argv[++index]);
    else if (token === '--json-out') args.jsonOut = argv[++index];
    else if (token === '--markdown-out') args.markdownOut = argv[++index];
    else if (token === '--check') args.check = true;
    else throw new Error(`unknown argument: ${token}`);
  }
  if (!Number.isInteger(args.timeoutMs) || args.timeoutMs < 100 || args.timeoutMs > 60_000) throw new Error('--timeout-ms must be an integer from 100 to 60000');
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(String(args.root));
  const scenarios = args.scenarios.length ? args.scenarios : DEFAULT_SCENARIOS;
  const report = traceModuleLoads({ root, scenarios, timeoutMs: args.timeoutMs });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = renderModuleLoadMarkdown(report);
  if (args.jsonOut) writeFileSync(resolveContainedPath(root, String(args.jsonOut)), json, 'utf8');
  if (args.markdownOut) writeFileSync(resolveContainedPath(root, String(args.markdownOut)), markdown, 'utf8');
  if (!args.jsonOut && !args.markdownOut) process.stdout.write(json);
  if (args.check && report.verdict !== 'pass') process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`module-load-trace: ${error.message}`); process.exitCode = 2; }
}
