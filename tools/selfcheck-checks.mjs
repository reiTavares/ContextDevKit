/**
 * Self-check assertions — the behavioural + structural half of the self-check,
 * split out of `selfcheck.mjs` to keep each file within the line budget.
 *
 * `selfcheck.mjs` owns the harness (the reporter, module loading, settings
 * composition, config + template inventory). This module owns the deeper checks:
 * boot-reader behaviour, concurrency-safety primitives, shared squad detection,
 * level/schema agreement, and the source/supply-chain/path invariants.
 *
 * Every function takes the reporter `rep` ({ ok, bad }) plus only what it needs,
 * so it has no hidden module state. Entry point: `runExtendedChecks(rep, ctx)`.
 *
 * agent-forge-specific checks live in `./selfcheck-agent-forge.mjs` (split out as a
 * real responsibility seam once they reached three).
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const srcTextFor = (KIT) => (rel) => readFile(resolve(KIT, rel), 'utf-8').catch(() => '');

/**
 * Boot-context reader behaviours the boot banner depends on. Guards two boundary
 * bugs: a clipped [Unreleased] must say so, and a session number collision must
 * resolve by the later date.
 */
async function checkBootReaders(rep, boot) {
  const { ok, bad } = rep;
  console.log('Checking boot-context readers...');
  if (!boot?.extractUnreleased || !boot?.extractLatestSession) {
    bad('boot-context-readers exports missing (extractUnreleased/extractLatestSession)');
    return;
  }
  boot.extractUnreleased('## [Unreleased]\n\n- one real change\n\n## [1.0.0]\n') === '- one real change'
    ? ok('extractUnreleased returns a short block verbatim') : bad('extractUnreleased mangled a short block');
  const bigBody = Array.from({ length: 80 }, (_, i) => `- change ${i}`).join('\n');
  /truncated/i.test(boot.extractUnreleased(`## [Unreleased]\n\n${bigBody}\n\n## [1.0.0]\n`) || '')
    ? ok('extractUnreleased flags a >60-line block as truncated') : bad('extractUnreleased truncated silently (no marker)');
  const tmp = mkdtempSync(join(tmpdir(), 'vibekit-sc-'));
  try {
    const sdir = resolve(tmp, 'vibekit/memory/sessions');
    mkdirSync(sdir, { recursive: true });
    writeFileSync(resolve(sdir, '2026-01-02-09-older.md'), '# OLDER session pick\n');
    writeFileSync(resolve(sdir, '2026-05-09-09-newer.md'), '# NEWER session pick\n');
    const latest = await boot.extractLatestSession(tmp);
    latest?.content?.includes('NEWER')
      ? ok('extractLatestSession breaks a number tie by the later date') : bad(`extractLatestSession tie-break wrong: ${latest?.content}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Atomic writes round-trip + leave no temp residue; sid sanitization neutralizes
 *  traversal; shared JSON read/parse work. Guards 008/011/012/027. */
async function checkConcurrencySafety(rep, safeio, ledger) {
  const { ok, bad } = rep;
  console.log('Checking atomic I/O + sid sanitization...');
  if (safeio?.writeFileAtomicSync && safeio?.writeFileAtomic) {
    const tmp = mkdtempSync(join(tmpdir(), 'vibekit-io-'));
    try {
      const f = resolve(tmp, 'a.txt');
      safeio.writeFileAtomicSync(f, 'hello');
      readFileSync(f, 'utf-8') === 'hello' ? ok('writeFileAtomicSync round-trips') : bad('writeFileAtomicSync wrong content');
      await safeio.writeFileAtomic(f, 'world');
      readFileSync(f, 'utf-8') === 'world' ? ok('writeFileAtomic round-trips') : bad('writeFileAtomic wrong content');
      readdirSync(tmp).length === 1 ? ok('atomic write leaves no temp residue') : bad('atomic write left temp files behind');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  } else bad('safe-io atomic writers not exported');
  if (ledger?.sanitizeSid) {
    const dirty = ledger.sanitizeSid('../../etc/passwd');
    !dirty.includes('/') && !dirty.includes('.') ? ok('sanitizeSid neutralizes path traversal') : bad(`sanitizeSid leaked separators: ${dirty}`);
  } else bad('ledger.sanitizeSid not exported');
  if (safeio?.readJsonSafe && safeio?.parseJsonSafe) {
    safeio.parseJsonSafe('{"a":1}')?.a === 1 && safeio.parseJsonSafe('not json', 'fb') === 'fb'
      ? ok('parseJsonSafe parses + falls back') : bad('parseJsonSafe wrong');
    const tmp2 = mkdtempSync(join(tmpdir(), 'vibekit-rj-'));
    try {
      const jf = resolve(tmp2, 'x.json');
      writeFileSync(jf, '﻿' + JSON.stringify({ ok: true }));
      safeio.readJsonSafe(jf)?.ok === true ? ok('readJsonSafe reads a BOM-prefixed JSON file') : bad('readJsonSafe BOM fail');
      safeio.readJsonSafe(resolve(tmp2, 'missing.json'), 'def') === 'def' ? ok('readJsonSafe returns fallback for a missing file') : bad('readJsonSafe missing-file fail');
    } finally {
      rmSync(tmp2, { recursive: true, force: true });
    }
  } else bad('safe-io read helpers (readJsonSafe/parseJsonSafe) not exported');
}

/** 028 — shared squad detection used by /squad + /tune-agents. */
async function checkSquadMeta(rep, KIT) {
  const { ok, bad } = rep;
  console.log('Checking shared squad detection...');
  const { squadOf } = await import('file://' + resolve(KIT, 'templates/vibekit/tools/scripts/squad-meta.mjs').replaceAll('\\', '/'));
  const dir = mkdtempSync(join(tmpdir(), 'vibekit-sq-'));
  try {
    writeFileSync(resolve(dir, 'infra-security.md'), '---\ndescription: Cloud security (security-team)\n---\n');
    squadOf(dir, 'qa-unit') === 'qa-team' ? ok('squadOf: qa-* → qa-team') : bad('squadOf qa-* wrong');
    squadOf(dir, 'infra-security') === 'security-team' ? ok('squadOf: reads the squad tag from the description') : bad('squadOf tag parse wrong');
    squadOf(dir, 'nonexistent') === 'devteam' ? ok('squadOf: missing agent → devteam') : bad('squadOf fallback wrong');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Level taxonomy single-sourced + schema agrees (zod-conditional). Guards 024/025/018. */
async function checkLevelsAndSchema(rep, mods, RT) {
  const { ok, bad } = rep;
  console.log('Checking level taxonomy + config schema...');
  const levels = mods['config/levels.mjs'];
  const load = mods['config/load.mjs'];
  const defaults = mods['config/defaults.mjs']?.DEFAULT_CONFIG;
  if (levels) {
    levels.MAX_LEVEL === 7 && levels.isValidLevel(7) && !levels.isValidLevel(8) && !levels.isValidLevel(0)
      ? ok('levels: MAX_LEVEL 7 + isValidLevel bounds') : bad('levels bounds wrong');
    levels.clampLevel(99) === 7 && levels.clampLevel(-5) === 1 ? ok('levels: clampLevel clamps to range') : bad('clampLevel wrong');
    Object.keys(levels.LEVEL_LABELS).length === 7 ? ok('levels: 7 labels in the single table') : bad('LEVEL_LABELS count wrong');
  } else bad('config/levels.mjs not loaded');
  if (load?.getLevel) {
    const root = mkdtempSync(join(tmpdir(), 'vibekit-lv-'));
    try {
      mkdirSync(resolve(root, 'vibekit'), { recursive: true });
      writeFileSync(resolve(root, 'vibekit/config.json'), JSON.stringify({ level: 7 }));
      load.getLevel(root) === 7 ? ok('getLevel accepts L7') : bad('getLevel rejects L7');
      writeFileSync(resolve(root, 'vibekit/config.json'), JSON.stringify({ level: 8 }));
      load.getLevel(root) === 2 ? ok('getLevel rejects an out-of-range level (fallback 2)') : bad('getLevel did not reject L8');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  let zodAvailable = false;
  try {
    await import('zod');
    zodAvailable = true;
  } catch {
    /* optional dep */
  }
  if (!zodAvailable) {
    ok('schema validation skipped (zod not installed — optional dep by design)');
    return;
  }
  const schema = await import('file://' + resolve(RT, 'config/schema.mjs').replaceAll('\\', '/'));
  const good = schema.validateConfig(defaults);
  good.ok && good.config.qa && good.config.pipeline
    ? ok('schema validates DEFAULT_CONFIG + passthrough keeps every section') : bad('schema rejected defaults / dropped sections');
  schema.validateConfig({ ...defaults, level: 7 }).ok ? ok('schema accepts level 7') : bad('schema rejects level 7');
  !schema.validateConfig({ ...defaults, level: 9 }).ok ? ok('schema rejects an out-of-range level') : bad('schema accepted level 9');
}

/** Source-level invariants — structural guarantees that would silently regress. */
async function checkSourceInvariants(rep, KIT) {
  const { ok, bad } = rep;
  const srcText = srcTextFor(KIT);
  console.log('Checking source-level invariants...');
  const cases = [
    ['network git calls time out (git.mjs)', 'templates/vibekit/tools/scripts/git.mjs', /timeout:\s*\w/],
    ['network git calls time out (pre-push.mjs)', 'templates/vibekit/runtime/git-hooks/pre-push.mjs', /timeout:\s*\w/],
    ['ledger writes are atomic', 'templates/vibekit/runtime/hooks/ledger.mjs', /writeFileAtomic/],
    ['pipeline writers are atomic', 'templates/vibekit/tools/scripts/pipeline.mjs', /writeFileAtomicSync/],
    ['workspace-sync write is atomic', 'templates/vibekit/tools/scripts/workspace-sync.mjs', /writeFileAtomic/],
    ['pipeline allocates ids with exclusive create', 'templates/vibekit/tools/scripts/pipeline.mjs', /flag:\s*'wx'/],
    ['claim sanitizes the session id', 'templates/vibekit/tools/scripts/claim.mjs', /sanitizeSid/],
    ['release sanitizes the session id', 'templates/vibekit/tools/scripts/release.mjs', /sanitizeSid/],
    ['track-edits sanitizes the session id', 'templates/vibekit/runtime/hooks/track-edits.mjs', /sanitizeSid/],
    ['session-start guards live ledgers from deletion', 'templates/vibekit/runtime/hooks/session-start.mjs', /maybeLive/],
    ['config schema is passthrough', 'templates/vibekit/runtime/config/schema.mjs', /\.passthrough\(\)/],
    ['config schema bounds level by MAX_LEVEL', 'templates/vibekit/runtime/config/schema.mjs', /max\(MAX_LEVEL\)/],
    ['installer labels single-sourced from levels.mjs', 'tools/install/cli.mjs', /levels\.mjs/],
    ['vibe-level labels single-sourced from levels.mjs', 'templates/vibekit/tools/scripts/vibe-level.mjs', /levels\.mjs/],
    ['squad detection single-sourced (squad.mjs)', 'templates/vibekit/tools/scripts/squad.mjs', /squad-meta/],
    ['squad detection single-sourced (agent-tuning.mjs)', 'templates/vibekit/tools/scripts/agent-tuning.mjs', /squad-meta/],
    ['installer backs up an existing git hook', 'tools/install/git.mjs', /\.bak/],
    ['agent-forge yaml loader uses optional dynamic import', 'templates/vibekit/squads/agent-forge/lib/yaml.mjs', /import\(\s*['"]yaml['"]\s*\)/],
  ];
  for (const [label, rel, re] of cases) {
    re.test(await srcText(rel)) ? ok(label) : bad(`${label} — pattern ${re} missing in ${rel}`);
  }
}

/** Shipped GitHub Actions must be SHA-pinned; CI must be least-privilege. */
async function checkWorkflowsPinned(rep, KIT) {
  const { ok, bad } = rep;
  const srcText = srcTextFor(KIT);
  console.log('Checking GitHub Actions are SHA-pinned...');
  const files = [
    '.github/workflows/ci.yml',
    '.github/workflows/release.yml',
    'templates/github/workflows/quality.yml',
    'templates/github/workflows/security.yml',
  ];
  const floating = /uses:\s*[\w./-]+@v\d/;
  for (const rel of files) {
    const text = await srcText(rel);
    if (!text) {
      bad(`workflow missing: ${rel}`);
      continue;
    }
    floating.test(text) ? bad(`${rel} has an unpinned (floating) action tag`) : ok(`${rel} actions are SHA-pinned`);
  }
  /permissions:[\s\S]*?contents:\s*read/.test(await srcText('.github/workflows/ci.yml'))
    ? ok('ci.yml declares least-privilege permissions (contents: read)') : bad('ci.yml missing contents:read permissions');
}

/** All `.mjs` under a directory, recursively. */
export async function listMjs(absDir) {
  const out = [];
  let entries = [];
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = resolve(absDir, e.name);
    if (e.isDirectory()) out.push(...(await listMjs(p)));
    else if (e.name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

/** Rule 4: no shipped runtime/script constructs a `vibekit/` path via resolve/join. */
async function checkNoHardcodedPaths(rep, KIT) {
  const { ok, bad } = rep;
  console.log('Checking platform paths are single-sourced (rule 4)...');
  const re = /\b(resolve|join)\(.*['"]vibekit\//;
  const offenders = [];
  for (const d of ['templates/vibekit/runtime', 'templates/vibekit/tools/scripts']) {
    for (const file of await listMjs(resolve(KIT, d))) {
      const lines = (await readFile(file, 'utf-8').catch(() => '')).split('\n');
      lines.forEach((line, i) => {
        if (/^\s*(\*|\/\/)/.test(line)) return;
        if (re.test(line)) offenders.push(`${file.replace(KIT, '').replaceAll('\\', '/')}:${i + 1}`);
      });
    }
  }
  offenders.length === 0
    ? ok('no hardcoded vibekit/ path construction (all via pathsFor/PLATFORM_DIR)')
    : offenders.forEach((o) => bad(`hardcoded vibekit/ path: ${o}`));
}

/** Runs every extended check in order. `ctx` = { KIT, RT, mods }. */
export async function runExtendedChecks(rep, { KIT, RT, mods }) {
  await checkBootReaders(rep, mods['hooks/boot-context-readers.mjs']);
  await checkConcurrencySafety(rep, mods['hooks/safe-io.mjs'], mods['hooks/ledger.mjs']);
  await checkSquadMeta(rep, KIT);
  await checkLevelsAndSchema(rep, mods, RT);
  await checkSourceInvariants(rep, KIT);
  await checkNoHardcodedPaths(rep, KIT);
  await checkWorkflowsPinned(rep, KIT);
}
