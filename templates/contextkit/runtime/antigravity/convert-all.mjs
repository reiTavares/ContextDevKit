#!/usr/bin/env node
/**
 * Manifest-driven Claude -> Antigravity projection generator.
 *
 * Sources are validated before mutation. Normal generation repairs declared
 * outputs and removes managed orphans; `--check` is read-only and exits nonzero
 * for missing-source, content drift, or orphan drift. Git is never consulted.
 */
import { readFile, writeFile, mkdir, readdir, rm, rmdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORM_DIR } from '../config/paths.mjs';
import {
  selectHostProjectionRules,
  validateHostProjectionManifest,
} from '../../methodology/projections.mjs';
import { adaptContent, convertCommandToSkill, convertAgentToPersona } from './convert-core.mjs';

const GENERATOR = 'antigravity-converter';

/** Resolves a manifest-declared relative path and proves containment. */
function resolveDeclaredPath(root, declaredPath, label) {
  const absolute = resolve(root, declaredPath);
  const fromRoot = relative(root, absolute);
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new TypeError(`${label} escapes the project root: ${declaredPath}`);
  }
  return absolute;
}

/** Recursively lists regular files in stable path order. */
async function listFiles(directory, { required = false } = {}) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (!required && error?.code === 'ENOENT') return [];
    throw new Error(`projection source is unavailable: ${directory}`, { cause: error });
  }
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(entryPath, { required: true }));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

/** Loads the canonical manifest for kit-build or installed-project mode. */
async function loadManifest(root, mode) {
  const manifestPath = mode === 'templates'
    ? resolve(root, 'templates', PLATFORM_DIR, 'policy', 'host-projections.json')
    : resolve(root, PLATFORM_DIR, 'policy', 'host-projections.json');
  let raw;
  try {
    raw = await readFile(manifestPath, 'utf8');
  } catch (error) {
    throw new Error(`host projection manifest is unavailable: ${manifestPath}`, { cause: error });
  }
  return validateHostProjectionManifest(JSON.parse(raw.replace(/^\uFEFF/, '')));
}

/** Adds one expected file and refuses two sources targeting the same path. */
function declareExpected(expected, targetPath, content, sourcePath) {
  const prior = expected.get(targetPath);
  if (prior) {
    throw new Error(`ambiguous projection target ${targetPath}: ${prior.sourcePath} and ${sourcePath}`);
  }
  expected.set(targetPath, { content, sourcePath });
}

/** Builds skill projections plus deterministic non-recursive aliases. */
async function buildSkillOutputs(expected, sourceRoot, targetRoot, sourceFiles) {
  const markdownFiles = sourceFiles.filter((path) => path.endsWith('.md'));
  const nestedByBasename = new Map();
  for (const sourcePath of markdownFiles) {
    const sourceRelative = relative(sourceRoot, sourcePath);
    if (sourceRelative === 'README.md') continue;
    const content = convertCommandToSkill(await readFile(sourcePath, 'utf8'), sourceRelative);
    declareExpected(expected, join(targetRoot, sourceRelative), content, sourcePath);
    if (!sourceRelative.includes('/') && !sourceRelative.includes('\\')) continue;
    const name = basename(sourceRelative);
    const aliases = nestedByBasename.get(name) ?? [];
    aliases.push({ sourcePath, sourceRelative, content });
    nestedByBasename.set(name, aliases);
  }
  for (const [name, aliases] of [...nestedByBasename].sort(([left], [right]) => left.localeCompare(right))) {
    const flatTarget = join(targetRoot, name);
    if (expected.has(flatTarget)) continue;
    if (aliases.length > 1) continue;
    const alias = aliases[0];
    declareExpected(expected, flatTarget, alias.content, alias.sourcePath);
  }
}

/** Builds every declared Antigravity output in memory before any mutation. */
async function buildExpected(root, rules) {
  const expected = new Map();
  for (const rule of rules) {
    const sourceRoot = resolveDeclaredPath(root, rule.sourcePath, `${rule.id}.source`);
    const targetRoot = resolveDeclaredPath(root, rule.targetPath, `${rule.id}.target`);
    const sourceFiles = await listFiles(sourceRoot, { required: true });
    if (rule.transform === 'antigravity-command-skill') {
      await buildSkillOutputs(expected, sourceRoot, targetRoot, sourceFiles);
      continue;
    }
    for (const sourcePath of sourceFiles.filter((path) => path.endsWith('.md'))) {
      const sourceRelative = relative(sourceRoot, sourcePath);
      if (rule.transform === 'antigravity-agent-persona') {
        declareExpected(expected, join(targetRoot, sourceRelative), convertAgentToPersona(await readFile(sourcePath, 'utf8'), sourceRelative), sourcePath);
      } else if (rule.transform === 'antigravity-playbook') {
        const header = `# Playbook: ${basename(sourceRelative, '.md')}\n\n> Reusable procedure. Follow the steps below when invoked.\n\n`;
        declareExpected(expected, join(targetRoot, sourceRelative), header + adaptContent(await readFile(sourcePath, 'utf8')), sourcePath);
      } else if (rule.transform === 'antigravity-workflow') {
        if (sourceRelative.includes('/') || sourceRelative.includes('\\')) continue;
        declareExpected(expected, join(targetRoot, sourceRelative), adaptContent(await readFile(sourcePath, 'utf8')), sourcePath);
      } else {
        throw new TypeError(`unsupported Antigravity projection transform: ${rule.transform}`);
      }
    }
  }
  return expected;
}

