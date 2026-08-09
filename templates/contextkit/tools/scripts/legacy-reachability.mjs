#!/usr/bin/env node
/** Static reachability fence for ContextDevKit 4 normal-runtime entrypoints. */
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildLegacyInventory,
  normalizeRelativePath,
  resolveContainedPath,
  walkRepositoryFiles,
} from './legacy-inventory.mjs';

const MODULE_EXTENSIONS = new Set(['.cjs', '.js', '.mjs']);
const DEFAULT_ENTRYPOINTS = [
  'install.mjs',
  'templates/ctx.mjs',
  'templates/cdx.mjs',
  'templates/contextkit/runtime/hooks/governance-prompt-preflight.mjs',
  'templates/contextkit/runtime/hooks/governance-write-preflight.mjs',
  'templates/contextkit/runtime/hooks/governance-postflight.mjs',
  'templates/contextkit/runtime/hooks/governance-completion.mjs',
];

/** @param {string} source @returns {string[]} */
export function extractModuleSpecifiers(source) {
  const specifiers = [];
  const staticPattern = /(?:import|export)\s+(?:[^;'"\n]+?\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicPattern = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(staticPattern)) specifiers.push(match[1]);
  for (const match of source.matchAll(dynamicPattern)) specifiers.push(match[1]);
  return [...new Set(specifiers.filter(Boolean))];
}

/**
 * Resolves a relative module specifier without escaping the repository.
 * @param {string} root
 * @param {string} importer
 * @param {string} specifier
 * @returns {string|null}
 */
export function resolveModuleSpecifier(root, importer, specifier) {
  if (!specifier.startsWith('.')) return null;
  const absoluteTarget = resolve(dirname(resolveContainedPath(root, importer)), specifier);
  const base = normalizeRelativePath(relative(resolve(root), absoluteTarget));
  try { resolveContainedPath(root, base); } catch { return null; }
  const candidates = extname(base) ? [base] : [`${base}.mjs`, `${base}.js`, `${base}.cjs`, `${base}/index.mjs`, `${base}/index.js`];
  for (const candidate of candidates) {
    let absolute;
    try { absolute = resolveContainedPath(root, candidate); } catch { return null; }
    if (existsSync(absolute) && lstatSync(absolute).isFile() && !lstatSync(absolute).isSymbolicLink()) return candidate;
  }
  return null;
}

/**
 * Builds import and literal registry edges. Registry strings are important
 * because host composers register hook filenames rather than importing them.
 * @param {string} root
 * @returns {Map<string,string[]>}
 */
export function buildModuleGraph(root) {
  const { files } = walkRepositoryFiles(root, ['install.mjs', 'templates', 'tools/install']);
  const modules = files.filter((path) => MODULE_EXTENSIONS.has(extname(path)));
  const basenameIndex = new Map();
  for (const path of modules) {
    const basename = path.slice(path.lastIndexOf('/') + 1);
    const matches = basenameIndex.get(basename) ?? [];
    matches.push(path);
    basenameIndex.set(basename, matches);
  }
  const graph = new Map();
  for (const importer of modules) {
    const source = readFileSync(resolveContainedPath(root, importer), 'utf8');
    const edges = new Set();
    for (const specifier of extractModuleSpecifiers(source)) {
      const target = resolveModuleSpecifier(root, importer, specifier);
      if (target) edges.add(target);
    }
    for (const match of source.matchAll(/['"]([^'"\n]+\.mjs)['"]/g)) {
      const literal = match[1];
      const relativeTarget = resolveModuleSpecifier(root, importer, literal);
      if (relativeTarget) edges.add(relativeTarget);
      const basenameMatches = basenameIndex.get(literal.slice(literal.lastIndexOf('/') + 1)) ?? [];
      if (basenameMatches.length === 1) edges.add(basenameMatches[0]);
    }
    graph.set(importer, [...edges].sort());
  }
  return graph;
}

/** @param {Map<string,string[]>} graph @param {string} entrypoint @returns {Map<string,string|null>} */
function traverse(graph, entrypoint) {
  const parents = new Map([[entrypoint, null]]);
  const queue = [entrypoint];
  while (queue.length) {
    const current = queue.shift();
    for (const next of graph.get(current) ?? []) {
      if (parents.has(next)) continue;
      parents.set(next, current);
      queue.push(next);
    }
  }
  return parents;
}

/** @param {Map<string,string|null>} parents @param {string} target @returns {string[]} */
function chainFor(parents, target) {
  const chain = [];
  let current = target;
  while (current !== null && current !== undefined) { chain.unshift(current); current = parents.get(current); }
  return chain;
}

/**
 * Checks whether normal v4 entrypoints can reach retained executable legacy.
 * @param {{root:string, entrypoints?:string[], legacyPaths?:string[]}} options
 * @returns {object}
 */
export function analyzeLegacyReachability({ root, entrypoints = DEFAULT_ENTRYPOINTS, legacyPaths }) {
  const absoluteRoot = resolve(root);
  const graph = buildModuleGraph(absoluteRoot);
  const inventory = legacyPaths ? null : buildLegacyInventory({ root: absoluteRoot });
  const blockedPaths = new Set(legacyPaths ?? inventory.items.filter((item) => item.releaseBlocking && /\.(?:cjs|js|mjs)$/.test(item.path)).map((item) => item.path));
  const missingEntrypoints = [];
  const reachable = [];
  for (const rawEntrypoint of entrypoints) {
    const entrypoint = normalizeRelativePath(rawEntrypoint);
    let absoluteEntrypoint;
    try { absoluteEntrypoint = resolveContainedPath(absoluteRoot, entrypoint); } catch (error) {
      missingEntrypoints.push({ path: entrypoint, reason: error.message });
      continue;
    }
    if (!existsSync(absoluteEntrypoint) || lstatSync(absoluteEntrypoint).isSymbolicLink()) {
      missingEntrypoints.push({ path: entrypoint, reason: 'missing or symbolic-link entrypoint' });
      continue;
    }
    const parents = traverse(graph, entrypoint);
    for (const legacyPath of blockedPaths) {
      if (parents.has(legacyPath)) reachable.push({ entrypoint, legacyPath, chain: chainFor(parents, legacyPath) });
    }
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    entrypoints: entrypoints.map(normalizeRelativePath),
    missingEntrypoints,
    legacyModuleCount: blockedPaths.size,
    reachable,
    verdict: missingEntrypoints.length === 0 && reachable.length === 0 ? 'pass' : 'refuse',
  };
}

/** @param {object} report @returns {string} */
export function renderReachabilityMarkdown(report) {
  const lines = [
    '# ContextDevKit 4 static legacy reachability', '',
    `Verdict: **${report.verdict.toUpperCase()}**`, '',
    `- Entrypoints: ${report.entrypoints.length}`,
    `- Missing entrypoints: ${report.missingEntrypoints.length}`,
    `- Legacy modules: ${report.legacyModuleCount}`,
    `- Reachable legacy paths: ${report.reachable.length}`,
    '',
  ];
  for (const missing of report.missingEntrypoints) lines.push(`- Missing \`${missing.path}\`: ${missing.reason}`);
  for (const hit of report.reachable) lines.push(`- ${hit.chain.map((path) => `\`${path}\``).join(' -> ')}`);
  return `${lines.join('\n').trimEnd()}\n`;
}

/** @returns {Record<string,unknown>} */
function parseArgs(argv) {
  const args = { root: '.', entrypoints: [], check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--root') args.root = argv[++index];
    else if (token === '--entrypoint') args.entrypoints.push(argv[++index]);
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
  const entrypoints = args.entrypoints.length ? args.entrypoints : DEFAULT_ENTRYPOINTS;
  const report = analyzeLegacyReachability({ root, entrypoints });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = renderReachabilityMarkdown(report);
  if (args.jsonOut) writeFileSync(resolveContainedPath(root, String(args.jsonOut)), json, 'utf8');
  if (args.markdownOut) writeFileSync(resolveContainedPath(root, String(args.markdownOut)), markdown, 'utf8');
  if (!args.jsonOut && !args.markdownOut) process.stdout.write(json);
  if (args.check && report.verdict !== 'pass') process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`legacy-reachability: ${error.message}`); process.exitCode = 2; }
}
