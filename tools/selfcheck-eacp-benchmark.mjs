/**
 * Self-check — EACP Wave 6 benchmark pilot harness (card #242 / EACP-13).
 *
 * Asserts the three benchmark modules are internally sound AND honest:
 * - benchmark-design: schema version; ARMS A/B/C; PILOT_ARMS === ['A','C'];
 *   BENCHMARK_TARGETS {pilot:1.30, full:1.50, potential:1.70}; buildRunSpec
 *   skips on missing controls / no valid arm; pilotSpec forces A-vs-C;
 *   capturedAt null without opts.now, stamped with it.
 * - benchmark-run: MOCK_PROVIDER deterministic + labeled mock; runArm skips with
 *   no provider and for an arm not in spec; mock run → confidence 'mock',
 *   claim null, qaOutcome 'unknown'; appendRun/readRuns round-trip; appendRun
 *   refuses a skipped marker; readRuns missing file → [].
 * - benchmark-report: scoreRun → 'unknown' when evaluator absent / equals
 *   operator / run is mock / no acceptance; 'pass' on independent+acceptance;
 *   comparePilot → 'unknown' on mock/missing arms, ratio≈1.667 (claim STILL
 *   null) on real arms; benchmarkReport counts + claim null; presentBenchmark
 *   strings; claim===null EVERYWHERE.
 * - Zero-dep invariant on all three modules.
 *
 * Cohesion note (constitution §1, +10% tolerance): one cohesive assertion suite
 * for a single wave; registered in selfcheck-eacp-all.mjs, NOT selfcheck.mjs.
 * Zero runtime dependencies — node:* only.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @private — zero-dep import scan (copied; not exported by sibling runners). */