/** True when a file is owned by a declared Antigravity projection rule. */
function isManagedFile(rule, relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  if (rule.retain.includes(normalized)) return false;
  if (rule.managed === 'antigravity-skill-markdown') {
    return normalized.endsWith('.md') && !normalized.split('/')[0]?.startsWith('source-command-');
  }
  if (rule.managed === 'markdown-files') return normalized.endsWith('.md');
  if (rule.managed === 'top-level-markdown') return !normalized.includes('/') && normalized.endsWith('.md');
  throw new TypeError(`unsupported Antigravity managed selector: ${rule.managed}`);
}

/** Finds declared-output drift and stale generated files. */
async function inspectProjectionState(root, rules, expected) {
  const drift = [];
  for (const [targetPath, projection] of expected) {
    const actual = await readFile(targetPath, 'utf8').catch(() => null);
    if (actual === null) drift.push({ path: relative(root, targetPath), reason: 'missing', ...projection });
    else if (actual !== projection.content) drift.push({ path: relative(root, targetPath), reason: 'content', ...projection });
  }
  const orphans = [];
  for (const rule of rules) {
    const targetRoot = resolveDeclaredPath(root, rule.targetPath, `${rule.id}.target`);
    for (const candidate of await listFiles(targetRoot)) {
      const candidateRelative = relative(targetRoot, candidate);
      if (isManagedFile(rule, candidateRelative) && !expected.has(candidate)) orphans.push(candidate);
    }
  }
  return { drift, orphans: [...new Set(orphans)].sort() };
}

/** Removes now-empty generated directories without crossing the declared target root. */
async function removeEmptyParents(filePath, targetRoot) {
  let current = dirname(filePath);
  while (current !== targetRoot) {
    const fromTarget = relative(targetRoot, current);
    if (fromTarget.startsWith('..') || isAbsolute(fromTarget)) return;
    try {
      await rmdir(current);
    } catch {
      return;
    }
    current = dirname(current);
  }
}

/**
 * Executes or checks the complete Antigravity projection set.
 *
 * @param {{root?:string, mode?:'templates'|'installed', check?:boolean, dryRun?:boolean}} [options]
 * @returns {Promise<{ok:boolean, generated:number, drift:Array<object>, orphans:string[], mode:string}>}
 */
export async function runAntigravityProjectionGeneration(options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const mode = options.mode ?? 'installed';
  const manifest = await loadManifest(root, mode);
  const rules = selectHostProjectionRules(manifest, 'antigravity', mode, GENERATOR);
  const expected = await buildExpected(root, rules);
  const inspection = await inspectProjectionState(root, rules, expected);
  const report = {
    ok: inspection.drift.length === 0 && inspection.orphans.length === 0,
    generated: expected.size,
    drift: inspection.drift,
    orphans: inspection.orphans.map((path) => relative(root, path)),
    mode,
  };
  if (options.check || options.dryRun) return report;

  for (const [targetPath, projection] of expected) {
    const actual = await readFile(targetPath, 'utf8').catch(() => null);
    if (actual === projection.content) continue;
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, projection.content, 'utf8');
  }
  for (const orphanPath of inspection.orphans) {
    const matchingRule = rules.find((rule) => {
      const targetRoot = resolveDeclaredPath(root, rule.targetPath, `${rule.id}.target`);
      const fromTarget = relative(targetRoot, orphanPath);
      return !fromTarget.startsWith('..') && !isAbsolute(fromTarget);
    });
    if (!matchingRule) throw new Error(`refusing to remove undeclared orphan: ${orphanPath}`);
    const targetRoot = resolveDeclaredPath(root, matchingRule.targetPath, `${matchingRule.id}.target`);
    await rm(orphanPath, { force: true });
    await removeEmptyParents(orphanPath, targetRoot);
  }
  return { ...report, ok: true };
}

/** CLI adapter. */
async function main() {
  const check = process.argv.includes('--check');
  const dryRun = process.argv.includes('--dry-run');
  const mode = process.argv.includes('--templates') ? 'templates' : 'installed';
  const report = await runAntigravityProjectionGeneration({ mode, check, dryRun });
  const suffix = check ? ' (CHECK)' : dryRun ? ' (DRY RUN)' : '';
  console.log(`Antigravity conversion complete${suffix}: ${report.generated} declared projections`);
  for (const item of report.drift) console.error(`  drift:${item.reason}: ${item.path}`);
  for (const path of report.orphans) console.error(`  orphan: ${path}`);
  if (check && !report.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`Antigravity conversion failed: ${error.message}`);
    process.exitCode = 1;
  });
}
