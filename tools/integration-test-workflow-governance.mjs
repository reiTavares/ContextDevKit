/**
 * integration-test-workflow-governance.mjs - ADR-0070.
 *
 * Validates the workflow journey gate: `advance` refuses to leave a phase whose
 * deliverables are missing, `--force` overrides, and `check` reports the gaps.
 * (Numbering, branch-scoped guard, and migration are covered as they land.)
 */
import { writeFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { reporter, installFixture, git } from './it-helpers.mjs';
import { renumberByStarted, nextNumber } from '../templates/contextkit/tools/scripts/workflow-number.mjs';

const rep = reporter();
const fx = installFixture(rep);
const wf = (...a) => fx.script('workflow.mjs', ...a);
const wfRoot = join(fx.proj, 'contextkit', 'memory', 'workflows');
const wfDir = (slug) => {
  const hit = readdirSync(wfRoot).find((f) => f === slug || f.endsWith(`-${slug}`));
  return join(wfRoot, hit || slug);
};

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

// --- Numbering NNNN-slug (ADR-0070) ---
const nx = installFixture(rep);
const nxDir = join(nx.proj, 'contextkit', 'memory', 'workflows');
nx.script('workflow.mjs', 'new', 'num-a', '--kind', 'feature');
nx.script('workflow.mjs', 'new', 'num-b', '--kind', 'feature');
const folders = readdirSync(nxDir).filter((f) => f !== '_TEMPLATE');
folders.includes('0001-num-a') ? rep.ok('10. first workflow folder is 0001-num-a') : rep.bad(`10. expected 0001-num-a, got: ${folders.join(', ')}`);
folders.includes('0002-num-b') ? rep.ok('11. second workflow folder is 0002-num-b') : rep.bad(`11. expected 0002-num-b, got: ${folders.join(', ')}`);
// resolve by slug AND by number (check at intake has no gate -> exit 0).
nx.script('workflow.mjs', 'check', 'num-a').status === 0 ? rep.ok('12. resolves a workflow by slug') : rep.bad('12. slug resolution failed');
nx.script('workflow.mjs', 'check', '2').status === 0 ? rep.ok('13. resolves a workflow by number') : rep.bad('13. number resolution failed');
nx.cleanup();

// --- Date-ordered migration (renumberByStarted), idempotent ---
const mdir = mkdtempSync(join(tmpdir(), 'ck-wf-mig-'));
const mkWf = (name, started) => {
  mkdirSync(join(mdir, name), { recursive: true });
  writeFileSync(join(mdir, name, 'index.md'), `---\nslug: ${name}\nstarted: ${started}\ncurrentPhase: intake\n---\n`);
};
mkWf('beta', '2026-06-13T05:00:00.000Z'); // newer
mkWf('alpha', '2026-06-12T01:00:00.000Z'); // older -> 0001
renumberByStarted(mdir, { write: true });
let migrated = readdirSync(mdir);
migrated.includes('0001-alpha') && migrated.includes('0002-beta')
  ? rep.ok('14. migration renumbers by started date (oldest = 0001)')
  : rep.bad(`14. expected 0001-alpha + 0002-beta, got: ${migrated.join(', ')}`);
const secondPass = renumberByStarted(mdir, { write: true });
secondPass.length === 0 ? rep.ok('15. migration is idempotent (no-op on re-run)') : rep.bad(`15. re-run not idempotent: ${JSON.stringify(secondPass)}`);
nextNumber(mdir) === '0003' ? rep.ok('16. nextNumber follows the migrated max') : rep.bad(`16. expected 0003, got ${nextNumber(mdir)}`);
rmSync(mdir, { recursive: true, force: true });

rep.finish('workflow governance - gate + branch guard + numbering + migration (ADR-0070)');
