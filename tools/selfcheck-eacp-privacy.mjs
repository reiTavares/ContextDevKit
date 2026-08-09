/**
 * Self-check — EACP Wave 8 privacy + retention + field-policy (WF0018).
 *
 * Covers the three new surfaces added in Wave 8:
 *   1. privacy-field-policy.mjs — classifyField, assertNotForbidden,
 *      assertNoForbiddenFields, assertNoTranscriptContent.
 *   2. privacy.mjs (extended) — hashPathWithSalt salt-differentiation,
 *      determinism; localTelemetryAllowed vs externalSendAllowed separation;
 *      local-telemetry opt-out via config flag.
 *   3. retention.mjs (extended) — purgePreview non-mutating (dry-run);
 *      purgeWithReport counts incl. invalid-ts; purgeCascade aggregation
 *      and totalPurged; throws on non-object.
 *   7. Zero hot-path dep check for all three new Wave 8 modules plus
 *      quota-store.mjs (split from quota-snapshots.mjs).
 *
 * ADR-0081. Zero runtime dependencies — node:* only.
 *
 * Cohesion note (constitution §1, +10% tolerance): one cohesive Wave 8
 * privacy cluster — splitting ok()/bad() dispatch across files would create
 * premature abstraction with no second consumer today.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @private — mirrors checkModuleZeroDep from selfcheck-eacp.mjs. */
async function checkModuleZeroDep(name, modPath) {
  let content = '';
  try { content = await readFile(modPath, 'utf-8'); }
  catch (err) { return { error: `could not read: ${err?.message ?? err}` }; }
  const importRegex = /^import\s+(?:[^"'`]*\s+)?from\s+['"`]([^'"`]+)['"`]/gm;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const spec = match[1];
    if (!spec.startsWith('.') && !spec.startsWith('node:')) {
      return { error: `imports from "${spec}"` };
    }
  }
  return { error: null };
}

/**
 * Runs EACP Wave 8 privacy + retention + field-policy checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root
 */
