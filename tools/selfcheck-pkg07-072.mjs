#!/usr/bin/env node
/**
 * CDK-072 self-check — lineage-calibration pure aggregation + CLI integration.
 *
 * Asserts four invariants:
 *   (1) perWorkflow accuracy computed correctly for the seeded workflow
 *       (1 hit + 1 miss → 0.5 accuracy for the workflow).
 *   (2) overall.accuracy is correct across the seeded data (same 0.5).
 *   (3) Fail-open: a root with NO predictions dir → sources.skipped includes
 *       'predictions', overall.accuracy === null, no throw.
 *   (4) CLI `node lineage-calibration.mjs --json` exits 0 and is parseable JSON.
 *
 * Fixture:
 *   git init -b main + contextkit/ tree with:
 *     - one workflow ('calib-test')
 *     - two cards (CALIB-001 linked to 'calib-test', CALIB-002 linked to it)
 *     - two prediction files under memory/predictions/:
 *         accurate.md  — reviewed, predictedMiss empty  → hit
 *         miss.md      — reviewed, predictedMiss non-empty → miss
 *
 * Standalone runnable: node tools/selfcheck-pkg07-072.mjs
 * Exit 0 on all-pass, exit 1 on any failure.
 * Zero runtime deps — node:* only.
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync, execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dirname, '..');

const CORE_URL = pathToFileURL(
  resolve(KIT, 'templates/contextkit/tools/scripts/lineage-calibration-core.mjs'),
).href;
const IO_PATH = resolve(KIT, 'templates/contextkit/tools/scripts/lineage-calibration.mjs');
const IO_URL  = pathToFileURL(IO_PATH).href;

let failures = 0;
const ok  = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { console.error(`  ✗ ${msg}`); failures += 1; };

// Verify core module imports cleanly (pure import check)
try {
  await import(CORE_URL);
  ok('lineage-calibration-core.mjs imports cleanly');
} catch (err) {
  console.error(`FATAL: cannot import lineage-calibration-core.mjs: ${err?.message ?? err}`);
  process.exit(1);
}

let lineageCalibration;
try {
  ({ lineageCalibration } = await import(IO_URL));
  ok('lineage-calibration.mjs imports cleanly');
} catch (err) {
  console.error(`FATAL: cannot import lineage-calibration.mjs: ${err?.message ?? err}`);
  process.exit(1);
}

const WF_SLUG      = 'calib-test';
const CARD_A_ID    = 'CALIB-001';
const CARD_B_ID    = 'CALIB-002';
const REVIEW_DATE  = '2026-06-16';
// Session ids: the graph uses ownerSessionId; prediction files record the
// first 8 chars of the sessionId string. These MUST match for strategy-2
// (session-prefix) linkage to resolve prediction → workflow.
// Must be digits-only (≥2 digits) to match the listSessions ENTRY_PATTERN.
const SESSION_NUM  = '11223344';

/**
 * Builds a prediction file body in the exact format predictions-review.mjs writes.
 * isAccurate: true → predictedMiss empty (hit); false → predictedMiss has entry (miss).
 *
 * @param {string} objective
 * @param {boolean} isAccurate
 * @returns {string}
 */
function predictionBody(objective, isAccurate) {
  const missLine = isAccurate
    ? '- **Predicted ✗ but NOT changed**: — none'
    : '- **Predicted ✗ but NOT changed**: `src/ghost.mjs`';
  return [
    `# Prediction — ${objective}`,
    '',
    '- **Date**: 2026-06-01',
    `- **Session**: ${SESSION_NUM}`,
    '- **Covered paths**: `src/foo.mjs`, `src/bar.mjs`',
    '',
    '## Predicted blast radius',
    '_What you expect to change._',
    '',
    `## Actual (reviewed ${REVIEW_DATE})`,
    '',
    '- **Paths actually changed this session**: `src/foo.mjs`, `src/bar.mjs`',
    '- **Predicted ✓ and changed**: `src/foo.mjs`, `src/bar.mjs`',
    missLine,
    '- **Changed but NOT predicted**: — none',
    '- **Risk accuracy**: _was the risk level right? yes_',
    '',
  ].join('\n');
}

