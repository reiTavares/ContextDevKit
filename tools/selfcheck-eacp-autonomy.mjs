/**
 * Self-check — EACP Wave 5 quota snapshots + autonomy multiplier (cards #240/#241).
 *
 * Asserts both modules are internally sound:
 * - Schema version constants (quota + autonomy).
 * - buildSnapshot: host-required skip; confidence 'unknown'/'inferred'/'direct';
 *   capturedAt from opts.now; capturedAt null when opts absent.
 * - appendSnapshot + readSnapshots round-trip through a mkdtempSync temp file.
 * - appendSnapshot throws on a skipped marker; readSnapshots on missing file → [].
 * - quotaSummary: empty → skipped; populated → hosts count + latest array.
 * - presentQuota: skipped vs populated string.
 * - usefulAutonomy: true case + each negative guard (bypass, rollback, reopen,
 *   missing field, unlogged human intervention); logged intervention → true.
 * - usefulReasons: non-empty for bad task; empty for good task.
 * - countUseful: greenCount vs excluded; non-array → graceful empty.
 * - selectUnit: quota primary; fallback to first available substitute; null when none.
 * - autonomyMultiplier: derived (quota), inferred (substitute), skipped (null baseline).
 *   claim === null ALWAYS (#242 pending). Ratio ≈ 1.667 verified.
 * - AUTONOMY_TARGETS: {pilot:1.30, product:1.50, potential:1.70} exact.
 * - multiplierSummary: skipped (empty) vs populated (schema + useful + rate).
 * - presentAutonomy: skipped → "skipped"; populated → contains "target".
 * - Zero-dep invariant on both new modules.
 *
 * Mirrors the structure of selfcheck-eacp-pressure.mjs exactly.
 * Cohesion note (constitution §1, +10% tolerance): one cohesive assertion suite
 * for a single wave; splitting ok()/bad() across files is premature abstraction.
 * Zero runtime dependencies — node:* only.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @private — copy from selfcheck-eacp-pressure.mjs (not exported there). */
async function checkModuleZeroDep(name, modPath) {
  let content = '';
  try { content = await readFile(modPath, 'utf-8'); }
  catch (err) { return { error: `could not read: ${err?.message ?? err}` }; }
  const importRegex = /^import\s+(?:[^"'`]*\s+)?from\s+['"`]([^'"`]+)['"`]/gm;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const spec = match[1];
    if (!spec.startsWith('.') && !spec.startsWith('node:')) return { error: `imports from "${spec}"` };
  }
  return { error: null };
}

/**
 * Runs EACP Wave 5 (quota snapshots + autonomy multiplier) checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root
 */
