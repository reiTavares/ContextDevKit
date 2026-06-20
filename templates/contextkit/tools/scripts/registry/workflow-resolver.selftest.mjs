/**
 * Self-test for the A4-T1 resolver + collision-detector contract (BIZ-0001 /
 * WF-0036, Wave A4). Written against the FROZEN INTERFACE before implementers
 * deliver — assertions on `detectWorkflowCollisions` go RED until A4-T1 ships.
 *
 * Coverage: legacy NNNN-slug resolution (format:'legacy') · new WF-#### resolution
 * (format:'new') · workflowRoots enumeration · allocateWorkflowId scans all roots ·
 * detectWorkflowCollisions duplicate-id + clean-fixture paths · sorted registry ·
 * live-tree smoke (read-only, no writes).
 *
 * Zero deps — `node:*` only (ADR-0001). Deterministic: in-memory fixture in
 * os.tmpdir(), cleaned in `finally`. Exit 0 = PASSED, 1 = FAILED.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathsFor } from '../../../runtime/config/paths.mjs';
import { workflowRoots, allocateWorkflowId, nextWorkflowNumber } from './ids.mjs';
import { buildWorkflowRegistry, resolveWorkflow } from './workflow.mjs';

const failures = [];

function assert(label, cond) {
  process.stdout.write(`  ${cond ? 'ok  ' : 'FAIL'} ${label}\n`);
  if (!cond) failures.push(label);
}

function writeJson(filePath, payload) {
  mkdirSync(resolve(filePath, '..'), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

function writeText(filePath, content) {
  mkdirSync(resolve(filePath, '..'), { recursive: true });
  writeFileSync(filePath, content, 'utf-8');
}

/**
 * Fixture topology: memory/workflows/0033-old-workflow (legacy) +
 * business/BIZ-0001-fixture/workflows/WF-0036-arch + WF-0037-gov +
 * operations/OP-0001-ops/workflows/WF-0038-ops-flow.
 */
function buildFixture(root) {
  const paths = pathsFor(root);
  const legacyDir = resolve(paths.memory, 'workflows', '0033-old-workflow');
  mkdirSync(legacyDir, { recursive: true });
  writeText(resolve(legacyDir, 'index.md'), '# WF0033\n\n**Status:** planning complete\n');
  const bizWf = resolve(paths.business, 'BIZ-0001-fixture', 'workflows');
  writeJson(resolve(bizWf, 'WF-0036-arch', 'workflow-plan.json'), { workflowId: 'WF-0036', slug: 'arch', title: 'Architecture' });
  writeJson(resolve(bizWf, 'WF-0036-arch', 'workflow-state.json'), { overallStatus: 'in-progress' });
  writeJson(resolve(bizWf, 'WF-0037-gov', 'workflow-plan.json'), { workflowId: 'WF-0037', slug: 'gov', title: 'Governance' });
  writeJson(resolve(bizWf, 'WF-0037-gov', 'workflow-state.json'), { overallStatus: 'not-started' });
  const opsWf = resolve(paths.operations, 'OP-0001-ops', 'workflows');
  writeJson(resolve(opsWf, 'WF-0038-ops-flow', 'workflow-plan.json'), { workflowId: 'WF-0038', slug: 'ops-flow', title: 'Ops Flow' });
  writeJson(resolve(opsWf, 'WF-0038-ops-flow', 'workflow-state.json'), { overallStatus: 'not-started' });
}

