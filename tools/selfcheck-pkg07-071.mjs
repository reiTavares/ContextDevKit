#!/usr/bin/env node
/** Canonical v4 public-lineage projection self-check. */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { projectPublicLineage } from '../templates/contextkit/tools/scripts/lineage-public.mjs';
import { createWaveWorkflow } from '../templates/contextkit/tools/scripts/workflow/create.mjs';
import { addTask } from '../templates/contextkit/tools/scripts/tasks-store.mjs';

const kitRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cliPath = resolve(kitRoot, 'templates/contextkit/tools/scripts/lineage-public.mjs');
let failures = 0;
const check = (condition, message) => {
  console.log(`  ${condition ? '✓' : '✗'} ${message}`);
  if (!condition) failures += 1;
};

const root = resolve(tmpdir(), `contextkit-public-lineage-${Date.now()}`);
const decisions = resolve(root, 'contextkit', 'memory', 'decisions');
const sessions = resolve(root, 'contextkit', 'memory', 'sessions');
mkdirSync(decisions, { recursive: true });
mkdirSync(sessions, { recursive: true });
writeFileSync(resolve(decisions, '0071-public-lineage.md'), [
  '# ADR-0071 — Public lineage', '', '**Status:** Accepted', '', '## Decision', '',
  'Publish only the reviewed ADR catalog.', '',
].join('\n'));
const workflow = createWaveWorkflow(root, 'public-lineage', {
  id: 'WF-0071',
  title: 'Public lineage',
  objective: 'Project ADR-0071 without private execution state.',
  acceptance: ['ADR-0071'],
  now: '2026-01-01T00:00:00.000Z',
});
addTask(workflow.dir, {
  id: 'CDK-071',
  title: 'INTERNAL_TASK_TOKEN',
  status: 'working',
  evidenceRefs: ['reports/private-evidence.md'],
}, 0, { now: '2026-01-01T00:00:00.000Z' });
writeFileSync(resolve(sessions, '2026-01-01-99-public-lineage.md'), '# Session\n\nWorked on CDK-071.\n');

const publicView = await projectPublicLineage(root);
const allowedAdrKeys = new Set(['number', 'title', 'status', 'decision']);
check(publicView.adrs.length === 1, 'public projection contains the authored ADR');
check(publicView.adrs.every((adr) => Object.keys(adr).every((key) => allowedAdrKeys.has(key))),
  'ADR projection exposes only reviewed public fields');
const serialized = JSON.stringify(publicView);
check(!serialized.includes('INTERNAL_TASK_TOKEN'), 'task-private data is absent from public output');
check(!serialized.includes('private-evidence.md'), 'evidence paths are absent from public output');
check(Array.isArray(publicView.redacted) && publicView.redacted.length > 0,
  'projection declares the redacted field families');

const bareRoot = resolve(tmpdir(), `contextkit-public-lineage-bare-${Date.now()}`);
mkdirSync(bareRoot, { recursive: true });
const bareView = await projectPublicLineage(bareRoot);
check(bareView.adrs.length === 0 && bareView.sources.skipped.length > 0,
  'missing sources degrade to an explicit empty/skipped view');

const cli = spawnSync(process.execPath, [cliPath, '--json'], { cwd: root, encoding: 'utf8', timeout: 30_000 });
let parsed = null;
try { parsed = JSON.parse(cli.stdout); } catch { /* asserted below */ }
check(cli.status === 0 && Array.isArray(parsed?.adrs), 'public-lineage CLI emits parseable JSON');

rmSync(root, { recursive: true, force: true });
rmSync(bareRoot, { recursive: true, force: true });
console.log(failures === 0 ? '\nPASS — canonical public lineage\n' : `\nFAIL — canonical public lineage: ${failures}\n`);
process.exit(failures === 0 ? 0 : 1);