export async function runEacpAutonomyChecks({ ok, bad }, { KIT }) {
  console.log('Checking EACP Wave 5 quota snapshots + autonomy multiplier (cards #240/#241)...');
  const econ = 'templates/contextkit/tools/scripts/economics';
  const quotaPath    = resolve(KIT, `${econ}/quota-snapshots.mjs`);
  const autonomyPath = resolve(KIT, `${econ}/autonomy-multiplier.mjs`);

  let quotaLib, autonomyLib;
  try { quotaLib = await import(pathToFileURL(quotaPath).href); ok('quota-snapshots.mjs imports cleanly'); }
  catch (err) { bad(`quota-snapshots.mjs import failed: ${err?.message ?? err}`); return; }
  try { autonomyLib = await import(pathToFileURL(autonomyPath).href); ok('autonomy-multiplier.mjs imports cleanly'); }
  catch (err) { bad(`autonomy-multiplier.mjs import failed: ${err?.message ?? err}`); return; }

  const { QUOTA_SNAPSHOT_SCHEMA_VERSION, CAPTURE_METHODS,
          buildSnapshot, appendSnapshot, readSnapshots, quotaSummary, presentQuota } = quotaLib;
  const { AUTONOMY_MULTIPLIER_SCHEMA_VERSION, AUTONOMY_TARGETS,
          usefulAutonomy, usefulReasons, countUseful, selectUnit,
          autonomyMultiplier, multiplierSummary, presentAutonomy } = autonomyLib;

  // ── Schema version constants ──────────────────────────────────────────────
  QUOTA_SNAPSHOT_SCHEMA_VERSION === 'eacp-quota-snapshot/1'
    ? ok('quota: QUOTA_SNAPSHOT_SCHEMA_VERSION === "eacp-quota-snapshot/1"')
    : bad(`quota: QUOTA_SNAPSHOT_SCHEMA_VERSION is "${QUOTA_SNAPSHOT_SCHEMA_VERSION}"`);
  AUTONOMY_MULTIPLIER_SCHEMA_VERSION === 'eacp-autonomy-multiplier/1'
    ? ok('autonomy: AUTONOMY_MULTIPLIER_SCHEMA_VERSION === "eacp-autonomy-multiplier/1"')
    : bad(`autonomy: AUTONOMY_MULTIPLIER_SCHEMA_VERSION is "${AUTONOMY_MULTIPLIER_SCHEMA_VERSION}"`);

  // ── buildSnapshot ─────────────────────────────────────────────────────────
  buildSnapshot({})?.status === 'skipped'
    ? ok('buildSnapshot: {} → skipped (host required)')
    : bad('buildSnapshot: missing host should skip');

  const snapU = buildSnapshot({ host: 'x', captureMethod: 'manual' });
  snapU.confidence === 'unknown' && snapU.remainingPct === null && snapU.usedPct === null
    ? ok('buildSnapshot: host+manual, no pct → confidence "unknown", pcts null')
    : bad(`buildSnapshot: expected unknown/null, got ${JSON.stringify(snapU)}`);

  buildSnapshot({ host: 'x', remainingPct: 40, captureMethod: 'manual' }).confidence === 'inferred'
    ? ok('buildSnapshot: manual+remainingPct → confidence "inferred"')
    : bad('buildSnapshot: expected "inferred"');

  buildSnapshot({ host: 'x', usedPct: 60, captureMethod: 'api' }).confidence === 'direct'
    ? ok('buildSnapshot: api+usedPct → confidence "direct"')
    : bad('buildSnapshot: expected "direct"');

  buildSnapshot({ host: 'x', remainingPct: 40 }, { now: 123 }).capturedAt === 123
    ? ok('buildSnapshot: opts.now=123 → capturedAt===123')
    : bad('buildSnapshot: opts.now should stamp capturedAt');

  buildSnapshot({ host: 'x', remainingPct: 40 }).capturedAt === null
    ? ok('buildSnapshot: no opts.now → capturedAt null (deterministic mode)')
    : bad('buildSnapshot: capturedAt should be null without opts.now');

  // ── appendSnapshot + readSnapshots round-trip ─────────────────────────────
  let tmpDir;
  try {
    tmpDir = mkdtempSync(join(tmpdir(), 'eacp-q-'));
    const tmpFile = join(tmpDir, 'quota.jsonl');
    const recA = buildSnapshot({ host: 'host-a', remainingPct: 75, captureMethod: 'manual' });
    const recB = buildSnapshot({ host: 'host-b', captureMethod: 'manual' });
    appendSnapshot(recA, tmpFile);
    appendSnapshot(recB, tmpFile);
    const records = readSnapshots(tmpFile);
    records.length === 2 && records[0].host === 'host-a' && records[0].confidence === 'inferred' &&
    records[1].host === 'host-b' && records[1].confidence === 'unknown'
      ? ok('quota: appendSnapshot+readSnapshots round-trip preserves host and confidence')
      : bad(`quota: round-trip result wrong: ${JSON.stringify(records)}`);
  } catch (err) {
    bad(`quota: round-trip threw: ${err?.message ?? err}`);
  } finally {
    if (tmpDir) { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ } }
  }

  // appendSnapshot throws on skipped marker
  let threw = false;
  try { appendSnapshot(buildSnapshot({}), '/tmp/nope.jsonl'); } catch { threw = true; }
  threw ? ok('appendSnapshot: throws on skipped marker (refuse-to-persist)')
        : bad('appendSnapshot: should throw on skipped marker');

  // readSnapshots: missing file → []
  Array.isArray(readSnapshots('/no/such/file.jsonl')) && readSnapshots('/no/such/file.jsonl').length === 0
    ? ok('readSnapshots: missing file → [] (never throws)')
    : bad('readSnapshots: missing file should return []');

  // ── quotaSummary + presentQuota ───────────────────────────────────────────
  const sumE = quotaSummary([]);
  sumE?.status === 'skipped'
    ? ok('quotaSummary: [] → skipped') : bad(`quotaSummary: empty should skip, got ${JSON.stringify(sumE)}`);

  const snapA = buildSnapshot({ host: 'claude', remainingPct: 50, captureMethod: 'api' });
  const snapB = buildSnapshot({ host: 'cursor', remainingPct: 20, captureMethod: 'manual' });
  const sumP = quotaSummary([snapA, snapB]);
  sumP.hosts === 2 && sumP.latest?.length === 2
    ? ok('quotaSummary: populated → hosts===2, latest.length===2')
    : bad(`quotaSummary: populated wrong: ${JSON.stringify(sumP)}`);

  presentQuota(sumE).includes('skipped')
    ? ok('presentQuota: skipped → string contains "skipped"')
    : bad('presentQuota: skipped output wrong');

  const popStr = presentQuota(sumP);
  popStr.includes('claude') && popStr.includes('cursor')
    ? ok('presentQuota: populated → contains host names')
    : bad(`presentQuota: missing host names: ${popStr.slice(0, 200)}`);

  // ── usefulAutonomy ────────────────────────────────────────────────────────
  const good = { acceptanceMet: true, testsRun: true, qaGreen: true };
  usefulAutonomy(good) === true
    ? ok('usefulAutonomy: acceptance+tests+QA → true') : bad('usefulAutonomy: good task should be true');
  usefulAutonomy({ ...good, criticalBypass: true }) === false
    ? ok('usefulAutonomy: criticalBypass → false (Goodhart guard)') : bad('usefulAutonomy: criticalBypass should block');
  usefulAutonomy({ ...good, immediateRollback: true }) === false
    ? ok('usefulAutonomy: immediateRollback → false') : bad('usefulAutonomy: rollback should block');
  usefulAutonomy({ ...good, materialErrorReopen: true }) === false
    ? ok('usefulAutonomy: materialErrorReopen → false') : bad('usefulAutonomy: reopen should block');
  usefulAutonomy({ acceptanceMet: true, testsRun: true }) === false
    ? ok('usefulAutonomy: missing qaGreen → false') : bad('usefulAutonomy: missing qaGreen should block');
  usefulAutonomy({ ...good, humanIntervention: true }) === false
    ? ok('usefulAutonomy: unlogged humanIntervention → false') : bad('usefulAutonomy: unlogged intervention should block');
  usefulAutonomy({ ...good, humanIntervention: true, humanInterventionLogged: true }) === true
    ? ok('usefulAutonomy: logged humanIntervention → true') : bad('usefulAutonomy: logged intervention should pass');

  // ── usefulReasons ─────────────────────────────────────────────────────────
  const badReasons = usefulReasons({ acceptanceMet: false, criticalBypass: true });
  Array.isArray(badReasons) && badReasons.length > 0
    ? ok('usefulReasons: bad task → non-empty reasons') : bad('usefulReasons: bad task should have reasons');
  Array.isArray(usefulReasons(good)) && usefulReasons(good).length === 0
    ? ok('usefulReasons: good task → empty (no exclusions)') : bad('usefulReasons: good task should have no reasons');

  // ── countUseful ───────────────────────────────────────────────────────────
  const mixedTasks = [good, good, { acceptanceMet: false }, { ...good, criticalBypass: true }];
  const counted = countUseful(mixedTasks);
  counted.greenCount === 2 && counted.total === 4 && counted.excluded.length === 2
    ? ok('countUseful: 4 tasks (2 green) → greenCount===2, excluded.length===2')
    : bad(`countUseful: wrong: ${JSON.stringify(counted)}`);
  const cn = countUseful(null);
  cn.greenCount === 0 && cn.total === 0
    ? ok('countUseful: non-array → empty result (graceful degrade)')
    : bad(`countUseful: non-array should be empty, got ${JSON.stringify(cn)}`);

  // ── selectUnit ────────────────────────────────────────────────────────────
  selectUnit(true, ['effective-mtok']) === 'quota'
    ? ok('selectUnit: quotaObservable=true → "quota" (primary)') : bad('selectUnit: primary unit wrong');
  selectUnit(false, ['effective-mtok']) === 'effective-mtok'
    ? ok('selectUnit: quotaObservable=false, available→fallback "effective-mtok"') : bad('selectUnit: fallback wrong');
  selectUnit(false, []) === null
    ? ok('selectUnit: quotaObservable=false, no available → null') : bad('selectUnit: empty available should be null');

  // ── autonomyMultiplier ────────────────────────────────────────────────────
  const mD = autonomyMultiplier({ qaGreen: 10, units: 5 }, { qaGreen: 6, units: 5 }, { unit: 'quota' });
  Math.abs(mD.multiplier - (10 / 5) / (6 / 5)) < 0.001
    ? ok('autonomyMultiplier: (10/5)/(6/5) ≈ 1.667 — ratio correct') : bad(`autonomyMultiplier: ratio wrong: ${mD.multiplier}`);
  mD.confidence === 'derived'
    ? ok('autonomyMultiplier: unit="quota" → confidence "derived"') : bad(`autonomyMultiplier: expected "derived", got "${mD.confidence}"`);
  mD.claim === null
    ? ok('autonomyMultiplier: claim===null ALWAYS (unbenchmarked, #242 pending)') : bad('autonomyMultiplier: claim must be null');

  const mI = autonomyMultiplier({ qaGreen: 10, units: 5 }, { qaGreen: 6, units: 5 }, { unit: 'effective-mtok' });
  mI.confidence === 'inferred'
    ? ok('autonomyMultiplier: substitute unit → confidence "inferred"') : bad(`autonomyMultiplier: expected "inferred", got "${mI.confidence}"`);
  mI.claim === null
    ? ok('autonomyMultiplier: claim===null on substitute unit') : bad('autonomyMultiplier: claim must be null on substitute');

  autonomyMultiplier({ qaGreen: 10, units: 5 }, null, { unit: 'quota' })?.status === 'skipped'
    ? ok('autonomyMultiplier: null baseline → skipped (constitution §8 refuse)')
    : bad('autonomyMultiplier: null baseline should skip');

  // ── AUTONOMY_TARGETS ──────────────────────────────────────────────────────
  AUTONOMY_TARGETS.pilot === 1.30 && AUTONOMY_TARGETS.product === 1.50 && AUTONOMY_TARGETS.potential === 1.70
    ? ok('AUTONOMY_TARGETS: {pilot:1.30, product:1.50, potential:1.70} exact (targets, not claims)')
    : bad(`AUTONOMY_TARGETS wrong: ${JSON.stringify(AUTONOMY_TARGETS)}`);

  // ── multiplierSummary ─────────────────────────────────────────────────────
  multiplierSummary({})?.status === 'skipped'
    ? ok('multiplierSummary: {} → skipped (insufficient signals)')
    : bad('multiplierSummary: empty input should skip');

  const sumFull = multiplierSummary({
    tasks: [good, good, { acceptanceMet: false }],
    withKit: { qaGreen: 10, units: 5 }, baseline: { qaGreen: 6, units: 5 },
    quotaObservable: true,
  });
  sumFull.schemaVersion === AUTONOMY_MULTIPLIER_SCHEMA_VERSION &&
  sumFull.useful?.greenCount === 2 && sumFull.multiplier?.confidence === 'derived'
    ? ok('multiplierSummary: populated → schemaVersion, useful.greenCount===2, rate derived')
    : bad(`multiplierSummary: populated wrong: ${JSON.stringify(sumFull)}`);

  // ── presentAutonomy ───────────────────────────────────────────────────────
  presentAutonomy(multiplierSummary({})).includes('skipped')
    ? ok('presentAutonomy: skipped → string contains "skipped"')
    : bad('presentAutonomy: skipped output wrong');

  presentAutonomy(sumFull).toLowerCase().includes('target')
    ? ok('presentAutonomy: populated → contains "target" (goal framing, not claim)')
    : bad('presentAutonomy: populated output should contain "target"');

  // ── Zero-dep invariant ────────────────────────────────────────────────────
  let zeroDepsOk = true;
  for (const [name, path] of [['quota-snapshots.mjs', quotaPath], ['autonomy-multiplier.mjs', autonomyPath]]) {
    const result = await checkModuleZeroDep(name, path);
    if (result.error) { bad(`zero-dep Wave 5: ${name} ${result.error}`); zeroDepsOk = false; }
  }
  if (zeroDepsOk) ok('zero-dep invariant: both Wave 5 modules import only node:/* or relative paths');

  // ── Surface 5 (Wave 8): fingerprintSnapshot determinism ──────────────────
  const { fingerprintSnapshot } = quotaLib;
  const fpRec = buildSnapshot({ host: 'fp-h', remainingPct: 42, captureMethod: 'manual' });
  const fp1 = fingerprintSnapshot(fpRec);
  fp1 === fingerprintSnapshot({ ...fpRec }) && typeof fp1 === 'string' && fp1.length === 12
    ? ok('quota: fingerprintSnapshot deterministic (12-char hex)')
    : bad(`quota: fingerprintSnapshot not deterministic or wrong length: fp=${fp1}`);
  fp1 !== fingerprintSnapshot(buildSnapshot({ host: 'fp-h', remainingPct: 99, captureMethod: 'manual' }))
    ? ok('quota: fingerprintSnapshot differs for different identity tuples')
    : bad('quota: different tuples must produce different fingerprints');
  // Full Wave 8 quota-store surface (idempotent, transcript rejection, linkage,
  // claude-code host guard) lives in selfcheck-eacp-quota-store.mjs.
}