const fixtureRoot = mkdtempSync(resolve(tmpdir(), 'ckit-wf-resolver-'));
try {
  buildFixture(fixtureRoot);
  const registry = buildWorkflowRegistry(fixtureRoot);
  const ids = registry.workflows.map((row) => row.id);

  process.stdout.write('\nBlock A — Legacy resolution (format:legacy)\n');
  assert('A1: legacy 0033 is indexed', ids.includes('0033'));
  const legRow = resolveWorkflow(registry, '0033');
  assert('A2: legacy row format is "legacy"', legRow?.format === 'legacy');
  assert('A3: legacy status parsed from index.md', legRow?.status === 'planning complete');
  assert('A4: legacy title is null', legRow?.title === null);
  assert('A5: resolve by slug "old-workflow" returns legacy row', resolveWorkflow(registry, 'old-workflow')?.id === '0033');

  process.stdout.write('\nBlock B — New-format resolution (format:new)\n');
  assert('B1: WF-0036 indexed', ids.includes('WF-0036'));
  const newRow = resolveWorkflow(registry, 'WF-0036');
  assert('B2: new row format is "new"', newRow?.format === 'new');
  assert('B3: new row status from workflow-state.json', newRow?.status === 'in-progress');
  assert('B4: new row title from workflow-plan.json', newRow?.title === 'Architecture');
  assert('B5: WF-0037 resolves by id', resolveWorkflow(registry, 'WF-0037') !== null);
  assert('B6: resolve by slug "gov" returns WF-0037', resolveWorkflow(registry, 'gov')?.id === 'WF-0037');
  assert('B7: operations workflow WF-0038 is indexed', ids.includes('WF-0038'));
  assert('B8: unknown id returns null', resolveWorkflow(registry, 'WF-9999') === null);
  assert('B9: null inputs to resolveWorkflow return null', resolveWorkflow(null, 'WF-0036') === null && resolveWorkflow(registry, null) === null);

  process.stdout.write('\nBlock C — workflowRoots enumeration\n');
  const roots = workflowRoots(fixtureRoot);
  const paths = pathsFor(fixtureRoot);
  const fwd = (p) => p.split('\\').join('/');
  const rootsFwd = roots.map(fwd);
  assert('C1: includes memory/workflows', rootsFwd.some((r) => r.endsWith('/contextkit/memory/workflows')));
  assert('C2: includes business/BIZ-0001-fixture/workflows', rootsFwd.some((r) => r === fwd(resolve(paths.business, 'BIZ-0001-fixture', 'workflows'))));
  assert('C3: includes operations/OP-0001-ops/workflows', rootsFwd.some((r) => r === fwd(resolve(paths.operations, 'OP-0001-ops', 'workflows'))));
  assert('C4: at least 3 entries (top + 1 biz + 1 ops)', roots.length >= 3);

  process.stdout.write('\nBlock D — allocateWorkflowId\n');
  const nextId = allocateWorkflowId(fixtureRoot);
  assert('D1: returns WF-#### format', /^WF-\d{4}$/.test(nextId));
  const nextNum = parseInt(nextId.replace('WF-', ''), 10);
  assert('D2: result > highest new-format id (WF-0038)', nextNum > 38);
  assert('D3: result > highest legacy numeric id (0033)', nextNum > 33);
  assert('D4: equals WF- prefix of nextWorkflowNumber', nextId === `WF-${nextWorkflowNumber(fixtureRoot)}`);
  assert('D5: deterministic — same result on second call', allocateWorkflowId(fixtureRoot) === nextId);

  process.stdout.write('\nBlock E — Sorted registry\n');
  assert('E1: workflows sorted by id (localeCompare)', JSON.stringify(ids) === JSON.stringify([...ids].sort((a, b) => a.localeCompare(b))));

  process.stdout.write('\nBlock F — detectWorkflowCollisions (A4-T1 frozen interface)\n');
  // Import dynamically: symbol does not exist until A4-T1 ships. Failures here
  // are intentional RED markers for the implementers.
  let detectWorkflowCollisions;
  try { detectWorkflowCollisions = (await import('./workflow.mjs')).detectWorkflowCollisions; } catch { /* absent */ }

  if (typeof detectWorkflowCollisions !== 'function') {
    assert('F1: detectWorkflowCollisions exported (A4-T1 pending)', false);
    assert('F2: returns {duplicateIds,duplicatePaths} (A4-T1 pending)', false);
    assert('F3: duplicate id flagged in duplicateIds (A4-T1 pending)', false);
    assert('F4: clean fixture has no collisions (A4-T1 pending)', false);
  } else {
    const collRoot = mkdtempSync(resolve(tmpdir(), 'ckit-wf-coll-'));
    try {
      const cp = pathsFor(collRoot);
      const top = resolve(cp.memory, 'workflows');
      mkdirSync(top, { recursive: true });
      writeJson(resolve(top, 'WF-0001-dupe-a', 'workflow-plan.json'), { workflowId: 'WF-0001', slug: 'dupe-a', title: 'A' });
      writeJson(resolve(top, 'WF-0001-dupe-a', 'workflow-state.json'), { overallStatus: 'not-started' });
      const cBiz = resolve(cp.business, 'BIZ-0001-coll', 'workflows');
      writeJson(resolve(cBiz, 'WF-0001-dupe-b', 'workflow-plan.json'), { workflowId: 'WF-0001', slug: 'dupe-b', title: 'B' });
      writeJson(resolve(cBiz, 'WF-0001-dupe-b', 'workflow-state.json'), { overallStatus: 'not-started' });
      const collisions = detectWorkflowCollisions(collRoot);
      assert('F1: detectWorkflowCollisions exported', true);
      assert('F2: returns {duplicateIds,duplicatePaths}', Array.isArray(collisions?.duplicateIds) && Array.isArray(collisions?.duplicatePaths));
      assert('F3: WF-0001 in duplicateIds', collisions.duplicateIds.includes('WF-0001'));
      const clean = detectWorkflowCollisions(fixtureRoot);
      assert('F4: clean fixture has no collisions', clean.duplicateIds.length === 0 && clean.duplicatePaths.length === 0);
    } finally { rmSync(collRoot, { recursive: true, force: true }); }
  }
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

process.stdout.write('\nSmoke — live worktree (read-only)\n');
try {
  const live = buildWorkflowRegistry(process.cwd());
  assert('S1: returns workflows array', Array.isArray(live.workflows));
  assert('S2: live tree has legacy workflows', live.workflows.some((r) => r.format === 'legacy'));
  assert('S3: live tree has new-format workflows', live.workflows.some((r) => r.format === 'new'));
  assert('S4: workflowRoots non-empty on live tree', workflowRoots(process.cwd()).length > 0);
} catch (err) {
  failures.push('live-smoke');
  process.stderr.write(`  FAIL S1-S4: live tree threw: ${err.message}\n`);
}

process.stdout.write(failures.length === 0 ? '\nPASSED\n' : `\nFAILED (${failures.length}): ${failures.join(', ')}\n`);
process.exit(failures.length === 0 ? 0 : 1);
