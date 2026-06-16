#!/usr/bin/env node
/**
 * CDK-076 self-check — engineering scorecard (pure core + I/O + CLI).
 *
 * (1) scoreDimensions PURE: mixed present+null → correct scored/skipped split;
 *     §8 SAFETY: null input → status:'skipped', score:null, NOT 0, NOT in overall mean.
 * (2) Fixture with ≥2 scored dims: active card + passed receipt scores
 *     lineage-completeness + receipt-pass-rate (+ evidence-coverage + rule-health).
 * (3) §8 SAFETY: benchmark with no ledger is skipped, score null, excluded from overall.
 * (4) overall.confidence reflects scoredCount per thresholds.
 * (5) CLI `--json` exits 0 + parseable JSON; §8 guard on skipped dims in output.
 *
 * Standalone: node tools/selfcheck-pkg07-076.mjs. Exit 0 = pass, 1 = fail.
 * Zero runtime deps — node:* only.
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync, execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dirname, '..');
const CORE_URL = pathToFileURL(resolve(KIT, 'templates/contextkit/tools/scripts/engineering-scorecard-core.mjs')).href;
const IO_PATH  = resolve(KIT, 'templates/contextkit/tools/scripts/engineering-scorecard.mjs');
const IO_URL   = pathToFileURL(IO_PATH).href;

let failures = 0;
const ok  = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { console.error(`  ✗ ${msg}`); failures += 1; };

// Import pure core
let scoreDimensions;
try {
  ({ scoreDimensions } = await import(CORE_URL));
  ok('engineering-scorecard-core.mjs imports cleanly');
} catch (err) {
  console.error(`FATAL: cannot import engineering-scorecard-core.mjs: ${err?.message ?? err}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// (1) Pure scoreDimensions — handcrafted mixed inputs
// ---------------------------------------------------------------------------
console.log('\n(1) Pure scoreDimensions — mixed present + null inputs\n');

const sampleGraph = {
  nodes: [
    { id: 'card:CDK-001', type: 'card', ref: { stage: 'working' } },
    { id: 'receipt:CDK-001/r', type: 'receipt', ref: { result: 'passed' } },
  ],
  edges: [{ from: 'card:CDK-001', to: 'receipt:CDK-001/r', rel: 'attests' }],
  stats: {},
};
const mixedResult = scoreDimensions({ lineageGraph: sampleGraph,
  calibration: null, rules: null, taxonomy: null, compliance: null, benchmark: null });

const lcDim  = mixedResult.dimensions.find((d) => d.key === 'lineage-completeness');
const rrDim  = mixedResult.dimensions.find((d) => d.key === 'receipt-pass-rate');
const calDim = mixedResult.dimensions.find((d) => d.key === 'calibration');
const bchDim = mixedResult.dimensions.find((d) => d.key === 'benchmark-completion');

(lcDim?.status === 'scored' && typeof lcDim.score === 'number')
  ? ok(`lineage-completeness scored: ${lcDim.score}`)
  : bad(`lineage-completeness should be scored, got ${JSON.stringify(lcDim)}`);
(rrDim?.status === 'scored' && typeof rrDim.score === 'number')
  ? ok(`receipt-pass-rate scored: ${rrDim.score}`)
  : bad(`receipt-pass-rate should be scored, got ${JSON.stringify(rrDim)}`);

// §8 SAFETY: null inputs must produce status:'skipped' and score:null, NEVER 0
for (const [label, dim] of [['calibration', calDim], ['benchmark-completion', bchDim]]) {
  if (!dim) { bad(`${label} dimension missing`); continue; }
  dim.status === 'skipped'
    ? ok(`${label}: status=skipped (null input)`)
    : bad(`${label}: expected status=skipped, got ${dim.status}`);
  dim.score === null
    ? ok(`${label}: score=null (NOT 0) — §8 safe`)
    : bad(`${label}: expected score=null, got ${dim.score} — §8 VIOLATION`);
}

// §8 SAFETY: overall.score equals the mean of ONLY scored dims
const scoredInMixed = mixedResult.dimensions.filter((d) => d.status === 'scored');
const expectedMean  = scoredInMixed.reduce((s, d) => s + d.score, 0) / scoredInMixed.length;
Math.abs((mixedResult.overall.score ?? 0) - expectedMean) < 0.1
  ? ok(`overall.score=${mixedResult.overall.score} equals scored-only mean (≈${expectedMean.toFixed(1)})`)
  : bad(`overall.score ${mixedResult.overall.score} deviates from scored-only mean ${expectedMean.toFixed(1)}`);
mixedResult.overall.scoredCount === scoredInMixed.length
  ? ok(`overall.scoredCount=${mixedResult.overall.scoredCount} excludes ${mixedResult.dimensions.filter((d) => d.status === 'skipped').length} skipped`)
  : bad(`overall.scoredCount=${mixedResult.overall.scoredCount} != scored count ${scoredInMixed.length}`);

// ---------------------------------------------------------------------------
// (2) Fixture: ≥2 scored dimensions via real disk fixture
// ---------------------------------------------------------------------------
console.log('\n(2) Fixture with ≥2 scored dimensions (active card + passed receipt)\n');

function buildFixtureRoot() {
  const root = resolve(tmpdir(), `selfcheck-pkg07-076-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  try { execSync('git init -b main', { cwd: root, stdio: 'pipe' }); }
  catch { try { execSync('git init', { cwd: root, stdio: 'pipe' }); } catch { /* best-effort */ } }
  const ck = (rel) => resolve(root, 'contextkit', rel);
  for (const stage of ['backlog', 'working', 'testing', 'conclusion']) mkdirSync(ck(`pipeline/${stage}`), { recursive: true });
  writeFileSync(ck('pipeline/working/CDK-SCORE-01-test.md'),
    `---\nid: CDK-SCORE-01\ntitle: Scorecard test card\ntype: feature\npriority: P1\n---\n`);
  mkdirSync(ck('pipeline/state/CDK-SCORE-01/receipts'), { recursive: true });
  writeFileSync(ck('pipeline/state/CDK-SCORE-01/state.json'), JSON.stringify({
    kind: 'task', id: 'CDK-SCORE-01', status: 'working', ownerSessionId: '1',
    ownerUser: 'test', branch: 'main', startedAt: Date.now(), lastHeartbeat: Date.now(),
    endedAt: null, cycles: {}, events: [],
  }, null, 2));
  writeFileSync(ck('pipeline/state/CDK-SCORE-01/receipts/test-run.json'), JSON.stringify({
    version: 1, capability: 'test-run', taskId: 'CDK-SCORE-01', sessionId: '1',
    runId: 'run-001', command: 'node', host: 'claude-code', result: 'passed',
    evidence: { exitCode: 0 }, scope: { branch: 'main' },
    fingerprint: 'abc123', createdAt: Date.now(), expiresAt: Date.now() + 86400000,
  }, null, 2));
  mkdirSync(ck('memory/sessions'), { recursive: true });
  mkdirSync(ck('memory/decisions'), { recursive: true });
  return root;
}