/** Creates a minimal fixture git root with workflow, cards, and prediction files. */
function buildFixtureRoot() {
  const root = resolve(tmpdir(), `selfcheck-calib-${Date.now()}`);
  mkdirSync(root, { recursive: true });

  try { execSync('git init -b main', { cwd: root, stdio: 'pipe' }); } catch {
    try { execSync('git init', { cwd: root, stdio: 'pipe' }); } catch { /* best-effort */ }
  }

  const ckPath = (rel) => resolve(root, 'contextkit', rel);

  // Workflow
  mkdirSync(ckPath(`memory/workflows/${WF_SLUG}`), { recursive: true });
  writeFileSync(ckPath(`memory/workflows/${WF_SLUG}/index.md`), [
    '---',
    `slug: ${WF_SLUG}`,
    'kind: feature',
    'number: 0099',
    'started: 2026-06-01T00:00:00.000Z',
    'branch: main',
    'currentPhase: spec',
    'intake: done',
    'prd: done',
    'spec: pending',
    '---',
    '',
    `# Workflow — ${WF_SLUG}`,
    '',
  ].join('\n'));

  // Two cards linked to the workflow
  for (const stage of ['backlog', 'working', 'testing', 'conclusion']) {
    mkdirSync(ckPath(`pipeline/${stage}`), { recursive: true });
  }
  for (const [cardId, title] of [[CARD_A_ID, 'Calibration card A'], [CARD_B_ID, 'Calibration card B']]) {
    writeFileSync(ckPath(`pipeline/working/${cardId}-calib.md`), [
      '---',
      `id: ${cardId}`,
      `title: ${title}`,
      `workflow: ${WF_SLUG}`,
      'type: feature',
      'priority: P1',
      '---',
      '',
      `# ${cardId}`,
      '',
    ].join('\n'));
  }

  // State files (ownerSessionId must match SESSION_NUM so graph can wire card → session)
  for (const cardId of [CARD_A_ID, CARD_B_ID]) {
    mkdirSync(ckPath(`pipeline/state/${cardId}`), { recursive: true });
    writeFileSync(ckPath(`pipeline/state/${cardId}/state.json`), JSON.stringify({
      kind: 'task', id: cardId, status: 'working',
      ownerSessionId: SESSION_NUM, ownerUser: 'test',
      branch: 'main', startedAt: Date.now(), lastHeartbeat: Date.now(),
      endedAt: null, cycles: {}, events: [],
    }, null, 2));
  }

  // Session directory (filename uses SESSION_NUM as the session number segment)
  mkdirSync(ckPath('memory/sessions'), { recursive: true });
  writeFileSync(ckPath(`memory/sessions/2026-06-01-${SESSION_NUM}-calib.md`), '# Calib session\n');

  // Predictions: one accurate (hit), one miss
  mkdirSync(ckPath('memory/predictions'), { recursive: true });
  writeFileSync(
    ckPath('memory/predictions/2026-06-01-aaaaaaaa-accurate-prediction.md'),
    predictionBody('accurate prediction', true),
  );
  writeFileSync(
    ckPath('memory/predictions/2026-06-01-aaaaaaaa-miss-prediction.md'),
    predictionBody('miss prediction', false),
  );

  return root;
}

function cleanFixture(root) {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
}

console.log('\n(1) + (2) perWorkflow accuracy (0.5) + overall accuracy for seeded data\n');

let fixtureRoot;
let report;
try {
  fixtureRoot = buildFixtureRoot();
  report = await lineageCalibration(fixtureRoot);
  ok('lineageCalibration completed without throwing');
} catch (err) {
  bad(`lineageCalibration threw: ${err?.message ?? err}`);
  process.exit(1);
}

// Validate perWorkflow for the seeded workflow slug
const wfEntry = report.perWorkflow.find((w) => w.slug === WF_SLUG);
if (!wfEntry) {
  bad(`expected perWorkflow entry for slug '${WF_SLUG}' — got: ${JSON.stringify(report.perWorkflow.map((w) => w.slug))}`);
} else {
  ok(`perWorkflow entry found for slug '${WF_SLUG}'`);
  wfEntry.predictions === 2
    ? ok(`perWorkflow predictions count: 2 (got ${wfEntry.predictions})`)
    : bad(`perWorkflow predictions: expected 2, got ${wfEntry.predictions}`);
  wfEntry.hits === 1
    ? ok(`perWorkflow hits: 1 (got ${wfEntry.hits})`)
    : bad(`perWorkflow hits: expected 1, got ${wfEntry.hits}`);
  wfEntry.misses === 1
    ? ok(`perWorkflow misses: 1 (got ${wfEntry.misses})`)
    : bad(`perWorkflow misses: expected 1, got ${wfEntry.misses}`);
  wfEntry.accuracy === 0.5
    ? ok(`perWorkflow accuracy: 0.5 (got ${wfEntry.accuracy})`)
    : bad(`perWorkflow accuracy: expected 0.5, got ${wfEntry.accuracy}`);
}

