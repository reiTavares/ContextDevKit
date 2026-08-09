#!/usr/bin/env node
/** Canonical v4 lineage-calibration self-check. */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { lineageCalibration } from '../templates/contextkit/tools/scripts/lineage-calibration.mjs';
import { createWaveWorkflow } from '../templates/contextkit/tools/scripts/workflow/create.mjs';
import { addTask } from '../templates/contextkit/tools/scripts/tasks-store.mjs';

const kitRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cliPath = resolve(kitRoot, 'templates/contextkit/tools/scripts/lineage-calibration.mjs');
let failures = 0;
const check = (condition, message) => {
  console.log(`  ${condition ? '✓' : '✗'} ${message}`);
  if (!condition) failures += 1;
};

/** @param {boolean} hit @returns {string} */
function predictionBody(hit) {
  return [
    '# Prediction — calibration', '',
    '- **Session**: 11223344',
    '- **Covered paths**: `src/foo.mjs`, `src/bar.mjs`', '',
    '## Actual (reviewed 2026-06-16)', '',
    '- **Paths actually changed this session**: `src/foo.mjs`, `src/bar.mjs`',
    '- **Predicted ✓ and changed**: `src/foo.mjs`',
    `- **Predicted ✗ but NOT changed**: ${hit ? '— none' : '`src/ghost.mjs`'}`,
    '- **Changed but NOT predicted**: — none', '',
  ].join('\n');
}

const root = resolve(tmpdir(), `contextkit-lineage-calibration-${Date.now()}`);
const sessions = resolve(root, 'contextkit', 'memory', 'sessions');
const predictions = resolve(root, 'contextkit', 'memory', 'predictions');
mkdirSync(sessions, { recursive: true });
mkdirSync(predictions, { recursive: true });
const workflow = createWaveWorkflow(root, 'calib-test', {
  id: 'WF-0099', title: 'Calibration', objective: 'Calibrate reviewed predictions.',
  now: '2026-06-01T00:00:00.000Z',
});
addTask(workflow.dir, { id: 'CALIB-001', title: 'Calibration task', status: 'working' }, 0,
  { now: '2026-06-01T00:00:00.000Z' });
writeFileSync(resolve(sessions, '2026-06-01-11223344-calibration.md'), '# Session\n\nWorked on CALIB-001.\n');
writeFileSync(resolve(predictions, '2026-06-01-hit.md'), predictionBody(true));
writeFileSync(resolve(predictions, '2026-06-01-miss.md'), predictionBody(false));

const report = await lineageCalibration(root);
const workflowReport = report.perWorkflow.find((entry) => entry.slug === 'calib-test');
check(workflowReport?.predictions === 2, 'both reviewed predictions link to the canonical workflow');
check(workflowReport?.hits === 1 && workflowReport?.misses === 1,
  'calibration distinguishes one hit and one miss');
check(workflowReport?.accuracy === 0.5 && report.overall.accuracy === 0.5,
  'workflow and overall accuracy equal 0.5');

const bareRoot = resolve(tmpdir(), `contextkit-lineage-calibration-bare-${Date.now()}`);
mkdirSync(bareRoot, { recursive: true });
const bare = await lineageCalibration(bareRoot);
check(bare.overall.accuracy === null && bare.sources.skipped.includes('predictions'),
  'missing prediction evidence is skipped rather than passed');

const cli = spawnSync(process.execPath, [cliPath, '--json'], { cwd: root, encoding: 'utf8', timeout: 30_000 });
let parsed = null;
try { parsed = JSON.parse(cli.stdout); } catch { /* asserted below */ }
check(cli.status === 0 && Array.isArray(parsed?.perWorkflow), 'lineage-calibration CLI emits parseable JSON');

rmSync(root, { recursive: true, force: true });
rmSync(bareRoot, { recursive: true, force: true });
console.log(failures === 0 ? '\nPASS — canonical lineage calibration\n' : `\nFAIL — canonical lineage calibration: ${failures}\n`);
process.exit(failures === 0 ? 0 : 1);
