/**
 * integration-test-workflow-governance.mjs - ADR-0070.
 *
 * Validates the workflow journey gate: `advance` refuses to leave a phase whose
 * deliverables are missing, `--force` overrides, and `check` reports the gaps.
 * (Numbering, branch-scoped guard, and migration are covered as they land.)
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { reporter, installFixture, git } from './it-helpers.mjs';

const rep = reporter();
const fx = installFixture(rep);
const wf = (...a) => fx.script('workflow.mjs', ...a);
const wfDir = (slug) => join(fx.proj, 'contextkit', 'memory', 'workflows', slug);

// new -> intake. First advance (intake -> prd) has no leave-gate.
wf('new', 'gate-test', '--kind', 'feature').status === 0 ? rep.ok('1. new workflow created') : rep.bad('1. new failed');
wf('advance', 'gate-test').status === 0 ? rep.ok('2. intake -> prd (no gate)') : rep.bad('2. intake advance failed');

// At prd with an empty scaffold, advance MUST refuse.
const blocked = wf('advance', 'gate-test');
blocked.status !== 0 && /Problem|prd\.md|missing/i.test(blocked.stderr + blocked.stdout)
  ? rep.ok('3. prd -> spec refused while prd.md empty')
  : rep.bad(`3. expected refusal, got status ${blocked.status}: ${blocked.stderr}`);

// check reports the gap (exit 1).
const checked = wf('check', 'gate-test');
checked.status !== 0 && /prd/i.test(checked.stdout + checked.stderr)
  ? rep.ok('4. check lists the prd gap')
  : rep.bad(`4. check should report prd gap, got: ${checked.stdout}`);

// Fill prd.md; advance now passes.
writeFileSync(join(wfDir('gate-test'), 'prd.md'), '# PRD\n\n## Problem\nReal problem statement.\n\n## Goals\nReal goal.\n');
wf('advance', 'gate-test').status === 0 ? rep.ok('5. prd -> spec after filling prd.md') : rep.bad('5. advance after fill failed');

// --force overrides the spec gate (spec.md still empty scaffold).
wf('advance', 'gate-test', '--force').status === 0 ? rep.ok('6. --force overrides the spec gate') : rep.bad('6. --force did not override');

// check on a satisfied phase (force moved us to adr; decisions.md empty, so check exits 1).
const adrCheck = wf('check', 'gate-test');
adrCheck.status !== 0 && /ADR|decisions/i.test(adrCheck.stdout + adrCheck.stderr)
  ? rep.ok('7. adr phase gate reports missing ADR link')
  : rep.bad(`7. expected adr gap, got: ${adrCheck.stdout}`);

fx.cleanup();

// --- Branch-scoped L5 guard (ADR-0070) ---
const gx = installFixture(rep);
const edit = { session_id: 'it', tool_name: 'Edit', tool_input: { file_path: 'src/app.js' } };
// A fresh pre-ship workflow is stamped with the fixture's current branch (main).
gx.script('workflow.mjs', 'new', 'branch-wf', '--kind', 'feature');
let out = gx.hook('simulate-gate.mjs', edit);
/BLOCKED|workflow/i.test(out)
  ? rep.ok('8. pre-ship workflow blocks edits ON its own branch')
  : rep.bad(`8. expected block on same branch, got: ${out.slice(0, 80)}`);

// Switch to a different branch; the main-branch workflow must NOT block here.
git(['checkout', '-b', 'feat/other'], gx.proj);
out = gx.hook('simulate-gate.mjs', edit);
/BLOCKED/i.test(out)
  ? rep.bad('9. workflow on "main" wrongly blocked an edit on "feat/other"')
  : rep.ok('9. workflow on another branch does not block - cross-branch flow preserved');

gx.cleanup();
rep.finish('workflow governance - journey gate + branch-scoped guard (ADR-0070)');
