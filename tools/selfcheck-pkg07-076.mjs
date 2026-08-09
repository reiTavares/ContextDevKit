#!/usr/bin/env node
/** Canonical v4 engineering-scorecard self-check. */
import { mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const directory = dirname(fileURLToPath(import.meta.url));
const kitRoot = resolve(directory, '..');
const importSource = (path) => import(pathToFileURL(resolve(kitRoot, path)).href);
const scorecardPath = resolve(kitRoot, 'templates/contextkit/tools/scripts/engineering-scorecard.mjs');
const { scoreDimensions } = await importSource('templates/contextkit/tools/scripts/engineering-scorecard-core.mjs');
const { engineeringScorecard } = await importSource('templates/contextkit/tools/scripts/engineering-scorecard.mjs');
const { createWaveWorkflow } = await importSource('templates/contextkit/tools/scripts/workflow/create.mjs');
const { addTask } = await importSource('templates/contextkit/tools/scripts/tasks-store.mjs');

let failures = 0;
const check = (condition, message) => {
  if (condition) console.log(`  ✓ ${message}`);
  else { console.error(`  ✗ ${message}`); failures += 1; }
};

const graph = {
  nodes: [
    { id: 'wf:alpha', type: 'workflow', ref: { id: 'WF-0001', slug: 'alpha' } },
    { id: 'card:DONE', type: 'card', ref: {
      id: 'DONE', scopeRef: 'WF-0001', status: 'done', evidenceRefs: ['reports/qa.md'], reportRefs: [],
    } },
  ],
  edges: [{ from: 'wf:alpha', to: 'card:DONE', rel: 'ships', confidence: 'direct' }],
};
const mixed = scoreDimensions({ lineageGraph: graph });
check(mixed.dimensions.find((dimension) => dimension.key === 'task-evidence-coverage')?.score === 100,
  'canonical done-task evidence coverage scores 100');
check(mixed.dimensions.find((dimension) => dimension.key === 'workflow-linkage')?.score === 100,
  'canonical workflow linkage scores 100');
check(mixed.dimensions.filter((dimension) => dimension.status === 'skipped').every((dimension) => dimension.score === null),
  'skipped dimensions have null scores');
const scored = mixed.dimensions.filter((dimension) => dimension.status === 'scored');
const expectedMean = scored.reduce((sum, dimension) => sum + dimension.score, 0) / scored.length;
check(mixed.overall.score === expectedMean, 'overall mean excludes skipped dimensions');

const root = resolve(tmpdir(), `scorecard-v4-${Date.now()}`);
mkdirSync(root, { recursive: true });
const workflow = createWaveWorkflow(root, 'scorecard', {
  id: 'WF-0099', title: 'Scorecard', objective: 'Verify canonical scorecard.',
  acceptance: ['factual evidence'], now: '2026-01-01T00:00:00.000Z',
});
addTask(workflow.dir, {
  id: 'CDK-076', title: 'Verify scorecard', status: 'done', evidenceRefs: ['reports/qa.md'],
}, 0, { now: '2026-01-01T00:00:00.000Z' });
const report = await engineeringScorecard(root);
check(report.dimensions.some((dimension) => dimension.status === 'scored'), 'real v4 fixture produces scored dimensions');
check(!report.dimensions.some((dimension) => /receipt/i.test(dimension.key)), 'scorecard exposes no receipt dimension');
check(report.dimensions.filter((dimension) => dimension.status === 'skipped').every((dimension) => dimension.score === null),
  'real fixture keeps skipped dimensions honest');

const allNull = scoreDimensions({});
check(allNull.overall.score === null && allNull.overall.confidence === 'none', 'no sources yields no fabricated score');
const highConfidence = scoreDimensions({
  lineageGraph: graph,
  rules: { summary: { pass: 4, fail: 0 } },
  compliance: { total: 4, parity: 4 },
  calibration: { overall: { accuracy: 1 } },
  benchmark: { count: 2, completedCount: 2 },
});
check(highConfidence.overall.scoredCount === 6 && highConfidence.overall.confidence === 'high',
  'all six factual dimensions yield high confidence');

const cli = spawnSync(process.execPath, [scorecardPath, '--json'], {
  cwd: root, encoding: 'utf8', timeout: 60_000,
});
check(cli.status === 0, 'scorecard CLI exits zero');
try {
  const parsed = JSON.parse(cli.stdout);
  check(Array.isArray(parsed.dimensions) && typeof parsed.overall === 'object', 'scorecard CLI emits JSON');
} catch (error) {
  check(false, `scorecard CLI JSON parse failed: ${error.message}`);
}

rmSync(root, { recursive: true, force: true });
console.log(failures === 0 ? '\n  PASS — canonical v4 engineering scorecard\n' : `\n  FAIL — scorecard: ${failures}\n`);
process.exit(failures === 0 ? 0 : 1);
