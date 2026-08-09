#!/usr/bin/env node
/**
 * Manifest-driven Claude -> Codex projection generator.
 *
 * The canonical manifest is the allowlist. Generation validates every source
 * before writing, repairs declared drift, and removes only files owned by a
 * declared projection. `--check` is read-only and fails on missing, stale, or
 * orphaned output, including in a non-Git project.
 */
import { readFile, writeFile, mkdir, readdir, rm, rmdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORM_DIR } from '../config/paths.mjs';
import {
  selectHostProjectionRules,
  validateHostProjectionManifest,
} from '../../methodology/projections.mjs';
import {
  codexSkillName,
  convertCommandToSkill,
  convertAgentToToml,
  isSkippedForCodex,
} from './convert-core.mjs';

const GENERATOR = 'codex-converter';

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

/** Loads optional host model aliases; routing advice never gates projection generation. */
async function codexHostModels(root, mode) {
  try {
    const policyPath = mode === 'templates'
      ? resolve(root, 'templates', PLATFORM_DIR, 'policy', 'routing-policy.json')
      : resolve(root, PLATFORM_DIR, 'policy', 'routing-policy.json');
    const policy = JSON.parse((await readFile(policyPath, 'utf8')).replace(/^\uFEFF/, ''));
    const models = {};
    for (const [tier, definition] of Object.entries(policy.tiers ?? {})) {
      if (definition?.alias && policy.hostModels?.codex?.[tier]) {
        models[definition.alias] = policy.hostModels.codex[tier];
      }
    }
    return models;
  } catch {
    return {};
  }
}

/** Adds one expected file and refuses two sources targeting the same path. */
function declareExpected(expected, targetPath, content, sourcePath) {
  const prior = expected.get(targetPath);
  if (prior) {
    throw new Error(`ambiguous projection target ${targetPath}: ${prior.sourcePath} and ${sourcePath}`);
  }
  expected.set(targetPath, { content, sourcePath });
}

/** Builds every declared Codex output in memory before any mutation. */
async function buildExpected(root, rules, mode) {
  const expected = new Map();
  const hostModels = await codexHostModels(root, mode);
  for (const rule of rules) {
    const sourceRoot = resolveDeclaredPath(root, rule.sourcePath, `${rule.id}.source`);
    const targetRoot = resolveDeclaredPath(root, rule.targetPath, `${rule.id}.target`);
    const sourceFiles = await listFiles(sourceRoot, { required: true });
    if (rule.transform === 'codex-command-skill') {
      for (const sourcePath of sourceFiles.filter((path) => path.endsWith('.md'))) {
        const sourceRelative = relative(sourceRoot, sourcePath);
        if (sourceRelative === 'README.md' || isSkippedForCodex(sourceRelative)) continue;
        const targetPath = join(targetRoot, codexSkillName(sourceRelative), 'SKILL.md');
        declareExpected(expected, targetPath, convertCommandToSkill(await readFile(sourcePath, 'utf8'), sourceRelative), sourcePath);
      }
    } else if (rule.transform === 'codex-agent-toml') {
      for (const sourcePath of sourceFiles.filter((path) => path.endsWith('.md'))) {
        const sourceRelative = relative(sourceRoot, sourcePath);
        const targetPath = join(targetRoot, `${basename(sourceRelative, '.md')}.toml`);
        declareExpected(expected, targetPath, convertAgentToToml(await readFile(sourcePath, 'utf8'), sourceRelative, { hostModels }), sourcePath);
      }
    } else {
      throw new TypeError(`unsupported Codex projection transform: ${rule.transform}`);
    }
  }
  return expected;
}

/** True when a file is owned by a declared Codex projection rule. */
function isManagedFile(rule, relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  if (rule.retain.includes(normalized)) return false;
  if (rule.managed === 'source-command-directories') {
    return normalized.split('/')[0]?.startsWith('source-command-') === true;
  }
  if (rule.managed === 'toml-files') return !normalized.includes('/') && normalized.endsWith('.toml');
  throw new TypeError(`unsupported Codex managed selector: ${rule.managed}`);
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
      if (isManagedFile(rule, candidateRelative) && !expected.has(candidate)) {
        orphans.push(candidate);
      }
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
 * Executes or checks the complete Codex projection set.
 *
 * @param {{root?:string, mode?:'templates'|'installed', check?:boolean, dryRun?:boolean}} [options]
 * @returns {Promise<{ok:boolean, generated:number, drift:Array<object>, orphans:string[], mode:string}>}
 */
export async function runCodexProjectionGeneration(options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const mode = options.mode ?? 'installed';
  const manifest = await loadManifest(root, mode);
  const rules = selectHostProjectionRules(manifest, 'codex', mode, GENERATOR);
  const expected = await buildExpected(root, rules, mode);
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
  const report = await runCodexProjectionGeneration({ mode, check, dryRun });
  const suffix = check ? ' (CHECK)' : dryRun ? ' (DRY RUN)' : '';
  console.log(`Codex conversion complete${suffix}: ${report.generated} declared projections`);
  for (const item of report.drift) console.error(`  drift:${item.reason}: ${item.path}`);
  for (const path of report.orphans) console.error(`  orphan: ${path}`);
  if (check && !report.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`Codex conversion failed: ${error.message}`);
    process.exitCode = 1;
  });
}