async function checkModuleZeroDep(modPath) {
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
 * Runs EACP Wave 6 benchmark harness checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root
 */
export async function runEacpBenchmarkChecks({ ok, bad }, { KIT }) {
  console.log('Checking EACP Wave 6 benchmark pilot harness (card #242)...');
  const econ = 'templates/contextkit/tools/scripts/economics';
  const designPath = resolve(KIT, `${econ}/benchmark-design.mjs`);
  const runPath    = resolve(KIT, `${econ}/benchmark-run.mjs`);
  const reportPath = resolve(KIT, `${econ}/benchmark-report.mjs`);

  let design, run, report;
  try { design = await import(pathToFileURL(designPath).href); ok('benchmark-design.mjs imports cleanly'); }
  catch (err) { bad(`benchmark-design.mjs import failed: ${err?.message ?? err}`); return; }
  try { run = await import(pathToFileURL(runPath).href); ok('benchmark-run.mjs imports cleanly'); }
  catch (err) { bad(`benchmark-run.mjs import failed: ${err?.message ?? err}`); return; }
  try { report = await import(pathToFileURL(reportPath).href); ok('benchmark-report.mjs imports cleanly'); }
  catch (err) { bad(`benchmark-report.mjs import failed: ${err?.message ?? err}`); return; }

  const { BENCHMARK_SCHEMA_VERSION, ARMS, PILOT_ARMS, TASK_STRATA,
          BENCHMARK_TARGETS, buildRunSpec, pilotSpec,
          CACHE_WARMTH, MIN_REPS_PER_CELL, shuffleCells } = design;
  const { MOCK_PROVIDER, runArm, runPilot, runCell, appendRun, readRuns } = run;
  const { scoreRun, comparePilot, benchmarkReport, presentBenchmark,
          withinCellVariance } = report;

  // ── benchmark-design: constants ───────────────────────────────────────────
  BENCHMARK_SCHEMA_VERSION === 'eacp-benchmark/1'
    ? ok('design: BENCHMARK_SCHEMA_VERSION === "eacp-benchmark/1"')
    : bad(`design: schema version is "${BENCHMARK_SCHEMA_VERSION}"`);
  ARMS.A === 'pure-host' && ARMS.B === 'compozy' && ARMS.C === 'contextdevkit'
    ? ok('design: ARMS A=pure-host, B=compozy, C=contextdevkit')
    : bad(`design: ARMS wrong: ${JSON.stringify(ARMS)}`);
  Array.isArray(PILOT_ARMS) && PILOT_ARMS.length === 2 && PILOT_ARMS[0] === 'A' && PILOT_ARMS[1] === 'C'
    ? ok('design: PILOT_ARMS === ["A","C"] (Compozy/B deferred — panel M6)')
    : bad(`design: PILOT_ARMS wrong: ${JSON.stringify(PILOT_ARMS)}`);
  BENCHMARK_TARGETS.pilot === 1.30 && BENCHMARK_TARGETS.full === 1.50 && BENCHMARK_TARGETS.potential === 1.70
    ? ok('design: BENCHMARK_TARGETS {pilot:1.30, full:1.50, potential:1.70} (targets, not claims)')
    : bad(`design: BENCHMARK_TARGETS wrong: ${JSON.stringify(BENCHMARK_TARGETS)}`);
  Array.isArray(TASK_STRATA) && TASK_STRATA.includes('small-bug') && TASK_STRATA.includes('architectural')
    ? ok('design: TASK_STRATA stratified (includes small-bug + architectural)')
    : bad('design: TASK_STRATA missing expected strata');

  // ── benchmark-design: builders ────────────────────────────────────────────
  buildRunSpec({ repo: 'r' })?.status === 'skipped'
    ? ok('design: buildRunSpec missing controls → skipped') : bad('design: missing controls should skip');
  buildRunSpec({ repo: 'r', commit: 'c', task: 't', model: 'm', host: 'h', arms: ['Z'] })?.status === 'skipped'
    ? ok('design: buildRunSpec no valid arm → skipped') : bad('design: invalid arm should skip');

  const fullInput = { repo: 'r', commit: 'c1', task: 't', model: 'opus', host: 'claude', stratum: 'small-bug' };
  const spec = pilotSpec(fullInput, { now: 100 });
  spec.status !== 'skipped' && spec.arms.length === 2 && spec.arms[0] === 'A' && spec.arms[1] === 'C'
    ? ok('design: pilotSpec forces arms to A-vs-C') : bad(`design: pilotSpec arms wrong: ${JSON.stringify(spec.arms)}`);
  spec.capturedAt === 100 && spec.stratum === 'small-bug' && spec.targets.pilot === 1.30
    ? ok('design: pilotSpec stamps capturedAt from opts.now + records stratum/targets')
    : bad(`design: pilotSpec fields wrong: ${JSON.stringify(spec).slice(0, 160)}`);
  pilotSpec(fullInput).capturedAt === null
    ? ok('design: pilotSpec capturedAt null without opts.now (deterministic)') : bad('design: capturedAt should be null without now');

  // ── benchmark-run: MOCK_PROVIDER determinism ──────────────────────────────
  const o1 = MOCK_PROVIDER.execute(spec, 'A');
  const o2 = MOCK_PROVIDER.execute(spec, 'A');
  MOCK_PROVIDER.id === 'mock' && o1.provider === 'mock' && o1.mockTokens === o2.mockTokens && o1.qaOutcome === 'unknown'
    ? ok('run: MOCK_PROVIDER deterministic + labeled mock + qaOutcome "unknown"')
    : bad(`run: MOCK_PROVIDER not deterministic/labeled: ${JSON.stringify(o1)}`);

  // ── benchmark-run: runArm ─────────────────────────────────────────────────
  runArm(spec, 'A')?.status === 'skipped'
    ? ok('run: runArm no provider → skipped (real runs deferred, no #176 baseline)') : bad('run: no provider should skip');
  runArm(spec, 'B', { provider: MOCK_PROVIDER })?.status === 'skipped'
    ? ok('run: runArm arm not in spec → skipped') : bad('run: arm-not-in-spec should skip');
  runArm({ status: 'skipped' }, 'A', { provider: MOCK_PROVIDER })?.status === 'skipped'
    ? ok('run: runArm on skipped spec → skipped') : bad('run: skipped spec should skip');

  const mockRun = runArm(spec, 'A', { provider: MOCK_PROVIDER, now: 100, operator: 'op1' });
  mockRun.confidence === 'mock' && mockRun.claim === null && mockRun.qaOutcome === 'unknown' && mockRun.operator === 'op1'
    ? ok('run: mock runArm → confidence "mock", claim null, qaOutcome "unknown"')
    : bad(`run: mock runArm wrong: ${JSON.stringify(mockRun).slice(0, 160)}`);

  const pilot = runPilot(spec, { provider: MOCK_PROVIDER, operator: 'op1' });
  Array.isArray(pilot) && pilot.length === 2 && pilot.every((r) => r.confidence === 'mock' && r.claim === null)
    ? ok('run: runPilot → 2 mock arms, all claim null') : bad(`run: runPilot wrong: ${JSON.stringify(pilot).slice(0, 160)}`);

  // ── benchmark-run: persistence round-trip ─────────────────────────────────
  let tmpDir;
  try {
    tmpDir = mkdtempSync(join(tmpdir(), 'eacp-bench-'));
    const file = join(tmpDir, 'runs.jsonl');
    appendRun(mockRun, file);
    appendRun(runArm(spec, 'C', { provider: MOCK_PROVIDER, operator: 'op1' }), file);
    const recs = readRuns(file);
    recs.length === 2 && recs[0].arm === 'A' && recs[1].arm === 'C' && recs.every((r) => r.claim === null)
      ? ok('run: appendRun+readRuns round-trip preserves arms (claim null)')
      : bad(`run: round-trip wrong: ${JSON.stringify(recs).slice(0, 160)}`);
  } catch (err) {
    bad(`run: round-trip threw: ${err?.message ?? err}`);
  } finally {
    if (tmpDir) { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ } }
  }

  let threw = false;
  try { appendRun({ status: 'skipped' }, '/tmp/nope.jsonl'); } catch { threw = true; }
  threw ? ok('run: appendRun throws on skipped marker (refuse-to-persist)') : bad('run: appendRun should throw on skipped');
  readRuns('/no/such/file.jsonl').length === 0
    ? ok('run: readRuns missing file → [] (never throws)') : bad('run: readRuns missing file should be []');

  // ── benchmark-report: scoreRun independence ───────────────────────────────
  scoreRun(mockRun, { acceptancePass: true }, {}).verdict === 'unknown'
    ? ok('report: scoreRun no evaluator → "unknown"') : bad('report: missing evaluator should be unknown');
  scoreRun(mockRun, { acceptancePass: true }, { evaluator: 'op1' }).verdict === 'unknown'
    ? ok('report: scoreRun evaluator===operator → "unknown" (not independent)') : bad('report: same operator should be unknown');
  scoreRun(mockRun, { acceptancePass: true }, { evaluator: 'rev' }).verdict === 'unknown'
    ? ok('report: scoreRun mock run → "unknown" (not a real measurement)') : bad('report: mock run should be unknown');
  const realRun = { schemaVersion: 'eacp-benchmark-run/1', arm: 'C', confidence: 'unknown', operator: 'op1', claim: null };
  scoreRun(realRun, {}, { evaluator: 'rev' }).verdict === 'unknown'
    ? ok('report: scoreRun no acceptance result → "unknown" (insufficient evidence)') : bad('report: no acceptance should be unknown');
  const passV = scoreRun(realRun, { acceptancePass: true, deterministicSuitePass: true }, { evaluator: 'rev' });
  passV.verdict === 'pass' && passV.claim === null
    ? ok('report: scoreRun independent + acceptance pass → "pass" (claim null)') : bad(`report: should pass: ${JSON.stringify(passV)}`);
  scoreRun(realRun, { acceptancePass: false }, { evaluator: 'rev' }).verdict === 'fail'
    ? ok('report: scoreRun acceptance fail → "fail"') : bad('report: acceptance fail should be fail');

  // ── benchmark-report: comparePilot ────────────────────────────────────────
  comparePilot({ A: { qaGreen: 6, units: 5, mock: true }, C: { qaGreen: 10, units: 5 } }).confidence === 'unknown'
    ? ok('report: comparePilot mock arm → confidence "unknown"') : bad('report: mock arm should be unknown');
  comparePilot({ C: { qaGreen: 10, units: 5 } }).confidence === 'unknown'
    ? ok('report: comparePilot missing arm → "unknown"') : bad('report: missing arm should be unknown');
  const cmp = comparePilot({ A: { qaGreen: 6, units: 5 }, C: { qaGreen: 10, units: 5 } });
  Math.abs(cmp.ratio - (10 / 5) / (6 / 5)) < 0.001 && cmp.claim === null
    ? ok('report: comparePilot real arms → ratio≈1.667, claim STILL null (#243 pending)')
    : bad(`report: comparePilot real wrong: ${JSON.stringify(cmp)}`);

  // ── benchmark-report: report + presentation ───────────────────────────────
  const rep = benchmarkReport([mockRun, runArm(spec, 'A')], cmp);
  rep.runs === 2 && rep.mockRuns === 1 && rep.skippedRuns === 1 && rep.claim === null
    ? ok('report: benchmarkReport counts mock/skipped + claim null')
    : bad(`report: benchmarkReport wrong: ${JSON.stringify(rep).slice(0, 160)}`);
  presentBenchmark(rep).includes('claim: null') && presentBenchmark(rep).toLowerCase().includes('target')
    ? ok('report: presentBenchmark surfaces "claim: null" + targets framing')
    : bad('report: presentBenchmark missing honesty framing');
  presentBenchmark(benchmarkReport([])).includes('no runs')
    ? ok('report: presentBenchmark empty → "no runs"') : bad('report: empty report presentation wrong');

  // ── Wave 9: CACHE_WARMTH + MIN_REPS_PER_CELL constants ───────────────────
  (Array.isArray(CACHE_WARMTH) && CACHE_WARMTH.includes('cold') &&
    CACHE_WARMTH.includes('warm') && CACHE_WARMTH.includes('unknown'))
    ? ok('design: CACHE_WARMTH includes cold/warm/unknown')
    : bad(`design: CACHE_WARMTH wrong: ${JSON.stringify(CACHE_WARMTH)}`);
  MIN_REPS_PER_CELL === 3
    ? ok('design: MIN_REPS_PER_CELL === 3')
    : bad(`design: MIN_REPS_PER_CELL is ${MIN_REPS_PER_CELL}, expected 3`);

  // ── Wave 9: pilotSpec / buildRunSpec carry cacheWarmth + minReps + maxBudgetUsd
  const wave9Input = { repo: 'r', commit: 'c1', task: 't', model: 'opus', host: 'claude' };
  const wave9Spec = design.pilotSpec(wave9Input);
  wave9Spec.cacheWarmth === 'unknown'
    ? ok('design: pilotSpec carries cacheWarmth default "unknown"')
    : bad(`design: pilotSpec.cacheWarmth wrong: ${wave9Spec.cacheWarmth}`);
  wave9Spec.minReps === MIN_REPS_PER_CELL
    ? ok('design: pilotSpec carries minReps === MIN_REPS_PER_CELL (3)')
    : bad(`design: pilotSpec.minReps wrong: ${wave9Spec.minReps}`);
  wave9Spec.maxBudgetUsd === null
    ? ok('design: pilotSpec maxBudgetUsd null when not supplied')
    : bad(`design: pilotSpec.maxBudgetUsd should be null, got ${wave9Spec.maxBudgetUsd}`);
  const w9Cold = design.buildRunSpec(
    { ...wave9Input, arms: ['A', 'C'], cacheWarmth: 'cold', minReps: 5, maxBudgetUsd: 99.9 },
  );
  w9Cold.cacheWarmth === 'cold' && w9Cold.minReps === 5 && w9Cold.maxBudgetUsd === 99.9
    ? ok('design: buildRunSpec carries cacheWarmth cold + raised minReps + maxBudgetUsd')
    : bad(`design: buildRunSpec wave9 fields wrong: ${JSON.stringify(w9Cold).slice(0, 160)}`);

  // ── Wave 9: runCell — minReps reps per cell, rep-indexed, cacheWarmth propagated
  const cellResult = runCell(wave9Spec, 'A', { provider: MOCK_PROVIDER });
  Array.isArray(cellResult) && cellResult.length === MIN_REPS_PER_CELL
    ? ok('run: runCell returns exactly minReps (3) records')
    : bad(`run: runCell length wrong: ${Array.isArray(cellResult) ? cellResult.length : cellResult?.status}`);
  (Array.isArray(cellResult) &&
    cellResult[0]?.rep === 1 && cellResult[1]?.rep === 2 && cellResult[2]?.rep === 3)
    ? ok('run: runCell records are rep-indexed 1..3')
    : bad(`run: runCell rep indices wrong: ${JSON.stringify((cellResult ?? []).map(r => r?.rep))}`);
  (Array.isArray(cellResult) && cellResult.every((r) => r.claim === null))
    ? ok('run: runCell all records carry claim null')
    : bad('run: runCell has record with non-null claim');
  (Array.isArray(cellResult) && cellResult.every((r) => r.cacheWarmth === wave9Spec.cacheWarmth))
    ? ok('run: runCell propagates cacheWarmth from spec onto every record')
    : bad(`run: runCell cacheWarmth mismatch: ${JSON.stringify((cellResult ?? []).map(r => r?.cacheWarmth))}`);
  runCell(wave9Spec, 'B', { provider: MOCK_PROVIDER })?.status === 'skipped'
    ? ok('run: runCell arm not in spec → skipped')
    : bad('run: runCell arm-not-in-spec should skip');

  // ── Wave 9: shuffleCells — deterministic LCG, no Math.random ─────────────
  const scArms  = ['A', 'C'];
  const scTasks = ['t1', 't2'];
  const scReps  = 3;
  const scSeed  = 42;
  const sc1 = shuffleCells(scArms, scTasks, scReps, scSeed);
  const sc2 = shuffleCells(scArms, scTasks, scReps, scSeed);
  JSON.stringify(sc1) === JSON.stringify(sc2)
    ? ok('design: shuffleCells same seed → same order (deterministic)')
    : bad('design: shuffleCells same seed gave different orders');
  const sc3 = shuffleCells(scArms, scTasks, scReps, 99);
  JSON.stringify(sc1) !== JSON.stringify(sc3)
    ? ok('design: shuffleCells different seed → different order')
    : bad('design: shuffleCells different seed gave same order (not randomizing)');
  sc1.length === scArms.length * scTasks.length * scReps
    ? ok(`design: shuffleCells total cells = arms×tasks×reps (${sc1.length})`)
    : bad(`design: shuffleCells total cells wrong: ${sc1.length}`);
  let scRepThrew = false;
  try { shuffleCells(scArms, scTasks, 2, scSeed); } catch { scRepThrew = true; }
  scRepThrew
    ? ok('design: shuffleCells throws on reps < MIN_REPS_PER_CELL')
    : bad('design: shuffleCells should throw when reps < 3');
  let scSeedThrew = false;
  try { shuffleCells(scArms, scTasks, scReps, Infinity); } catch { scSeedThrew = true; }
  scSeedThrew
    ? ok('design: shuffleCells throws on non-finite seed')
    : bad('design: shuffleCells should throw on non-finite seed');
  sc1.every((c) => c.cacheWarmth === 'unknown')
    ? ok('design: shuffleCells default cacheWarmth is "unknown" on all cells')
    : bad('design: shuffleCells default cacheWarmth not propagated');
  const scCold = shuffleCells(scArms, scTasks, scReps, scSeed, 'cold');
  scCold.every((c) => c.cacheWarmth === 'cold')
    ? ok('design: shuffleCells propagates explicit cacheWarmth "cold" to all cells')
    : bad('design: shuffleCells cold cacheWarmth not on all cells');

  // ── Wave 9: withinCellVariance ────────────────────────────────────────────
  const cellRecs = runCell(wave9Spec, 'A', { provider: MOCK_PROVIDER });
  const wv3 = withinCellVariance(Array.isArray(cellRecs) ? cellRecs : [], 'mockTokens');
  wv3.n === 3 && Number.isFinite(wv3.variance) && wv3.claim === null && wv3.confidence === 'mock'
    ? ok('report: withinCellVariance 3 reps → n=3, finite variance, claim null, confidence "mock"')
    : bad(`report: withinCellVariance 3-rep wrong: ${JSON.stringify(wv3)}`);
  const wv1 = withinCellVariance(Array.isArray(cellRecs) ? [cellRecs[0]] : [], 'mockTokens');
  wv1.n === 1 && wv1.variance === null
    ? ok('report: withinCellVariance single rep → variance null (never fabricated)')
    : bad(`report: withinCellVariance single-rep wrong: ${JSON.stringify(wv1)}`);
  const wv0 = withinCellVariance([], 'mockTokens');
  wv0.n === 0 && wv0.variance === null
    ? ok('report: withinCellVariance empty → n=0, variance null')
    : bad(`report: withinCellVariance empty wrong: ${JSON.stringify(wv0)}`);

  // ── Wave 9: benchmarkReport powerCalcFeed ────────────────────────────────
  const pRunsA = Array.isArray(cellRecs) ? cellRecs : [];
  const pRep = benchmarkReport(pRunsA);
  typeof pRep.powerCalcFeed === 'object' && pRep.powerCalcFeed !== null
    ? ok('report: benchmarkReport emits powerCalcFeed object')
    : bad(`report: benchmarkReport missing powerCalcFeed: ${JSON.stringify(pRep).slice(0, 160)}`);
  pRep.powerCalcFeed['A']?.n === pRunsA.length
    ? ok('report: benchmarkReport powerCalcFeed[A].n matches arm-A record count')
    : bad(`report: powerCalcFeed.A.n ${pRep.powerCalcFeed['A']?.n} !== ${pRunsA.length}`);
  pRep.claim === null
    ? ok('report: benchmarkReport claim === null (regression guard — Wave 9)')
    : bad(`report: benchmarkReport claim must be null, got ${pRep.claim}`);

  // ── Zero-dep invariant ────────────────────────────────────────────────────
  let zeroDepsOk = true;
  for (const [name, path] of [['benchmark-design.mjs', designPath], ['benchmark-run.mjs', runPath], ['benchmark-report.mjs', reportPath]]) {
    const result = await checkModuleZeroDep(path);
    if (result.error) { bad(`zero-dep Wave 6: ${name} ${result.error}`); zeroDepsOk = false; }
  }
  if (zeroDepsOk) ok('zero-dep invariant: all three Wave 6 modules import only node:/* or relative paths');
}