// Validate overall accuracy
report.overall.accuracy === 0.5
  ? ok(`overall.accuracy: 0.5 (got ${report.overall.accuracy})`)
  : bad(`overall.accuracy: expected 0.5, got ${report.overall.accuracy}`);

report.overall.confidence === 'derived'
  ? ok("overall.confidence: 'derived'")
  : bad(`overall.confidence: expected 'derived', got '${report.overall.confidence}'`);

console.log('\n(3) Fail-open: root with NO predictions dir\n');

const bareRoot = resolve(tmpdir(), `selfcheck-calib-bare-${Date.now()}`);
mkdirSync(bareRoot, { recursive: true });
try { execSync('git init -b main', { cwd: bareRoot, stdio: 'pipe' }); } catch {
  try { execSync('git init', { cwd: bareRoot, stdio: 'pipe' }); } catch { /* best-effort */ }
}

let bareReport;
try {
  bareReport = await lineageCalibration(bareRoot);
  ok('lineageCalibration on bare root: no throw (fail-open)');
} catch (err) {
  bad(`lineageCalibration on bare root threw: ${err?.message ?? err}`);
  bareReport = null;
}

if (bareReport) {
  (bareReport.sources?.skipped ?? []).includes('predictions')
    ? ok("bare root: sources.skipped includes 'predictions'")
    : bad(`bare root: expected 'predictions' in sources.skipped, got: ${JSON.stringify(bareReport.sources?.skipped)}`);
  bareReport.overall.accuracy === null
    ? ok('bare root: overall.accuracy is null (§8: skipped ≠ pass)')
    : bad(`bare root: expected overall.accuracy null, got ${bareReport.overall.accuracy}`);
  Array.isArray(bareReport.perWorkflow) && bareReport.perWorkflow.length === 0
    ? ok('bare root: perWorkflow is empty []')
    : bad(`bare root: expected perWorkflow=[], got ${JSON.stringify(bareReport.perWorkflow)}`);
}
cleanFixture(bareRoot);

console.log('\n(4) CLI --json exits 0 and is parseable JSON\n');

const cliResult = spawnSync(process.execPath, [IO_PATH, '--json'], {
  cwd: fixtureRoot,
  encoding: 'utf-8',
  timeout: 30_000,
});

cliResult.status === 0
  ? ok('CLI: exit code 0')
  : bad(`CLI: expected exit 0, got ${cliResult.status}; stderr: ${cliResult.stderr?.slice(0, 200)}`);

let cliParsed = null;
try {
  cliParsed = JSON.parse(cliResult.stdout);
  ok('CLI: stdout is valid JSON');
} catch (parseErr) {
  bad(`CLI: stdout is not parseable JSON: ${parseErr?.message ?? parseErr}`);
}

if (cliParsed) {
  cliParsed.schemaVersion === 1
    ? ok('CLI JSON: schemaVersion === 1')
    : bad(`CLI JSON: expected schemaVersion 1, got ${cliParsed.schemaVersion}`);
  Array.isArray(cliParsed.perWorkflow)
    ? ok(`CLI JSON: perWorkflow is an array (${cliParsed.perWorkflow.length} entries)`)
    : bad('CLI JSON: perWorkflow is not an array');
  typeof cliParsed.overall === 'object'
    ? ok('CLI JSON: overall is an object')
    : bad('CLI JSON: overall is missing or not an object');
}

cleanFixture(fixtureRoot);

console.log(
  failures === 0
    ? '\n  PASS — CDK-072 lineage-calibration self-check: all checks passed.\n'
    : `\n  FAIL — CDK-072 lineage-calibration self-check: ${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