function cleanFixture(root) {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
}

let engineeringScorecard;
try {
  ({ engineeringScorecard } = await import(IO_URL));
  ok('engineering-scorecard.mjs imports cleanly');
} catch (err) {
  bad(`cannot import engineering-scorecard.mjs: ${err?.message ?? err}`);
  process.exit(1);
}

let fixtureRoot, scorecardResult;
try {
  fixtureRoot = buildFixtureRoot();
  scorecardResult = await engineeringScorecard(fixtureRoot);
  ok('engineeringScorecard on fixture: no throw');
} catch (err) {
  bad(`engineeringScorecard threw: ${err?.message ?? err}`);
  process.exit(1);
}

const scoredDims = scorecardResult.dimensions.filter((d) => d.status === 'scored');
scoredDims.length >= 2
  ? ok(`≥2 dimensions scored (got ${scoredDims.length}): ${scoredDims.map((d) => d.key).join(', ')}`)
  : bad(`expected ≥2 scored dimensions, got ${scoredDims.length}`);

// §8 SAFETY: every skipped dim in fixture must have score null, NOT 0
for (const dim of scorecardResult.dimensions.filter((d) => d.status === 'skipped')) {
  dim.score === null
    ? ok(`fixture skipped '${dim.key}': score=null — §8 safe`)
    : bad(`fixture skipped '${dim.key}': score=${dim.score} should be null — §8 VIOLATION`);
}

// ---------------------------------------------------------------------------
// (3) §8 SAFETY: benchmark (no ledger) skipped and excluded from overall mean
// ---------------------------------------------------------------------------
console.log('\n(3) §8 SAFETY — benchmark with no ledger is skipped, excluded from overall\n');

const bchFix = scorecardResult.dimensions.find((d) => d.key === 'benchmark-completion');
if (!bchFix) {
  bad('benchmark-completion dimension missing from fixture result');
} else {
  bchFix.status === 'skipped'
    ? ok('benchmark-completion (no ledger): status=skipped')
    : bad(`benchmark-completion: expected skipped, got ${bchFix.status}`);
  bchFix.score === null
    ? ok('benchmark-completion: score=null (NOT 0) — §8 safe')
    : bad(`benchmark-completion: score=${bchFix.score} should be null — §8 VIOLATION`);
  // overall.score must equal mean of ONLY the scored dims
  const fixScored = scorecardResult.dimensions.filter((d) => d.status === 'scored');
  if (fixScored.length > 0) {
    const expOv = fixScored.reduce((s, d) => s + d.score, 0) / fixScored.length;
    Math.abs((scorecardResult.overall.score ?? 0) - expOv) < 0.2
      ? ok(`overall.score=${scorecardResult.overall.score} is scored-only mean ≈${expOv.toFixed(1)} (benchmark excluded)`)
      : bad(`overall.score ${scorecardResult.overall.score} deviates from scored-only mean ${expOv.toFixed(1)}`);
  }
}
cleanFixture(fixtureRoot);

