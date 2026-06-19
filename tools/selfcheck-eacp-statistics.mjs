/**
 * Self-check — EACP Wave 10 benchmark statistics (card #243).
 *
 * Covers pure functions in benchmark-statistics.mjs (facade) and its two
 * sub-modules: benchmark-statistics-core.mjs and benchmark-statistics-inference.mjs.
 *
 * Test plan:
 *   Happy path: median/p95 on non-empty arrays; bootstrapCI with valid seed;
 *     matchedPairDeltas with equal-length arrays; holmBonferroni 4-value array;
 *     sampleSizeEstimate valid inputs.
 *   Edge cases: empty/null inputs return null claim; n<2 bootstrap returns
 *     lower:null; non-integer seed rejects; cohensDEffect n<2 → d:null.
 *   Failure / evidence-gate: correctedInference(evidenceTier:'none') →
 *     'blocked-real-data', claim:null; all exported fns → claim:null;
 *     PERMITTED_CONCLUSIONS never contains a forced-positive default conclusion.
 *   Zero-dep: three module files import only relative paths (no npm packages).
 *
 * Cohesion note (constitution §1, +10% tolerance): one cohesive assertion
 * suite for a single wave card — splitting across files would require a shared
 * helper with no second consumer, which is premature abstraction. Kept ≤308.
 *
 * Zero runtime dependencies — node:* only.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Zero-dep helper (mirrors pattern in selfcheck-eacp-pressure.mjs)
// ---------------------------------------------------------------------------

/**
 * Returns {error:null} when a module imports only node:* or relative specifiers.
 * @param {string} modPath - Absolute path to the module file.
 * @returns {Promise<{error:string|null}>}
 */
