/**
 * Self-test for ownership-based ADR filing (ADR-0123).
 * Pure `node:*`, zero deps; exits non-zero on the first failed assertion.
 *
 * Coverage:
 *  1. `detectOwner` reads canonical `primaryContext` (BIZ/OP), a plain
 *     Business or Operation bold-bullet, and returns null when unattributed
 *     (the ADR's own top-level `id:` must NOT be mistaken for an owner).
 *  2. `planFiling` files BIZ→business/, OP→operations/, ownerless→legacy/, and
 *     ignores non-ADR files (README.md, _TEMPLATE.md).
 *  3. `applyFiling` performs atomic moves, is idempotent, preserves filenames.
 *  4. `auditReferences` counts path-based references to a moved file.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { detectOwner, planFiling, applyFiling, auditReferences } from './decisions-file.mjs';

let failures = 0;
function assert(label, condition) {
  process.stdout.write(`${condition ? '  ok  ' : 'FAIL  '}${label}\n`);
  if (!condition) failures += 1;
}

const root = mkdtempSync(resolve(tmpdir(), 'ckit-decfile-'));
try {
  process.stdout.write('Block A — detectOwner\n');
  const canonicalOp = '---\nid: ADR-0121\nprimaryContext:\n  type: operation\n  id: OP-0002\nrelatedContexts:\n  - type: business\n    id: BIZ-0001\n---\nbody';
  assert('A1: canonical primaryContext OP (not the ADR id)', detectOwner(canonicalOp) === 'OP-0002');
  assert('A2: plain **Operation** bullet', detectOwner('# ADR\n- **Operation**: OP-0003\n') === 'OP-0003');
  assert('A3: plain **Business** bullet', detectOwner('# ADR\n- **Business**: BIZ-0001\n') === 'BIZ-0001');
  assert('A4: unattributed → null', detectOwner('# ADR-0050\n- **Status**: Accepted\n') === null);

  const dir = `${pathsFor(root).memory}/decisions`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/0050-historic-unowned.md`, '# ADR-0050\n- **Status**: Accepted\n');
  writeFileSync(`${dir}/0122-amend-thing.md`, '# ADR-0122\n- **Operation**: OP-0003\n');
  writeFileSync(`${dir}/0099-biz-owned.md`, '# ADR-0099\n- **Business**: BIZ-0001\n');
  writeFileSync(`${dir}/README.md`, '# Decisions\n');         // must be ignored
  writeFileSync(`${dir}/_TEMPLATE.md`, '# template\n');       // must be ignored
  // a non-ADR referrer with a path-based link to the unowned ADR
  writeFileSync(`${dir}/notes.md`, 'see decisions/0050-historic-unowned.md\n');

  process.stdout.write('\nBlock B — planFiling\n');
  const plan = planFiling(root);
  const byFile = Object.fromEntries(plan.map((move) => [move.file, move]));
  assert('B1: plans only the 3 ADRs (README/_TEMPLATE/notes ignored)', plan.length === 3);
  assert('B2: unowned → legacy/', byFile['0050-historic-unowned.md'].to.replace(/\\/g, '/').endsWith('/decisions/legacy/0050-historic-unowned.md'));
  assert('B3: OP-attributed → operations/', byFile['0122-amend-thing.md'].subfolder === 'operations');
  assert('B4: BIZ-attributed → business/', byFile['0099-biz-owned.md'].subfolder === 'business');
  assert('B5: filename preserved', byFile['0099-biz-owned.md'].to.endsWith('0099-biz-owned.md'));

  process.stdout.write('\nBlock C — auditReferences (path-based refs)\n');
  const refs = auditReferences(root, plan.map((move) => move.file));
  assert('C1: counts the referrer to 0050', refs['0050-historic-unowned.md'] === 1);
  assert('C2: a file with no inbound path ref → 0', refs['0099-biz-owned.md'] === 0);

  process.stdout.write('\nBlock D — applyFiling (atomic, idempotent)\n');
  const applied = applyFiling(plan);
  assert('D1: applied 3 moves', applied.length === 3);
  assert('D2: legacy file on disk', existsSync(resolve(dir, 'legacy', '0050-historic-unowned.md')));
  assert('D3: operations file on disk', existsSync(resolve(dir, 'operations', '0122-amend-thing.md')));
  assert('D4: business file on disk', existsSync(resolve(dir, 'business', '0099-biz-owned.md')));
  assert('D5: source removed', !existsSync(resolve(dir, '0050-historic-unowned.md')));
  assert('D6: re-plan empty (idempotent; notes.md ignored)', planFiling(root).length === 0);
} finally {
  rmSync(root, { recursive: true, force: true });
}

process.stdout.write(failures === 0 ? '\nPASSED\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