// ---------------------------------------------------------------------------
// (4) overall.confidence reflects scoredCount
// ---------------------------------------------------------------------------
console.log('\n(4) overall.confidence reflects scoredCount\n');

function assertConf(label, inp, expected) {
  const res = scoreDimensions(inp);
  const { confidence, scoredCount } = res.overall;
  confidence === expected
    ? ok(`${label}: scoredCount=${scoredCount} → confidence='${confidence}'`)
    : bad(`${label}: expected '${expected}', got '${confidence}' (scoredCount=${scoredCount})`);
}

assertConf('all-null → none', { lineageGraph: null, calibration: null, rules: null, taxonomy: null, compliance: null, benchmark: null }, 'none');
// 1 receipt node, no attests → only receipt-pass-rate scores
assertConf('1 scored → low', { lineageGraph: {
  nodes: [{ id: 'card:X', type: 'card', ref: { stage: 'working' } }, { id: 'receipt:X/r', type: 'receipt', ref: { result: 'passed' } }],
  edges: [], stats: {},
}, calibration: null, rules: null, taxonomy: null, compliance: null, benchmark: null }, 'low');
assertConf('4 scored → medium', { lineageGraph: null,
  calibration: { overall: { accuracy: 0.8 } },
  rules: { summary: { pass: 8, fail: 2, skipped: 0 } },
  taxonomy: null,
  compliance: { total: 10, parity: 8, gaps: 2 },
  benchmark: { count: 5, completedCount: 4, totalTokens: 1000, tokensPerCompletedTask: 250 },
}, 'medium');
// All 7 dims — use a full graph to also score lineage dims
const fullGraph = { nodes: [
  { id: 'card:A', type: 'card', ref: { stage: 'testing' } },
  { id: 'receipt:A/r', type: 'receipt', ref: { result: 'passed' } },
], edges: [{ from: 'card:A', to: 'receipt:A/r', rel: 'attests' }], stats: {} };
const allRes = scoreDimensions({ lineageGraph: fullGraph,
  calibration: { overall: { accuracy: 0.9 } },
  rules: { summary: { pass: 5, fail: 0, skipped: 0 } },
  taxonomy: { coverage: { receipts: 2, unknownKinds: [] } },
  compliance: { total: 8, parity: 8, gaps: 0 },
  benchmark: { count: 3, completedCount: 3, totalTokens: 900, tokensPerCompletedTask: 300 } });
const { scoredCount: allN, confidence: allConf } = allRes.overall;
const expectedAllConf = allN >= 5 ? 'high' : allN >= 3 ? 'medium' : allN >= 1 ? 'low' : 'none';
allConf === expectedAllConf
  ? ok(`all inputs: scoredCount=${allN} → confidence='${allConf}' (correct per thresholds)`)
  : bad(`all inputs: expected '${expectedAllConf}', got '${allConf}' (scoredCount=${allN})`);

// ---------------------------------------------------------------------------
// (5) CLI: --json exits 0 + parseable JSON
// ---------------------------------------------------------------------------
console.log('\n(5) CLI: --json exits 0 and produces parseable JSON\n');

const cliResult = spawnSync(process.execPath, [IO_PATH, '--json'], { cwd: tmpdir(), encoding: 'utf-8', timeout: 60_000 });

cliResult.status === 0
  ? ok('CLI: exit code 0')
  : bad(`CLI: expected exit 0, got ${cliResult.status}; stderr: ${cliResult.stderr?.slice(0, 200)}`);

let parsedCli = null;
try { parsedCli = JSON.parse(cliResult.stdout); ok('CLI: stdout is valid JSON'); }
catch (err) { bad(`CLI: not parseable JSON: ${err?.message ?? err}`); }

if (parsedCli) {
  typeof parsedCli.schemaVersion === 'number'      ? ok(`CLI JSON: schemaVersion=${parsedCli.schemaVersion}`) : bad('CLI JSON: missing schemaVersion');
  Array.isArray(parsedCli.dimensions)              ? ok(`CLI JSON: dimensions[${parsedCli.dimensions.length}]`) : bad('CLI JSON: expected dimensions[]');
  typeof parsedCli.overall === 'object'            ? ok('CLI JSON: overall object present') : bad('CLI JSON: missing overall');
  Array.isArray(parsedCli.sources?.present)        ? ok('CLI JSON: sources.present[] present') : bad('CLI JSON: missing sources.present[]');
  // §8 guard: no skipped dimension may have a non-null score
  const badCliDims = (parsedCli.dimensions ?? []).filter((d) => d.status === 'skipped' && d.score !== null);
  badCliDims.length === 0
    ? ok('CLI JSON §8: all skipped dimensions have score=null')
    : bad(`CLI JSON §8 VIOLATION: ${badCliDims.map((d) => d.key).join(', ')} have non-null score`);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(failures === 0
  ? '\n  PASS — CDK-076 engineering-scorecard self-check: all checks passed.\n'
  : `\n  FAIL — CDK-076 engineering-scorecard self-check: ${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