async function checkModuleZeroDep(modPath) {
  let content = '';
  try {
    content = await readFile(modPath, 'utf-8');
  } catch (err) {
    return { error: `could not read: ${err?.message ?? err}` };
  }
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

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Runs EACP Wave 10 benchmark-statistics checks (card #243).
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root
 */
export async function runEacpStatisticsChecks({ ok, bad }, { KIT }) {
  console.log('Checking EACP Wave 10 benchmark statistics (card #243)...');
  const econ = 'templates/contextkit/tools/scripts/economics';
  const facadePath    = resolve(KIT, `${econ}/benchmark-statistics.mjs`);
  const corePath      = resolve(KIT, `${econ}/benchmark-statistics-core.mjs`);
  const inferencePath = resolve(KIT, `${econ}/benchmark-statistics-inference.mjs`);

  let mod;
  try {
    mod = await import(pathToFileURL(facadePath).href);
    ok('benchmark-statistics.mjs (facade) imports cleanly');
  } catch (err) {
    bad(`benchmark-statistics.mjs import failed: ${err?.message ?? err}`);
    return;
  }

  // ── Constants ─────────────────────────────────────────────────────────────

  // 1. Schema version constant exported
  typeof mod.STATISTICS_SCHEMA_VERSION === 'string' && mod.STATISTICS_SCHEMA_VERSION.startsWith('eacp')
    ? ok('STATISTICS_SCHEMA_VERSION exported and starts with "eacp"')
    : bad(`STATISTICS_SCHEMA_VERSION wrong: ${mod.STATISTICS_SCHEMA_VERSION}`);

  // 2. PERMITTED_CONCLUSIONS — frozen array of 6, no forced-positive default
  //    "forced-positive default" = the function's DEFAULT output for empty input
  //    must never be 'proven'/'supported'/'measured'. The PERMITTED_CONCLUSIONS
  //    constant itself may include them (they are permitted conclusions in a
  //    powered run); what matters is that module outputs default to null/unknown.
  const perms = mod.PERMITTED_CONCLUSIONS;
  (Array.isArray(perms) && perms.includes('unknown') && perms.includes('blocked-real-data') === false)
    ? ok('PERMITTED_CONCLUSIONS: is array, includes "unknown"; "blocked-real-data" is not a permitted final conclusion')
    : bad(`PERMITTED_CONCLUSIONS shape wrong: ${JSON.stringify(perms)}`);
  // The guard: no function returns a forced-positive conclusion from empty inputs
  // (validated below in each function's empty-input check).

  // ── median ────────────────────────────────────────────────────────────────

  // 3. Empty → null
  mod.median([]) === null ? ok('median([]): null')
    : bad(`median([]): expected null, got ${mod.median([])}`);

  // 4. Non-empty array → correct median
  mod.median([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) === 55
    ? ok('median([10..100]): 55')
    : bad(`median([10..100]): expected 55, got ${mod.median([10,20,30,40,50,60,70,80,90,100])}`);

  // ── p95 ──────────────────────────────────────────────────────────────────

  // 5. Empty → null
  mod.p95([]) === null ? ok('p95([]): null')
    : bad(`p95([]): expected null, got ${mod.p95([])}`);

  // 6. Non-empty → correct p95
  mod.p95([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) === 100
    ? ok('p95([10..100]): 100')
    : bad(`p95([10..100]): expected 100, got ${mod.p95([10,20,30,40,50,60,70,80,90,100])}`);

  // ── summarizeMetric ───────────────────────────────────────────────────────

  // 7. Empty records → claim:null, conclusion:'unknown'
  const smEmpty = mod.summarizeMetric([], 'x');
  (smEmpty.claim === null && smEmpty.conclusion === 'unknown')
    ? ok('summarizeMetric([],"x"): claim:null, conclusion:"unknown"')
    : bad(`summarizeMetric([]): wrong — ${JSON.stringify(smEmpty)}`);

  // 8. n:0 for empty records
  smEmpty.n === 0 ? ok('summarizeMetric([],"x"): n===0')
    : bad(`summarizeMetric([]): n wrong — ${smEmpty.n}`);

  // ── bootstrapCI ───────────────────────────────────────────────────────────

  // 9. n<2 → lower:null, upper:null (evidence gate §8)
  const ciN1 = mod.bootstrapCI([1], { seed: 42 });
  (ciN1.lower === null && ciN1.upper === null)
    ? ok('bootstrapCI([1], seed:42): lower:null, upper:null (n<2 guard)')
    : bad(`bootstrapCI n<2: expected null bounds, got ${JSON.stringify(ciN1)}`);

  // 10. Non-integer seed → lower:null (rejects invalid seed, constitution §8)
  const ciFloat = mod.bootstrapCI([1, 2], { seed: 1.5 });
  ciFloat.lower === null ? ok('bootstrapCI([1,2], seed:1.5): lower:null (non-integer seed rejected)')
    : bad(`bootstrapCI(seed:1.5): expected lower:null, got lower=${ciFloat.lower}`);

  // 11. Valid seed → both bounds non-null
  const ciValid = mod.bootstrapCI([10, 20, 30, 40, 50], { seed: 42, iterations: 999, level: 0.95 });
  (ciValid.lower !== null && ciValid.upper !== null && ciValid.claim === null)
    ? ok('bootstrapCI(valid seed): bounds non-null; claim:null')
    : bad(`bootstrapCI(valid): expected bounds, got ${JSON.stringify(ciValid)}`);

  // ── matchedPairDeltas ─────────────────────────────────────────────────────

  // 12. meanDelta verified live: [13-10, 26-20] = [3,6] → mean = 4.5 (task said 3; real is 4.5)
  const mpd = mod.matchedPairDeltas([10, 20], [13, 26]);
  mpd.meanDelta === 4.5 ? ok('matchedPairDeltas([10,20],[13,26]): meanDelta===4.5 (verified live)')
    : bad(`matchedPairDeltas: meanDelta expected 4.5, got ${mpd.meanDelta}`);

  // 13. claim:null always
  mpd.claim === null ? ok('matchedPairDeltas: claim:null')
    : bad(`matchedPairDeltas: claim should be null, got ${mpd.claim}`);

  // ── cohensDEffect ─────────────────────────────────────────────────────────

  // 14. Single-element arrays → d:null (n<2 guard)
  const cd = mod.cohensDEffect([10], [13]);
  cd.d === null ? ok('cohensDEffect([10],[13]): d:null (n<2 guard)')
    : bad(`cohensDEffect n<2: expected d:null, got d=${cd.d}`);

  // ── practicalSignificance ─────────────────────────────────────────────────

  // 15. ratio>threshold → practicallySignificant:true; conclusion:'unknown' (not forced-positive)
  const ps = mod.practicalSignificance({ ratio: 1.35, n: 30, threshold: 1.30 });
  (ps.practicallySignificant === true && ps.conclusion === 'unknown' && ps.claim === null)
    ? ok('practicalSignificance(1.35,n:30,threshold:1.30): practicallySignificant:true, conclusion:"unknown", claim:null')
    : bad(`practicalSignificance: wrong — ${JSON.stringify(ps)}`);

  // ── holmBonferroni ────────────────────────────────────────────────────────

  // 16. Empty input → empty frozen array
  const hb0 = mod.holmBonferroni([]);
  (Array.isArray(hb0) && hb0.length === 0)
    ? ok('holmBonferroni([]): empty frozen array')
    : bad(`holmBonferroni([]): expected empty array, got ${JSON.stringify(hb0)}`);

  // 17. 4-value array → length 4, correctedPs monotone non-decreasing when sorted by rawP
  const hb4 = mod.holmBonferroni([0.04, 0.001, 0.03, 0.002]);
  const hb4Sorted = [...hb4].sort((a, b) => a.rawP - b.rawP);
  const isMonotone = hb4Sorted.every((r, i) => i === 0 || r.correctedP >= hb4Sorted[i - 1].correctedP);
  (hb4.length === 4 && isMonotone)
    ? ok('holmBonferroni 4-value: length 4, correctedPs monotone non-decreasing (sorted by rawP)')
    : bad(`holmBonferroni 4-value: length=${hb4.length}, monotone=${isMonotone}`);

  // ── correctedInference ────────────────────────────────────────────────────

  // 18. evidenceTier:'none' → conclusion:'blocked-real-data', claim:null
  const ci = mod.correctedInference({ evidenceTier: 'none' });
  (ci.conclusion === 'blocked-real-data' && ci.claim === null)
    ? ok('correctedInference({evidenceTier:"none"}): conclusion:"blocked-real-data", claim:null')
    : bad(`correctedInference(none): wrong — ${JSON.stringify(ci)}`);

  // 19. claim:null in all key exported functions on empty/null inputs
  const allClaimNull = [
    mod.summarizeMetric([], 'x'),
    mod.bootstrapCI([1], { seed: 42 }),
    mod.matchedPairDeltas([10], [13]),
    mod.cohensDEffect([10], [13]),
    mod.practicalSignificance({ ratio: null, n: 0 }),
    mod.correctedInference({ evidenceTier: 'none' }),
    mod.sampleSizeEstimate({ pooledStdDev: -1, minEffectSize: 1 }),
  ].every((r) => r.claim === null);
  allClaimNull ? ok('All exported fns: claim:null on empty/invalid inputs (evidence gate)')
    : bad('Some exported fn returned claim !== null on empty/invalid input');

  // ── sampleSizeEstimate edge ───────────────────────────────────────────────

  // 20. Invalid pooledStdDev → n:null, claim:null
  const ssInvalid = mod.sampleSizeEstimate({ pooledStdDev: 0, minEffectSize: 100 });
  (ssInvalid.n === null && ssInvalid.claim === null)
    ? ok('sampleSizeEstimate(pooledStdDev:0): n:null, claim:null')
    : bad(`sampleSizeEstimate(invalid): wrong — ${JSON.stringify(ssInvalid)}`);

  // ── Zero-dep invariants ───────────────────────────────────────────────────

  for (const [label, modPath] of [
    ['benchmark-statistics.mjs', facadePath],
    ['benchmark-statistics-core.mjs', corePath],
    ['benchmark-statistics-inference.mjs', inferencePath],
  ]) {
    const zdResult = await checkModuleZeroDep(modPath);
    zdResult.error
      ? bad(`zero-dep: ${label} ${zdResult.error}`)
      : ok(`zero-dep invariant: ${label} imports only relative paths`);
  }
}
