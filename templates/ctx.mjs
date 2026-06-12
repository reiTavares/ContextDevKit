#!/usr/bin/env node
/**
 * ContextDevKit central CLI runner for Antigravity.
 *
 * Routes commands to scripts in contextkit/tools/scripts/ (exact name or
 * declared alias only — never a prefix guess), prints pure-prompt slash
 * commands, and suggests the closest commands on a miss. The categorised
 * menu lives in contextkit/runtime/antigravity/ctx-menu.mjs (engine); this
 * file stays a thin dispatcher and degrades to a minimal usage text when
 * the engine is absent.
 *
 * Trust model: like npm scripts or git hooks, this runner executes code from
 * the CURRENT project (contextkit/tools/scripts under cwd). Only run it inside
 * a project you trust.
 *
 * Usage:
 *   node ctx.mjs <command> [...args]
 *   node ctx.mjs help [command]
 */
import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, join, basename, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const SCRIPTS_DIR = resolve(ROOT, 'contextkit/tools/scripts');
const ENTRYPOINT = basename(process.argv[1] || 'ctx.mjs').toLowerCase();
const IS_CODEX = ENTRYPOINT.startsWith('cdx');
const HOST_LABEL = IS_CODEX ? 'Codex' : 'Antigravity';
const RUNNER_FILE = IS_CODEX ? 'cdx.mjs' : 'ctx.mjs';

// Helper aliases for quick commands
const ALIASES = {
  'level': 'context-level.mjs',
  'config': 'context-config.mjs',
  'pack': 'context-pack.mjs',
  'tech-debt': 'tech-debt-scan.mjs',
  'ia-practices': 'analyze-code-ia-practices.mjs',
  'seo': 'seo-audit.mjs',
  'aiso': 'aiso-audit.mjs',
  'validation': 'validate-doc.mjs',
  'assist': 'workflow-assist.mjs'
};

/** Loads the categorised menu module from the installed engine; null when absent. */
async function loadMenu() {
  try {
    return await import(pathToFileURL(resolve(ROOT, 'contextkit/runtime/antigravity/ctx-menu.mjs')).href);
  } catch {
    return null;
  }
}

/** Minimal help when the engine (and so the categorised menu) is not installed. */
function printFallbackHelp(scriptNames) {
  console.log(`\n🛡️  ContextDevKit Command Runner (${HOST_LABEL})\n`);
  console.log(`Usage: node ${RUNNER_FILE} <command> [...args] | node ${RUNNER_FILE} help [command]\n`);
  if (scriptNames.length) console.log(`Available scripts:\n  ${scriptNames.join(', ')}\n`);
  else console.log('No contextkit/tools/scripts directory found — run the installer first.\n');
}

async function listScriptNames() {
  try {
    return (await readdir(SCRIPTS_DIR)).filter(f => f.endsWith('.mjs')).map(f => basename(f, '.mjs'));
  } catch {
    return [];
  }
}

/**
 * Resolves the command argument to a script path — exact name or declared alias
 * ONLY. There is deliberately no prefix fallback: `agy tech` silently running
 * `tech-debt-scan.mjs` is a wrong-script hazard (ticket 089); a near-miss should
 * fail loudly and suggest, never guess. The resolved path is confined to
 * SCRIPTS_DIR (defense-in-depth, ticket 090).
 *
 * @param {string} cmd  user command input
 * @returns {Promise<string | null>} absolute path to script if found, or null
 */
async function findScript(cmd) {
  try {
    const mjsFiles = (await readdir(SCRIPTS_DIR)).filter(f => f.endsWith('.mjs'));
    const cleanCmd = cmd.toLowerCase().replace(/\.mjs$/, '');

    const exact = mjsFiles.find(f => basename(f, '.mjs').toLowerCase() === cleanCmd);
    const aliasTarget = !exact && ALIASES[cleanCmd] && mjsFiles.includes(ALIASES[cleanCmd]) ? ALIASES[cleanCmd] : null;
    const file = exact || aliasTarget;
    if (!file) return null;

    const resolved = resolve(SCRIPTS_DIR, file);
    return resolved.startsWith(SCRIPTS_DIR + sep) ? resolved : null;
  } catch {
    return null;
  }
}

