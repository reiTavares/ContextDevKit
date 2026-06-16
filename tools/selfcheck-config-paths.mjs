/**
 * Self-check suite for the P0 hotfix 3.0.1 — config-path migration safety.
 *
 * Regression proof for the shipped v3.0.0 corruption where legitimate project
 * paths (`src/`, `dist/`, `node_modules/`, …) collapsed to duplicate `contextkit/`
 * entries. Locks the allowlist-gated contract: ONLY a known legacy `vibekit/`
 * prefix is ever migrated, never an empty suffix, never a guess, order preserved,
 * idempotent. Exercises the pure healer against a realistic v2.8.0 config fixture.
 * Wired into `tools/selfcheck.mjs`.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';

/** A representative v2.8.0 config.json — the kind a real upgrade carries. */
function v280Fixture() {
  return {
    level: 6,
    ledger: {
      registration: ['vibekit/memory/SESSIONS.md', 'vibekit/memory/decisions'],
      important: ['src/', 'lib/', 'node_modules/', 'dist/', 'build/', 'coverage/', 'app/api/', 'vibekit/policy/routing-policy.json'],
      irrelevant: ['*.log', 'tmp/**', 'https://example.com/x', '/etc/hosts', 'C:\\\\Users\\\\me\\\\proj', '$HOME/cfg', '~/notes'],
    },
    l5: { highRiskPaths: ['src/auth/', 'vibekit/runtime/hooks', 'packages/core/'] },
    qa: { criticalPaths: ['src/payments/', 'lib/db/'] },
    custom: { mine: ['anything/here', 'vibekit/keep-if-exists'] },
  };
}

/**
 * @param {{ ok: Function, bad: Function }} report
 * @param {{ KIT: string }} ctx
 */
export async function runConfigPathChecks({ ok, bad }, { KIT }) {
  console.log('Checking P0 config-path migration safety...');
  let mod;
  try {
    mod = await import(pathToFileURL(resolve(KIT, 'tools/install/config-paths.mjs')).href);
    ok('config-paths module imports cleanly');
  } catch (err) {
    bad(`config-paths import failed: ${err?.message ?? err}`);
    return;
  }
  const { healPathList, migrateConfigPaths, LEGACY_PLATFORM_PREFIXES } = mod;

  // Allowlist contract.
  LEGACY_PLATFORM_PREFIXES.has('vibekit') && !LEGACY_PLATFORM_PREFIXES.has('src') && !LEGACY_PLATFORM_PREFIXES.has('contextkit')
    ? ok('allowlist = {vibekit}; src/contextkit are NOT legacy prefixes')
    : bad('LEGACY_PLATFORM_PREFIXES allowlist wrong');

  // Build a post-install target: contextkit/ exists, the legacy targets resolve.
  const target = mkdtempSync(resolve(tmpdir(), 'cdk-p0-'));
  for (const d of ['contextkit', 'contextkit/memory', 'contextkit/memory/decisions', 'contextkit/policy', 'contextkit/runtime', 'contextkit/runtime/hooks', 'contextkit/keep-if-exists']) {
    mkdirSync(resolve(target, d), { recursive: true });
  }
  // Files whose migrated targets must resolve for the fixture's legacy paths to heal.
  for (const f of ['contextkit/memory/SESSIONS.md', 'contextkit/policy/routing-policy.json']) {
    writeFileSync(resolve(target, f), '{}');
  }

  try {
    // 1. The core corruption case — legitimate paths must be untouched.
    const legit = ['src/', 'lib/', 'node_modules/', 'dist/', 'build/', 'coverage/'];
    const c1 = { n: 0 };
    const healed1 = healPathList(target, legit, c1);
    JSON.stringify(healed1) === JSON.stringify(legit) && c1.n === 0
      ? ok('legitimate project paths preserved (no collapse to contextkit/)')
      : bad(`P0 REGRESSION: ${JSON.stringify(legit)} → ${JSON.stringify(healed1)} (${c1.n} migrated)`);

    // 2. Empty-suffix can never produce a bare contextkit/.
    healPathList(target, ['vibekit/'], { n: 0 })[0] === 'vibekit/'
      ? ok('empty-suffix vibekit/ is NOT rewritten to bare contextkit/')
      : bad('empty-suffix vibekit/ collapsed to contextkit/');

    // 3. A genuine legacy prefix with a resolvable target IS migrated.
    const c3 = { n: 0 };
    const legacy = ['vibekit/memory/decisions', 'vibekit/policy', 'vibekit/runtime/hooks'];
    const healed3 = healPathList(target, legacy, c3);
    JSON.stringify(healed3) === JSON.stringify(['contextkit/memory/decisions', 'contextkit/policy', 'contextkit/runtime/hooks']) && c3.n === 3
      ? ok('genuine vibekit/ paths migrate to contextkit/ when target resolves')
      : bad(`legacy migration wrong: ${JSON.stringify(healed3)} (${c3.n})`);

    // 4. Legacy prefix whose target does NOT resolve is left alone (no guess).
    healPathList(target, ['vibekit/does-not-exist'], { n: 0 })[0] === 'vibekit/does-not-exist'
      ? ok('legacy path with unresolvable target left untouched (no guess)')
      : bad('legacy path rewritten to a nonexistent target');

    // 5. Globs / URLs / absolute / Windows / variables are never touched.
    const exotic = ['*.log', 'tmp/**', 'https://example.com/x', '/etc/hosts', 'C:\\Users\\me', '$HOME/cfg', '~/notes', 'src/{a,b}'];
    JSON.stringify(healPathList(target, exotic, { n: 0 })) === JSON.stringify(exotic)
      ? ok('globs, URLs, absolute, Windows and variable paths preserved')
      : bad('an exotic (glob/URL/absolute/var) path was rewritten');

    // 6. Full fixture migrate + idempotency (second pass is a no-op).
    const cfg = v280Fixture();
    const r1 = migrateConfigPaths(target, cfg);
    const snap = JSON.stringify(cfg);
    const r2 = migrateConfigPaths(target, cfg);
    r1 > 0 && r2 === 0 && JSON.stringify(cfg) === snap
      ? ok(`fixture migrate idempotent (${r1} healed, 2nd pass 0, no diff)`)
      : bad(`fixture migration not idempotent: pass1=${r1} pass2=${r2}`);

    // 7. Order + custom section preserved in the fixture.
    cfg.ledger.important[0] === 'src/' && cfg.ledger.important.indexOf('contextkit/policy/routing-policy.json') === 7 && Array.isArray(cfg.custom.mine)
      ? ok('list order + unknown sections preserved through migration')
      : bad('migration reordered a list or dropped an unknown section');

    // 8. Non-array input returned untouched.
    healPathList(target, undefined, { n: 0 }) === undefined && healPathList(target, 'x', { n: 0 }) === 'x'
      ? ok('non-array path lists pass through untouched')
      : bad('non-array input mangled');
  } finally {
    rmSync(target, { recursive: true, force: true });
  }

  await runDoctorHealthChecks({ ok, bad }, { KIT });
}

