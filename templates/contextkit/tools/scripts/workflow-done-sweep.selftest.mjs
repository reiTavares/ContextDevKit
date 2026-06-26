/**
 * Self-test for the `done/` lifecycle sweep (ADR-0119).
 * Pure `node:*`, zero deps; exits non-zero on the first failed assertion.
 *
 * Coverage:
 *  1. `parseFrontmatter` reads owner/conclusion from index.md frontmatter.
 *  2. `planSweep` files owned→`<owner>/done`, unowned→global `workflows/done`, and
 *     leaves non-concluded (`conclusion: pending`) workflows in place.
 *  3. `applySweep` performs atomic moves, is idempotent, and the filed number is
 *     still counted by `nextWorkflowNumber` (never reused).
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { nextWorkflowNumber } from './registry/ids.mjs';
import { parseFrontmatter, planSweep, applySweep, resolveOwnerDir } from './workflow-done-sweep.mjs';

let failures = 0;
function assert(label, condition) {
  process.stdout.write(`${condition ? '  ok  ' : 'FAIL  '}${label}\n`);
  if (!condition) failures += 1;
}

/** Writes a workflow index.md with the given frontmatter fields. */
function writeWorkflow(holder, name, fields) {
  const dir = resolve(holder, name);
  mkdirSync(dir, { recursive: true });
  const front = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n');
  writeFileSync(resolve(dir, 'index.md'), `---\n${front}\n---\n# ${name}\n`);
}

const root = mkdtempSync(resolve(tmpdir(), 'ckit-sweep-'));
try {
  process.stdout.write('Block A — parseFrontmatter\n');
  const front = parseFrontmatter('---\nowner: BIZ-0001\nconclusion: done\n---\nbody');
  assert('A1: reads owner', front.owner === 'BIZ-0001');
  assert('A2: reads conclusion', front.conclusion === 'done');
  assert('A3: no frontmatter → {}', Object.keys(parseFrontmatter('no front')).length === 0);

  const memory = pathsFor(root).memory;
  // an owner dir must exist on disk for owned resolution
  mkdirSync(resolve(memory, 'business', 'BIZ-0001-fixture'), { recursive: true });
  writeWorkflow(`${memory}/workflows`, '0070-unowned', { number: '0070', currentPhase: 'conclusion', conclusion: 'done' });
  writeWorkflow(`${memory}/business/BIZ-0001-fixture/workflows`, '0071-owned', { number: '0071', owner: 'BIZ-0001', currentPhase: 'conclusion', conclusion: 'done' });
  writeWorkflow(`${memory}/workflows`, '0072-active', { number: '0072', currentPhase: 'ship', conclusion: 'pending' });

  process.stdout.write('\nBlock B — planSweep\n');
  assert('B0: resolveOwnerDir finds the owner folder', Boolean(resolveOwnerDir(root, 'BIZ-0001')));
  const plan = planSweep(root);
  assert('B1: plans exactly 2 concluded (skips active)', plan.length === 2);
  const unowned = plan.find((m) => m.from.endsWith('0070-unowned'));
  const owned = plan.find((m) => m.from.endsWith('0071-owned'));
  assert('B2: unowned → global workflows/done', unowned && unowned.to.replace(/\\/g, '/').endsWith('/workflows/done/0070-unowned'));
  assert('B3: owned → BIZ-0001-fixture/done', owned && owned.to.replace(/\\/g, '/').endsWith('/BIZ-0001-fixture/done/0071-owned'));
  assert('B4: active 0072 not planned', !plan.some((m) => m.from.endsWith('0072-active')));

  process.stdout.write('\nBlock C — applySweep (atomic, idempotent, number kept)\n');
  const applied = applySweep(plan);
  assert('C1: applied 2 moves', applied.length === 2);
  assert('C2: owned filed on disk', existsSync(resolve(memory, 'business', 'BIZ-0001-fixture', 'done', '0071-owned', 'index.md')));
  assert('C3: unowned filed on disk', existsSync(resolve(memory, 'workflows', 'done', '0070-unowned', 'index.md')));
  assert('C4: source dirs gone', !existsSync(resolve(memory, 'workflows', '0070-unowned')));
  assert('C5: re-plan is empty (idempotent)', planSweep(root).length === 0);
  assert('C6: filed number still counted → next ≥ 0072', parseInt(nextWorkflowNumber(root), 10) >= 72);
} finally {
  rmSync(root, { recursive: true, force: true });
}

process.stdout.write(failures === 0 ? '\nPASSED\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
