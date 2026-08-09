#!/usr/bin/env node
/**
 * ContextDevKit 4 legacy inventory.
 *
 * This scanner is deliberately data-driven and read-only. It records every file
 * matching a retired 3.x contract plus every current consumer. It never follows
 * symbolic links and never deletes a candidate: physical removal remains a
 * separate, evidence-gated release action.
 */
import { lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const BINARY_EXTENSIONS = new Set(['.gif', '.gz', '.ico', '.jpeg', '.jpg', '.pdf', '.png', '.tgz', '.wasm', '.zip']);
const INVENTORY_KINDS = ['runtime', 'test', 'fixture', 'template', 'projection', 'doc', 'memory', 'update-snapshot', 'config', 'command'];
const DEFAULT_SCAN_ROOTS = [
  '.github', '.npmignore', 'ACKNOWLEDGEMENTS.md', 'CHANGELOG.md', 'CONTRIBUTING.md',
  'README.md', 'SECURITY.md', 'docs', 'install.mjs', 'instrucoes.md', 'package.json',
  'templates', 'tools',
];

export const LEGACY_RULES = Object.freeze([
  {
    id: 'physical-pipeline-lanes',
    path: /(?:^|\/)contextkit\/pipeline\/(?:backlog|working|testing|conclusion)(?:\/|$)/,
    text: /contextkit[\\/]pipeline[\\/](?:backlog|working|testing|conclusion)|\b(?:backlog|working|testing|conclusion)\/(?:[^\s`'"/]+\.md)/,
    replacedBy: 'workflow-state.json + pipeline/tasks.json',
    reason: 'Physical lane placement is not a v4 state authority.',
  },
  {
    id: 'workflow-plan-fallback',
    path: /workflow-plan\.json$/,
    text: /workflow-plan\.json/,
    replacedBy: 'workflow.json',
    reason: 'Normal runtime may not read workflow-plan.json after v4 cutover.',
  },
  {
    id: 'workflow-v1-finalization',
    path: /(?:^|\/)tools\/scripts\/(?:workflow\.mjs|workflow\/(?:commands|finalization|invariant-guard|invariants|state)\.mjs)$/,
    text: /--adopt-plan-hash|--expected-journal-seq|\bdone-move\b|finalizationEvent\(|expectedPlanHash/,
    replacedBy: 'v4 workflow-state writer; v1 reader only in explicit v3-to-v4 migration',
    reason: 'Workflow v1 conclude/finalization flags and journal/hash authority are migration-only after cutover.',
  },
  {
    id: 'done-sweep-runtime',
    path: /(?:workflow-)?done-sweep(?:\.selftest)?\.mjs$|workflow-conclusion-sweep(?:\.selftest)?\.mjs$/,
    text: /done-sweep\.mjs|workflow-done-sweep\.mjs|autoMoveDoneWorkflows|file(?:s|d)?[^\n]{0,80}workflow[^\n]{0,80}done\//i,
    replacedBy: 'workflow-state.json status transition',
    reason: 'A v4 workflow never changes path because its status changed.',
  },
  {
    id: 'lane-task-reader-writer',
    path: /(?:pipeline-(?:add|board|session|tasks|transitions)|pipeline)\.mjs$/,
    text: /autoAdvanceSessionTasks|listTasks\(pathsFor\([^)]*\)\.pipeline|migrateStateLayout\(|STAGES\s*=\s*\{[^}]*conclusion/s,
    replacedBy: 'canonical v4 task store and transactional writer',
    reason: 'Lane readers, writers, and automatic task advancement are executable 3.x authority.',
  },
  {
    id: 'legacy-hook-chain',
    path: /(?:execution-contract-hook|execution-gate|completion-gate|journey-gate|simulate-gate|deliberation-nudge|domain-code-gate|subagent-gate|graph-first-gate|arch-debt-law-gate|codex-hooks-compose|settings-compose|agent-hooks-compose)\.mjs$/,
    text: /execution-contract-hook\.mjs|execution-gate\.mjs|completion-gate\.mjs|journey-gate\.mjs|simulate-gate\.mjs|deliberation-nudge\.mjs|domain-code-gate\.mjs|subagent-gate\.mjs|graph-first-gate\.mjs|arch-debt-law-gate\.mjs/,
    replacedBy: 'governance prompt/write/postflight/completion dispatchers',
    reason: 'The v4 host contract permits one dispatcher process per lifecycle event.',
  },
  {
    id: 'legacy-host-ledger-marker',
    path: /(?:^|\/)runtime\/hooks\/(?:host-adapter|ledger)\.mjs$/,
    text: /from ['"]\.\/ledger\.mjs['"]|(?:CODEX|GROK|AGY)_SESSION_MARKER|\.codex-active\.json|\.grok-active\.json|\.agy-active\.json/,
    replacedBy: 'governance-host-io.mjs pure host boundary',
    reason: 'The 3.x host adapter imports the ledger and reads or writes SessionStart marker state.',
  },
  {
    id: 'mandatory-routing-or-autonomy',
    path: /(?:agent-orchestration-guard|resolve-autonomy|autonomy-readiness|subagent-profile|model-policy)\.mjs$/,
    text: /requiredAgentsDispatched|routingMode\s*[:=]\s*['"]active|Grade [1-4]|resolveAutonomy\(|decision\s*[:=]\s*['"]dispatch/,
    replacedBy: 'advisory routing and risk acknowledgement',
    reason: 'Agent receipts and autonomy grades are not v4 execution prerequisites.',
  },
  {
    id: 'legacy-orchestration-autonomy-decision',
    path: /(?:^|\/)(?:runtime\/execution\/(?:intake-methodology|request-orchestrator)|mcp-server\/tools\.write-gate)\.mjs$/,
    text: /DOWNGRADE\s*=|resolve-failed-fail-safe|must convene automatically|resolver-error-fail-closed|resolved\.mode === ['"]manual/,
    replacedBy: 'mutation-only intake, advisory routing, and owner-wins v4 write boundary',
    reason: 'Autonomy downgrade, mandatory council selection, and resolver-error manual denial are retired v3 execution decisions.',
  },
  {
    id: 'lgpd-required-agent-escalation',
    path: /(?:^|\/)policy\/complexity-rubric(?:\.json|\.mjs)$/,
    text: /privacy-lgpd[\s\S]{0,240}(?:requiredAgents|floorAgents|beforeWrite|beforeCompletion)|(?:requiredAgents|floorAgents)[\s\S]{0,240}privacy-lgpd/,
    replacedBy: 'privacy-lgpd shadow-only advisory policy',
    reason: 'LGPD agent selection may report risk but cannot become a required dispatch or blocking gate.',
  },
  {
    id: 'legacy-selfcheck-contract',
    path: /(?:b4-legacy-coexistence|integration-test-workflow-governance|selfcheck-graph-first|selfcheck-source-cases-recent|tasks-validate\.selftest)(?:\.selftest)?\.mjs$/,
    text: /Stop hook auto-advances session tasks|pipeline-session auto-advances owned working tasks|b4-legacy-coexistence|graph-first[^\n]{0,120}(?:deny|block)|tasks-validate\.selftest\.mjs|integration-test-workflow-governance\.mjs/i,
    replacedBy: 'v4 acceptance and release-fence tests',
    reason: 'The test crystallizes an executable contract that v4 retires, including graph-first denial of ordinary search fallback.',
  },
]);

/** @param {string} value @returns {string} */
export function normalizeRelativePath(value) {
  return value.split(sep).join('/').replace(/^\.\//, '');
}

/**
 * Resolves a repository-relative path and refuses traversal.
 * @param {string} root
 * @param {string} requestedPath
 * @returns {string}
 * @throws {Error} when the path escapes root
 */
export function resolveContainedPath(root, requestedPath) {
  if (typeof requestedPath !== 'string' || requestedPath.includes('\0')) throw new Error('path must be a non-NUL string');
  if (isAbsolute(requestedPath)) throw new Error(`absolute path is not allowed: ${requestedPath}`);
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(absoluteRoot, requestedPath);
  const boundary = `${absoluteRoot}${sep}`;
  if (absolutePath !== absoluteRoot && !absolutePath.startsWith(boundary)) throw new Error(`path escapes repository root: ${requestedPath}`);
  let cursor = absolutePath;
  while (cursor.startsWith(boundary)) {
    try {
      if (lstatSync(cursor).isSymbolicLink()) throw new Error(`path traverses symbolic link: ${requestedPath}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    cursor = dirname(cursor);
  }
  return absolutePath;
}

/**
 * Walks declared roots without following symlinks.
 * @param {string} root
 * @param {string[]} scanRoots
 * @returns {{files:string[], symlinks:string[], missingRoots:string[]}}
 */
export function walkRepositoryFiles(root, scanRoots = DEFAULT_SCAN_ROOTS) {
  const files = [];
  const symlinks = [];
  const missingRoots = [];
  const visit = (absolutePath) => {
    const stat = lstatSync(absolutePath);
    const relativePath = normalizeRelativePath(relative(resolve(root), absolutePath));
    if (stat.isSymbolicLink()) { symlinks.push(relativePath); return; }
    if (stat.isDirectory()) {
      for (const entry of readdirSync(absolutePath).sort()) visit(resolve(absolutePath, entry));
      return;
    }
    if (stat.isFile() && !BINARY_EXTENSIONS.has(extname(absolutePath).toLowerCase())) files.push(relativePath);
  };
  for (const scanRoot of scanRoots) {
    const absolutePath = resolveContainedPath(root, scanRoot);
    try { visit(absolutePath); } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      missingRoots.push(normalizeRelativePath(scanRoot));
    }
  }
  return {
    files: [...new Set(files)].sort(),
    symlinks: [...new Set(symlinks)].sort(),
    missingRoots: [...new Set(missingRoots)].sort(),
  };
}

/** @param {string} path @returns {string} */
function classifyKind(path) {
  if (/\.selftest\.mjs$|(?:^|\/)tools\/(?:selfcheck|integration-test|test-)/.test(path)) return 'test';
  if (/(?:^|\/)fixtures?(?:\/|$)/.test(path)) return 'fixture';
  if (/(?:^|\/)\.updates(?:\/|$)/.test(path)) return 'update-snapshot';
  if (/(?:^|\/)memory(?:\/|$)/.test(path)) return 'memory';
  if (/(?:^|\/)runtime(?:\/|$)/.test(path)) return 'runtime';
  if (/(?:^|\/)(?:commands?|skills?)(?:\/|$)/.test(path)) return 'command';
  if (/package\.json$|\.npmignore$|(?:^|\/)config/.test(path)) return 'config';
  if (/\.(?:md|txt)$/.test(path) || path.startsWith('docs/')) return 'doc';
  if (path.startsWith('templates/')) return 'template';
  return 'projection';
}

/** @param {string} path @returns {boolean} */
function isExecutableSurface(path) {
  return /\.(?:cjs|js|mjs)$/.test(path) && !/\.selftest\.mjs$/.test(path) && !/(?:^|\/)fixtures?(?:\/|$)/.test(path);
}

/** @param {string} path @returns {'runtime'|'build'|'documentation'} */
function referenceBucket(path) {
  if (/\.md$/.test(path) || path.startsWith('docs/')) return 'documentation';
  if (path.startsWith('.github/') || path.startsWith('tools/') || /(?:^|\/)(?:package\.json|install\.mjs)$/.test(path)) return 'build';
  return 'runtime';
}

/** @param {string} path @returns {boolean} */
function isReleaseEvidence(path) {
  return /^tools\/release\/v4\/(?:baselines|reports)\//.test(path);
}

/** @param {string} path @returns {boolean} */
function isReleaseFenceSource(path) {
  return /^templates\/contextkit\/tools\/scripts\/(?:legacy-inventory|legacy-reachability|module-load-trace)\.mjs$/.test(path)
    || /^tools\/release\/v4\/(?:package-audit|footprint|release-gate|release-fences\.selftest)\.mjs$/.test(path)
    || path === 'tools/release/v4/README.md';
}

/**
 * Builds a deterministic inventory of legacy candidates and their consumers.
 * @param {{root:string, scanRoots?:string[], rules?:typeof LEGACY_RULES}} options
 * @returns {object}
 */
export function buildLegacyInventory({ root, scanRoots = DEFAULT_SCAN_ROOTS, rules = LEGACY_RULES }) {
  const absoluteRoot = resolve(root);
  const { files, symlinks, missingRoots } = walkRepositoryFiles(absoluteRoot, scanRoots);
  const contents = new Map();
  const unreadableFiles = [];
  for (const path of files) {
    try { contents.set(path, readFileSync(resolveContainedPath(absoluteRoot, path), 'utf8')); }
    catch { contents.set(path, ''); unreadableFiles.push(path); }
  }
  const candidates = [];

  for (const path of files) {
    const content = contents.get(path) ?? '';
    const releaseEvidence = isReleaseEvidence(path);
    const releaseFenceSource = isReleaseFenceSource(path);
    const matchedRules = rules.filter((rule) => rule.path?.test(path) || rule.text?.test(content));
    if (!matchedRules.length && !releaseEvidence && !releaseFenceSource) continue;
    const kind = classifyKind(path);
    const executable = isExecutableSurface(path);
    const status = releaseEvidence || kind === 'memory'
      ? 'historical-archive'
      : releaseFenceSource ? 'keep' : executable ? 'migrate' : 'delete';
    const runtimeReferences = [];
    const buildReferences = [];
    const documentationReferences = [];
    const basename = path.slice(path.lastIndexOf('/') + 1);
    const referenceTokens = new Set([path, path.replaceAll('/', '\\'), basename]);
    for (const [consumerPath, consumerContent] of contents) {
      if (consumerPath === path) continue;
      if (isReleaseEvidence(consumerPath)) continue;
      if (![...referenceTokens].some((token) => token.length > 3 && consumerContent.includes(token))) continue;
      const bucket = referenceBucket(consumerPath);
      if (bucket === 'runtime') runtimeReferences.push(consumerPath);
      else if (bucket === 'build') buildReferences.push(consumerPath);
      else documentationReferences.push(consumerPath);
    }
    const releaseBlocking = !releaseEvidence && !releaseFenceSource
      && (executable || runtimeReferences.some(isExecutableSurface) || kind === 'test');
    candidates.push({
      path,
      kind,
      status,
      replacedBy: releaseEvidence ? 'historical release evidence'
        : releaseFenceSource ? 'current v4 release proof mechanism'
          : [...new Set(matchedRules.map((rule) => rule.replacedBy))].join('; '),
      runtimeReferences: runtimeReferences.sort(),
      buildReferences: buildReferences.sort(),
      documentationReferences: documentationReferences.sort(),
      reason: releaseEvidence ? 'Immutable before/cutover evidence is inert and excluded from the package and active reference graph.'
        : releaseFenceSource ? 'Current W14 release proof has an explicit package/release consumer and focused regression coverage.'
          : [...new Set(matchedRules.map((rule) => rule.reason))].join(' '),
      proof: releaseEvidence ? ['release-evidence', 'package-excluded:tools/release/']
        : releaseFenceSource ? ['consumer:release:v4:gate', 'test:release:v4']
          : matchedRules.map((rule) => `rule:${rule.id}`),
      retained: releaseEvidence || releaseFenceSource || releaseBlocking,
      releaseBlocking,
      consumerOwner: releaseEvidence || releaseFenceSource ? 'release-engineering'
        : kind === 'test' ? 'qa' : executable ? 'runtime-cutover' : 'documentation-cutover',
    });
  }

  const blocking = candidates.filter((item) => item.releaseBlocking);
  const scannedByKind = Object.fromEntries(INVENTORY_KINDS.map((kind) => [kind, files.filter((path) => classifyKind(path) === kind).length]));
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    root: '.',
    scanRoots,
    filesScanned: files.length,
    symlinksRejected: symlinks,
    missingScanRoots: missingRoots,
    unreadableFiles,
    complete: symlinks.length === 0 && missingRoots.length === 0 && unreadableFiles.length === 0,
    coverage: {
      rulesEvaluated: rules.map((rule) => rule.id),
      scannedByKind,
    },
    summary: {
      total: candidates.length,
      releaseBlocking: blocking.length,
      retainedConsumers: blocking.reduce((count, item) => count + item.runtimeReferences.length + item.buildReferences.length, 0),
      byKind: Object.fromEntries(INVENTORY_KINDS.map((kind) => [kind, candidates.filter((item) => item.kind === kind).length])),
      byStatus: Object.fromEntries(['delete', 'migrate', 'historical-archive', 'keep'].map((status) => [status, candidates.filter((item) => item.status === status).length])),
    },
    items: candidates.sort((left, right) => left.path.localeCompare(right.path)),
  };
}

/** @param {object} inventory @returns {string} */
export function renderLegacyInventoryMarkdown(inventory) {
  const lines = [
    '# ContextDevKit 4 legacy inventory', '',
    `Generated from ${inventory.filesScanned} scanned files.`, '',
    `Release verdict: **${inventory.summary.releaseBlocking === 0 && inventory.complete ? 'PASS' : 'REFUSE'}**`, '',
    `- Candidates: ${inventory.summary.total}`,
    `- Release-blocking retained candidates: ${inventory.summary.releaseBlocking}`,
    `- Retained runtime/build consumers: ${inventory.summary.retainedConsumers}`,
    `- Rejected symlinks: ${inventory.symlinksRejected.length}`,
    `- Missing scan roots: ${inventory.missingScanRoots.length}`,
    `- Unreadable files: ${inventory.unreadableFiles.length}`,
    `- Covered surface kinds: ${Object.entries(inventory.coverage.scannedByKind).map(([kind, count]) => `${kind}=${count}`).join(', ')}`,
    '',
    '| Path | Kind | Action | Replacement | Retained consumers | Release |',
    '| --- | --- | --- | --- | ---: | --- |',
  ];
  for (const item of inventory.items) {
    const consumers = item.runtimeReferences.length + item.buildReferences.length;
    lines.push(`| \`${item.path}\` | ${item.kind} | ${item.status} | ${item.replacedBy.replaceAll('|', '\\|')} | ${consumers} | ${item.releaseBlocking ? 'BLOCK' : 'allow'} |`);
  }
  lines.push('', '## Retained consumers', '');
  for (const item of inventory.items.filter((candidate) => candidate.releaseBlocking)) {
    const consumers = [...item.runtimeReferences, ...item.buildReferences];
    lines.push(`### \`${item.path}\``, '', `Replacement: ${item.replacedBy}`, '');
    if (!consumers.length) lines.push('- No separate consumer found; the executable candidate itself remains release-blocking.');
    else for (const consumer of consumers) lines.push(`- \`${consumer}\``);
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/** @returns {Record<string,string|boolean|string[]>} */
function parseArgs(argv) {
  const args = { root: '.', check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--root') args.root = argv[++index];
    else if (token === '--json-out') args.jsonOut = argv[++index];
    else if (token === '--markdown-out') args.markdownOut = argv[++index];
    else if (token === '--check') args.check = true;
    else throw new Error(`unknown argument: ${token}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(String(args.root));
  const inventory = buildLegacyInventory({ root });
  const json = `${JSON.stringify(inventory, null, 2)}\n`;
  const markdown = renderLegacyInventoryMarkdown(inventory);
  if (args.jsonOut) writeFileSync(resolveContainedPath(root, String(args.jsonOut)), json, 'utf8');
  if (args.markdownOut) writeFileSync(resolveContainedPath(root, String(args.markdownOut)), markdown, 'utf8');
  if (!args.jsonOut && !args.markdownOut) process.stdout.write(json);
  if (args.check && (!inventory.complete || inventory.summary.releaseBlocking > 0)) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`legacy-inventory: ${error.message}`); process.exitCode = 2; }
}