/** Healthy v3.0.0 config (legit paths) vs corrupted (collapsed to bare contextkit/). */
function corruptFixture() {
  return { level: 6, ledger: { important: ['contextkit/', 'contextkit/', 'contextkit/'], registration: ['contextkit/memory/SESSIONS.md'] }, qa: { criticalPaths: ['src/'] } };
}
function healthyFixture() {
  return { level: 6, ledger: { important: ['src/', 'lib/', 'dist/'], registration: ['contextkit/memory/SESSIONS.md'] }, qa: { criticalPaths: ['src/'] } };
}

/**
 * Validates the doctor config-health detector + safe recovery states.
 * @param {{ ok: Function, bad: Function }} report
 * @param {{ KIT: string }} ctx
 */
async function runDoctorHealthChecks({ ok, bad }, { KIT }) {
  let h;
  try {
    h = await import(pathToFileURL(resolve(KIT, 'templates/contextkit/tools/scripts/config-health.mjs')).href);
    ok('config-health module imports cleanly');
  } catch (err) {
    bad(`config-health import failed: ${err?.message ?? err}`);
    return;
  }
  const { detectConfigCorruption, planRepair, runConfigHealth, CONFIG_HEALTH_STATES: S } = h;

  // Detection: healthy vs corrupted.
  detectConfigCorruption(healthyFixture()).status === S.HEALTHY
    ? ok('doctor: healthy config → healthy') : bad('doctor: healthy config misflagged');
  const det = detectConfigCorruption(corruptFixture());
  det.status === S.SUSPECTED && det.suspiciousCount === 3 && det.findings[0].collapsed
    ? ok('doctor: collapsed contextkit/ entries → suspected_corruption (3 found, collapsed)')
    : bad(`doctor: corruption detection wrong: ${JSON.stringify(det)}`);

  // planRepair: no backup → manual; healthy backup → repairable + restores lists.
  planRepair(corruptFixture(), null).status === S.MANUAL
    ? ok('doctor: corruption without backup → manual_repair_required')
    : bad('doctor: missing-backup case not manual');
  const plan = planRepair(corruptFixture(), healthyFixture());
  plan.status === S.REPAIRABLE && JSON.stringify(plan.restored.ledger.important) === JSON.stringify(['src/', 'lib/', 'dist/'])
    ? ok('doctor: healthy backup → repairable, path lists restored deterministically')
    : bad(`doctor: backup repair plan wrong: ${JSON.stringify(plan)}`);
  // A corrupted backup is not trusted.
  planRepair(corruptFixture(), corruptFixture()).status === S.MANUAL
    ? ok('doctor: corrupted backup is rejected (manual, never trusts damage)')
    : bad('doctor: corrupted backup was trusted');
  // A "healthy" backup that OMITS the corrupted list cannot repair it — must be manual,
  // never a false 'repaired' over a still-corrupt config (constitution §8; Agent C P0 finding).
  const listless = planRepair(corruptFixture(), { level: 6, setup: { completed: true } });
  listless.status === S.MANUAL && listless.restored === null
    ? ok('doctor: healthy-but-listless backup → manual (no false repair over corruption)')
    : bad(`doctor: listless backup wrongly accepted: ${JSON.stringify(listless.status)}`);

  // End-to-end on disk: corrupt config + healthy .bak → dry-run repairable, then --repair applies.
  const root = mkdtempSync(resolve(tmpdir(), 'cdk-doc-'));
  try {
    mkdirSync(resolve(root, 'contextkit'), { recursive: true });
    writeFileSync(resolve(root, 'contextkit/config.json'), JSON.stringify(corruptFixture()));
    writeFileSync(resolve(root, 'contextkit/config.json.bak'), JSON.stringify(healthyFixture()));
    const dry = runConfigHealth(root, { repair: false });
    dry.status === S.REPAIRABLE && dry.repair.applied === false
      ? ok('doctor: dry-run reports repairable, writes nothing')
      : bad(`doctor: dry-run wrong: ${JSON.stringify(dry.status)}/${dry.repair?.applied}`);
    const applied = runConfigHealth(root, { repair: true });
    const after = JSON.parse(readFileSync(resolve(root, 'contextkit/config.json'), 'utf8'));
    applied.status === S.REPAIRED && JSON.stringify(after.ledger.important) === JSON.stringify(['src/', 'lib/', 'dist/']) && existsSync(resolve(root, 'contextkit/config.json.corrupt'))
      ? ok('doctor: --repair restores from backup atomically + preserves .corrupt evidence')
      : bad(`doctor: repair did not restore correctly: ${JSON.stringify(applied.status)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  // On-disk: --repair with a healthy-but-listless backup must NOT report repaired,
  // and must leave the corrupt config untouched (no false 'repaired' on disk).
  const root2 = mkdtempSync(resolve(tmpdir(), 'cdk-doc3-'));
  try {
    mkdirSync(resolve(root2, 'contextkit'), { recursive: true });
    writeFileSync(resolve(root2, 'contextkit/config.json'), JSON.stringify(corruptFixture()));
    writeFileSync(resolve(root2, 'contextkit/config.json.bak'), JSON.stringify({ level: 6, setup: { completed: true } }));
    const res = runConfigHealth(root2, { repair: true });
    const cfgAfter = JSON.parse(readFileSync(resolve(root2, 'contextkit/config.json'), 'utf8'));
    res.status === S.MANUAL && res.repair.applied === false && JSON.stringify(cfgAfter.ledger.important) === JSON.stringify(['contextkit/', 'contextkit/', 'contextkit/'])
      ? ok('doctor: listless backup on disk → manual, config left untouched (no false repair)')
      : bad(`doctor: listless backup repaired falsely: ${JSON.stringify(res.status)}/${res.repair?.applied}`);
  } finally {
    rmSync(root2, { recursive: true, force: true });
  }

  // Missing/invalid config is skipped, never a false positive.
  const empty = mkdtempSync(resolve(tmpdir(), 'cdk-doc2-'));
  try {
    runConfigHealth(empty, { repair: false }).status === S.SKIPPED
      ? ok('doctor: missing config.json → skipped (no false positive)')
      : bad('doctor: missing config not skipped');
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
}