/** Classic Levenshtein edit distance (small inputs — command names). */
function editDistance(a, b) {
  const rows = a.length + 1, cols = b.length + 1;
  const dist = Array.from({ length: rows }, (_, i) => [i, ...Array(cols - 1).fill(0)]);
  for (let j = 1; j < cols; j++) dist[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      dist[i][j] = Math.min(
        dist[i - 1][j] + 1,
        dist[i][j - 1] + 1,
        dist[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dist[rows - 1][cols - 1];
}

/**
 * Returns up to 3 known commands closest to the input (ticket 096): substring
 * matches first, then edit distance ≤ half the input length.
 */
function suggestClosest(input, knownNames) {
  const needle = input.toLowerCase();
  const scored = knownNames.map((name) => ({
    name,
    score: name.includes(needle) ? 0 : editDistance(needle, name.toLowerCase()),
  }));
  return scored
    .filter(({ score }) => score <= Math.max(2, Math.floor(needle.length / 2)))
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map(({ name }) => name);
}

/** `help <command>`: description from the menu registry + how to invoke it. */
async function printCommandHelp(cmd) {
  const menu = await loadMenu();
  const clean = cmd.toLowerCase().replace(/\.mjs$/, '');
  const described = menu?.describeCommand?.(clean) ?? null;
  const scriptPath = await findScript(clean);
  if (!described && !scriptPath) return false;
  console.log(`\n📖 ${clean}`);
  if (described) console.log(`   ${described.description}\n   Category: ${described.category.trim()}`);
  if (ALIASES[clean]) console.log(`   Alias of: ${ALIASES[clean]}`);
  console.log(`   Run: node ${RUNNER_FILE} ${clean} [...args]\n`);
  return true;
}

async function walkDir(dir, filterFn) {
  let results = [];
  try {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const res = join(dir, entry.name);
      if (entry.isDirectory()) results.push(...(await walkDir(res, filterFn)));
      else if (filterFn(res)) results.push(res);
    }
  } catch {}
  return results;
}

/**
 * Resolves a pure-prompt command to its markdown file. This runner is the
 * AGY host, so the agy-adapted tree (.agents/skills — TodoWrite/delegate-to
 * references already converted) wins over the raw Claude source; .claude/
 * remains the fallback for custom commands the user never converted
 * (ticket 142). The templates/* pair mirrors that order for kit-dev.
 */
async function findCommandMd(cmd) {
  const cleanCmd = cmd.toLowerCase().replace(/\.md$/, '');
  const filter = (p) => basename(p, '.md').toLowerCase() === cleanCmd;
  const match = (await walkDir(resolve(ROOT, '.agents/skills'), filter))[0]
    || (await walkDir(resolve(ROOT, '.claude/commands'), filter))[0]
    || (await walkDir(resolve(ROOT, 'templates/antigravity/skills'), filter))[0]
    || (await walkDir(resolve(ROOT, 'templates/claude/commands'), filter))[0];
  return match || null;
}

function printMarkdownCommand(filePath, fileContent, args = []) {
  const replacement = args.join(' ') || '[no argument provided]';
  // Function replacement: a plain string would interpret $&, $`, $' as
  // JS replacement patterns and mangle the output (ticket 141).
  let content = fileContent
    .replace(/\$ARGUMENTS/g, () => replacement)
    .replace(/<user-specified argument>/g, () => replacement);
  let fm = '';
  if (content.startsWith('---')) {
    const parts = content.split('---');
    if (parts.length >= 3) {
      fm = parts[1].trim();
      content = parts.slice(2).join('---').trim();
    }
  }
  console.log(`\n==================================================\n📖 Slash Command: /${basename(filePath, '.md')}\n==================================================`);
  if (fm) console.log(`\n\x1b[36mMetadata:\x1b[0m\n${fm.split('\n').map(l => '  ' + l).join('\n')}`);
  console.log(`\n\x1b[32mInstructions:\x1b[0m\n${content}\n==================================================\n`);
}

async function printMenu() {
  const names = await listScriptNames();
  const menu = await loadMenu();
  if (menu?.printHelp) menu.printHelp(names.map(n => n + '.mjs'), { hostLabel: HOST_LABEL, runnerFile: RUNNER_FILE });
  else printFallbackHelp(names);
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === '--help' || cmd === '-h') {
    await printMenu();
    process.exit(0);
  }

  // `help` with no argument shows the menu; `help <command>` shows one entry (096).
  if (cmd === 'help') {
    if (!args[1]) {
      await printMenu();
      process.exit(0);
    }
    if (await printCommandHelp(args[1])) process.exit(0);
    console.error(`\n❌ Unknown command: "${args[1]}"`);
    const tips = suggestClosest(args[1], [...await listScriptNames(), ...Object.keys(ALIASES)]);
    if (tips.length) console.error(`   Did you mean: ${tips.join(', ')}?\n`);
    process.exit(1);
  }

  if (cmd === 'session') {
    const sessionManagerPath = resolve(ROOT, 'context' + 'kit/runtime/antigravity/session-manager.mjs');
    const child = spawn('node', [sessionManagerPath, ...args.slice(1)], { cwd: ROOT, stdio: 'inherit' });
    child.on('exit', (code) => process.exit(code ?? 0));
    return;
  }

  const scriptPath = await findScript(cmd);
  if (scriptPath) {
    const child = spawn('node', [scriptPath, ...args.slice(1)], { cwd: ROOT, stdio: 'inherit' });
    child.on('exit', (code) => process.exit(code ?? 0));
    return;
  }

  const cmdMdPath = await findCommandMd(cmd);
  if (cmdMdPath) {
    try {
      printMarkdownCommand(cmdMdPath, await readFile(cmdMdPath, 'utf8'), args.slice(1));
      process.exit(0);
    } catch (err) {
      console.error(`❌ Error reading command file: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  // Unknown command: suggest the closest 3 instead of dumping the full menu (096).
  console.error(`\n❌ Unknown command: "${cmd}"`);
  const tips = suggestClosest(cmd, [...await listScriptNames(), ...Object.keys(ALIASES)]);
  if (tips.length) console.error(`   Did you mean: ${tips.join(', ')}?`);
  console.error(`   Run \`node ${RUNNER_FILE} help\` for the full menu.\n`);
  process.exit(1);
}

main().catch(err => {
  console.error('❌ Runner error:', err);
  process.exit(1);
});
