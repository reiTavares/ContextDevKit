/**
 * Self-test for the work-context + workflow registry generators and the global
 * ID allocators (BIZ-0001 / WF-0036, A1-T3). Pure `node:*`, zero deps; exits
 * non-zero on the first failed assertion.
 *
 * Coverage:
 *  1. generation indexes BIZ-0001 + WF-0036 + WF-0037 + a legacy `NNNN-slug`;
 *  2. rebuild is byte-idempotent (generate, capture, generate again, assert eq);
 *  3. allocators return the next free id scanning ALL roots (workflow > 0037,
 *     business > BIZ-0001, operations = OP-0001) and never collide with legacy.
 *
 * To keep the assertions deterministic regardless of what the dogfood runtime
 * currently holds, the test builds an isolated fixture project root in a temp dir
 * (one BIZ context with two WF packs + one legacy workflow) and runs every
 * generator/allocator against it. A final smoke check runs the build against the
 * real worktree root to confirm it never throws on the live tree.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathsFor } from '../../../runtime/config/paths.mjs';
import { buildWorkContextRegistry, writeWorkContextRegistry } from './work-context.mjs';
import { buildWorkflowRegistry, resolveWorkflow, writeWorkflowRegistry } from './workflow.mjs';
import { nextBusinessId, nextOperationId, nextWorkflowNumber } from './ids.mjs';
import { serializeRegistry } from './serialize.mjs';

let failures = 0;
/** Records and reports one assertion. */
function assert(label, condition) {
  if (condition) {
    process.stdout.write(`  ok  ${label}\n`);
  } else {
    failures += 1;
    process.stdout.write(`FAIL  ${label}\n`);
  }
}

/** Writes a JSON file, creating parents. */
function writeJson(path, payload) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

/**
 * Materializes an isolated fixture project root: one BIZ-0001 with WF-0036 +
 * WF-0037 packs, and one legacy `0033-old-workflow` dir under memory/workflows.
 *
 * @param {string} root - the fixture project root.
 */
function buildFixture(root) {
  const paths = pathsFor(root);
  const bizDir = resolve(paths.business, 'BIZ-0001-fixture');
  writeJson(resolve(bizDir, 'business.json'), { id: 'BIZ-0001', status: 'approved', title: 'Fixture Business' });
  const wfRoot = resolve(bizDir, 'workflows');
  writeJson(resolve(wfRoot, 'WF-0036-arch', 'workflow-plan.json'), { workflowId: 'WF-0036', slug: 'arch', title: 'Architecture' });
  writeJson(resolve(wfRoot, 'WF-0036-arch', 'workflow-state.json'), { overallStatus: 'in-progress' });
  writeJson(resolve(wfRoot, 'WF-0037-gov', 'workflow-plan.json'), { workflowId: 'WF-0037', slug: 'gov', title: 'Governance' });
  writeJson(resolve(wfRoot, 'WF-0037-gov', 'workflow-state.json'), { overallStatus: 'not-started' });
  const legacyDir = resolve(paths.memory, 'workflows', '0033-old-workflow');
  mkdirSync(legacyDir, { recursive: true });
  writeFileSync(resolve(legacyDir, 'index.md'), '# WF0033 — old-workflow\n\n**Status:** planning complete\n');
}

const fixtureRoot = mkdtempSync(resolve(tmpdir(), 'ckit-reg-'));
try {
  buildFixture(fixtureRoot);

  // 1. Generation indexes the contexts + both WFs + the legacy workflow.
  const wcText = writeWorkContextRegistry(fixtureRoot);
  const wc = JSON.parse(wcText);
  assert('work-context indexes BIZ-0001', wc.contexts.some((row) => row.id === 'BIZ-0001' && row.type === 'business'));
  assert('work-context carries status+title', wc.contexts[0].status === 'approved' && wc.contexts[0].title === 'Fixture Business');

  const wfText = writeWorkflowRegistry(fixtureRoot);
  const wf = JSON.parse(wfText);
  const ids = wf.workflows.map((row) => row.id);
  assert('workflow indexes WF-0036', ids.includes('WF-0036'));
  assert('workflow indexes WF-0037', ids.includes('WF-0037'));
  assert('workflow indexes legacy 0033', ids.includes('0033'));
  assert('legacy row tagged format=legacy + status parsed', resolveWorkflow(wf, '0033')?.format === 'legacy' && resolveWorkflow(wf, '0033')?.status === 'planning complete');
  assert('new row tagged format=new + state status', resolveWorkflow(wf, 'WF-0036')?.format === 'new' && resolveWorkflow(wf, 'WF-0036')?.status === 'in-progress');
  assert('resolveWorkflow by slug works', resolveWorkflow(wf, 'gov')?.id === 'WF-0037');
  assert('workflow rows sorted by id', JSON.stringify(ids) === JSON.stringify([...ids].sort((a, b) => a.localeCompare(b))));

  // 2. Rebuild is byte-idempotent (build twice, compare bytes).
  const wcAgain = writeWorkContextRegistry(fixtureRoot);
  const wfAgain = writeWorkflowRegistry(fixtureRoot);
  assert('work-context rebuild byte-identical', wcAgain === wcText);
  assert('workflow rebuild byte-identical', wfAgain === wfText);
  // Pure build (in-memory) serializes to the exact written bytes (key order from serialize.mjs).
  assert('pure build serializes to written bytes (work-context)', serializeRegistry(buildWorkContextRegistry(fixtureRoot)) === wcText);
  assert('pure build serializes to written bytes (workflow)', serializeRegistry(buildWorkflowRegistry(fixtureRoot)) === wfText);

  // 3. Allocators scan all roots and return the next free id.
  assert('nextWorkflowNumber > 0037', parseInt(nextWorkflowNumber(fixtureRoot), 10) === 38);
  assert('nextBusinessId > BIZ-0001', nextBusinessId(fixtureRoot) === 'BIZ-0002');
  assert('nextOperationId = OP-0001 (empty root)', nextOperationId(fixtureRoot) === 'OP-0001');

  // Smoke: the generators never throw against the live worktree tree.
  const liveRoot = resolve(process.cwd());
  const liveWc = buildWorkContextRegistry(liveRoot);
  const liveWf = buildWorkflowRegistry(liveRoot);
  assert('live build returns arrays (no throw)', Array.isArray(liveWc.contexts) && Array.isArray(liveWf.workflows));
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

process.stdout.write(failures === 0 ? '\nPASSED\n' : `\nFAILED (${failures})\n`);
process.exit(failures === 0 ? 0 : 1);