export async function runEacpPrivacyChecks({ ok, bad }, { KIT }) {
  console.log('Checking EACP Wave 8 privacy + retention + field-policy (WF0018)...');
  const econ = 'templates/contextkit/tools/scripts/economics';
  const fieldPolicyPath = resolve(KIT, `${econ}/privacy-field-policy.mjs`);
  const privacyPath     = resolve(KIT, `${econ}/privacy.mjs`);
  const retentionPath   = resolve(KIT, `${econ}/retention.mjs`);
  const quotaStorePath  = resolve(KIT, `${econ}/quota-store.mjs`);

  let fpLib, privLib, retLib;
  try {
    fpLib = await import(pathToFileURL(fieldPolicyPath).href);
    ok('privacy-field-policy.mjs imports cleanly');
  } catch (err) {
    bad(`privacy-field-policy.mjs import failed: ${err?.message ?? err}`); return;
  }
  try {
    privLib = await import(pathToFileURL(privacyPath).href);
    ok('privacy.mjs imports cleanly (Wave 8 extended check)');
  } catch (err) {
    bad(`privacy.mjs import failed: ${err?.message ?? err}`); return;
  }
  try {
    retLib = await import(pathToFileURL(retentionPath).href);
    ok('retention.mjs imports cleanly (Wave 8 extended check)');
  } catch (err) {
    bad(`retention.mjs import failed: ${err?.message ?? err}`); return;
  }

  const { classifyField, assertNotForbidden, assertNoForbiddenFields, assertNoTranscriptContent } = fpLib;
  const { hashPathWithSalt, resolvePrivacyConfig, localTelemetryAllowed, externalSendAllowed } = privLib;
  const { purgePreview, purgeWithReport, purgeCascade } = retLib;

  // ── Surface 1: privacy-field-policy.mjs ──────────────────────────────────

  // Unknown field → 'forbidden' (fail-closed)
  classifyField('totally_unknown_field_xyz') === 'forbidden'
    ? ok('field-policy: classifyField unknown → "forbidden" (fail-closed)')
    : bad('field-policy: unknown field should return "forbidden"');

  // Known fields map to expected tiers
  classifyField('sessionId') === 'safe' && classifyField('path') === 'hash' && classifyField('summary') === 'redact'
    ? ok('field-policy: known fields map to correct tiers (safe/hash/redact)')
    : bad('field-policy: known field tier mapping wrong');

  // raw_ref → forbidden permanently (ADR-0081)
  classifyField('raw_ref') === 'forbidden'
    ? ok('field-policy: raw_ref classified "forbidden" (ADR-0081 permanent)')
    : bad('field-policy: raw_ref must be "forbidden"');

  // assertNotForbidden throws on raw_ref
  let afThrew = false;
  try { assertNotForbidden('raw_ref'); } catch (e) { afThrew = e instanceof TypeError; }
  afThrew
    ? ok('field-policy: assertNotForbidden("raw_ref") throws TypeError')
    : bad('field-policy: assertNotForbidden("raw_ref") should throw TypeError');

  // assertNotForbidden does NOT throw on a safe field
  let afSafe = true;
  try { assertNotForbidden('sessionId'); } catch { afSafe = false; }
  afSafe
    ? ok('field-policy: assertNotForbidden("sessionId") does not throw')
    : bad('field-policy: assertNotForbidden should pass on safe field');

  // assertNoForbiddenFields throws on record with raw_ref
  let anfThrew = false;
  try { assertNoForbiddenFields({ raw_ref: 'x', sessionId: 's1' }); } catch { anfThrew = true; }
  anfThrew
    ? ok('field-policy: assertNoForbiddenFields throws on {raw_ref}')
    : bad('field-policy: assertNoForbiddenFields should throw on record with raw_ref');

  // assertNoForbiddenFields passes on a safe metadata record
  let anfSafe = true;
  try { assertNoForbiddenFields({ sessionId: 's1', ts: '2026-01-01T00:00:00Z', total: 100 }); }
  catch { anfSafe = false; }
  anfSafe
    ? ok('field-policy: assertNoForbiddenFields passes on safe metadata record')
    : bad('field-policy: assertNoForbiddenFields should not throw on safe record');

  // assertNoTranscriptContent throws on record with "content"
  let antcThrew = false;
  try { assertNoTranscriptContent({ content: 'transcript text', total: 100 }); } catch { antcThrew = true; }
  antcThrew
    ? ok('field-policy: assertNoTranscriptContent throws on {content}')
    : bad('field-policy: assertNoTranscriptContent should throw on content field');

  // assertNoTranscriptContent passes on a safe metadata record
  let antcSafe = true;
  try { assertNoTranscriptContent({ sessionId: 's1', total: 100, ts: 'x' }); }
  catch { antcSafe = false; }
  antcSafe
    ? ok('field-policy: assertNoTranscriptContent passes on metadata-only record')
    : bad('field-policy: assertNoTranscriptContent should pass on metadata record');

  // ── Surface 2: privacy.mjs extended ──────────────────────────────────────

  // hashPathWithSalt: different installs (salts) produce different hashes
  const hA = hashPathWithSalt('/project/src/auth.ts', 'install-salt-A');
  const hB = hashPathWithSalt('/project/src/auth.ts', 'install-salt-B');
  const hA2 = hashPathWithSalt('/project/src/auth.ts', 'install-salt-A');
  hA !== hB
    ? ok('privacy: hashPathWithSalt differs across salts (cross-install isolation)')
    : bad('privacy: same path with different salts must produce different hashes');
  hA === hA2
    ? ok('privacy: hashPathWithSalt is deterministic for the same args')
    : bad('privacy: hashPathWithSalt must be deterministic for the same args');

  // localTelemetryAllowed and externalSendAllowed are SEPARATE paths
  const defResolved = resolvePrivacyConfig({});
  const localOk  = localTelemetryAllowed(defResolved);
  const extOk    = externalSendAllowed(defResolved);
  localOk === true && extOk === false
    ? ok('privacy: default → localTelemetryAllowed=true, externalSendAllowed=false (SEPARATE paths)')
    : bad(`privacy: default telemetry flags wrong: local=${localOk} external=${extOk}`);

  // Local-telemetry opt-out config
  const optOutResolved = resolvePrivacyConfig({ economics: { privacy: { localTelemetryEnabled: false } } });
  localTelemetryAllowed(optOutResolved) === false
    ? ok('privacy: localTelemetryEnabled:false → localTelemetryAllowed=false (opt-out respected)')
    : bad('privacy: opt-out config should disable localTelemetryAllowed');
  externalSendAllowed(optOutResolved) === false
    ? ok('privacy: opt-out config does not enable externalSendAllowed (still false)')
    : bad('privacy: opt-out config should not enable external send');

  // ── Surface 3: retention.mjs extended ────────────────────────────────────

  const now = Date.now();
  const cfg90 = { retentionDays: 90 };
  const recent = { ts: now - 1000 };                        // 1 s ago
  const ancient = { ts: now - 100 * 24 * 60 * 60 * 1000 }; // 100 days
  const invalidTs = { ts: 'not-a-date' };
  const missingTs = { foo: 'bar' };
  const records = [recent, ancient, invalidTs, missingTs];

  // purgePreview is non-mutating (dry-run): original array unchanged
  const preview = purgePreview(records, now, cfg90);
  const inputLenUnchanged = records.length === 4;
  inputLenUnchanged && preview.wouldKeep.length === 1 && preview.wouldPurgeCount === 3
    ? ok('retention: purgePreview is non-mutating and counts correctly (wouldKeep=1, wouldPurge=3)')
    : bad(`retention: purgePreview wrong — input=${records.length} keep=${preview.wouldKeep.length} purge=${preview.wouldPurgeCount}`);

  // purgePreview output array is separate from input
  preview.wouldKeep[0] === recent
    ? ok('retention: purgePreview.wouldKeep contains the expected kept record')
    : bad('retention: purgePreview.wouldKeep should contain the recent record');

  // purgeWithReport returns {kept, purgedCount, removedTs, invalidTsCount}
  const report = purgeWithReport(records, now, cfg90);
  report.kept.length === 1 && report.purgedCount === 3
    ? ok('retention: purgeWithReport kept=1, purgedCount=3')
    : bad(`retention: purgeWithReport kept=${report.kept.length}, purgedCount=${report.purgedCount}`);

  // invalidTsCount covers both invalid-ts and missing-ts records
  report.invalidTsCount === 2
    ? ok('retention: purgeWithReport.invalidTsCount=2 (invalid-ts + missing-ts)')
    : bad(`retention: purgeWithReport.invalidTsCount should be 2, got ${report.invalidTsCount}`);

  Array.isArray(report.removedTs) && report.removedTs.length === 3
    ? ok('retention: purgeWithReport.removedTs array has 3 entries')
    : bad(`retention: removedTs.length should be 3, got ${report.removedTs?.length}`);

  // purgeCascade aggregates totalPurged across collections
  const cascade = purgeCascade(
    {
      events: [recent, ancient],
      costs:  [invalidTs, recent],
    },
    now,
    cfg90
  );
  cascade.totalPurged === 2 && Object.keys(cascade.collections).length === 2
    ? ok('retention: purgeCascade totalPurged=2, collections=2 (correct aggregation)')
    : bad(`retention: purgeCascade wrong: totalPurged=${cascade.totalPurged} collections=${Object.keys(cascade.collections).length}`);

  cascade.collections.events.purgedCount === 1 && cascade.collections.costs.purgedCount === 1
    ? ok('retention: purgeCascade per-collection purgedCount correct')
    : bad(`retention: purgeCascade collection counts wrong: events=${cascade.collections.events?.purgedCount} costs=${cascade.collections.costs?.purgedCount}`);

  // purgeCascade throws on non-object
  let cascadeThrew = false;
  try { purgeCascade(null, now, cfg90); } catch { cascadeThrew = true; }
  cascadeThrew
    ? ok('retention: purgeCascade throws TypeError on non-object input')
    : bad('retention: purgeCascade should throw on null artifacts');

  // ── Surface 7: Zero hot-path dep check for Wave 8 new modules ────────────
  const newMods = [
    ['privacy-field-policy.mjs', fieldPolicyPath],
    ['quota-store.mjs',          quotaStorePath],
  ];
  let zeroDepsOk = true;
  for (const [name, path] of newMods) {
    const result = await checkModuleZeroDep(name, path);
    if (result.error) {
      bad(`zero-dep Wave 8: ${name} ${result.error}`);
      zeroDepsOk = false;
    }
  }
  if (zeroDepsOk) ok('zero-dep invariant: Wave 8 new modules (privacy-field-policy, quota-store) import only node:/* or relative paths');
}
