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
          BENCHMARK_TARGETS, buildRunSpec, pilotSpec } = design;
  const { MOCK_PROVIDER, runArm, runPilot, appendRun, readRuns } = run;
  const { scoreRun, comparePilot, benchmarkReport, presentBenchmark } = report;

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

  // ── Zero-dep invariant ────────────────────────────────────────────────────
  let zeroDepsOk = true;
  for (const [name, path] of [['benchmark-design.mjs', designPath], ['benchmark-run.mjs', runPath], ['benchmark-report.mjs', reportPath]]) {
    const result = await checkModuleZeroDep(path);
    if (result.error) { bad(`zero-dep Wave 6: ${name} ${result.error}`); zeroDepsOk = false; }
  }
  if (zeroDepsOk) ok('zero-dep invariant: all three Wave 6 modules import only node:/* or relative paths');
}
