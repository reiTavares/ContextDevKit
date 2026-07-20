/**
 * In-process self-test for WF-0081 (BIZ-0006, ADR-0148 §1) — the no-code-prior
 * predicates that make the intake gates intent-aware. Tests the ACTUAL exported API
 * against in-memory fixtures (no disk, no live tree). Each section maps to the F1-F5
 * fixtures in the WF-0081 C0 reproduction report + the 6 binding acceptance criteria.
 *
 * Sections:
 *   [a] isSourceWrite — memory/docs/reports/scratch/host = non-source; runtime/tooling
 *       /templates + real config = source; unknown = source (safe bias)
 *   [b] sessionHasSourceWrite — F-B taskId binding; only a source write counts
 *   [c] currentCallRevokes — only Edit/Write/MultiEdit to a source path revokes
 *   [d] noCodePriorHolds — F1/F2 pure-question, F3 investigation-memory-only,
 *       F4 real-source-write guard, F5 fail-open on missing intent, regulated-domain
 *
 * Exit 0 = all held; exit 1 = at least one failed.
 */
import {
  isSourceWrite, sessionHasSourceWrite, currentCallRevokes, noCodePriorHolds,
} from './no-code-prior.mjs';

const failures = [];
function assert(label, cond, detail = '') {
  process.stdout.write(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}\n`);
  if (!cond) failures.push(label);
}

const noCode = (extra = {}) => ({
  signals: { domain: 'general', intent: { intent: 'no-code', mutationVerb: false, ...extra } },
});
const codeMod = (taskId, tool = 'Edit') => ({ taskId, tool, path: 'contextkit/runtime/hooks/execution-gate.mjs' });
const memMod = (taskId, tool = 'Write') => ({ taskId, tool, path: 'contextkit/memory/business/BIZ-0006/business.json' });

// [a] isSourceWrite
process.stdout.write('[a] isSourceWrite\n');
assert('memory path is NON-source', isSourceWrite('contextkit/memory/business/x.json') === false);
assert('docs path is NON-source', isSourceWrite('docs/guide.md') === false);
assert('reports path is NON-source', isSourceWrite('contextkit/memory/.../reports/c0-report.md') === false);
assert('scratch is NON-source', isSourceWrite('contextkit/pipeline/testing/042-x.scratch.md') === false);
assert('.claude host artifact is NON-source', isSourceWrite('.claude/settings.json') === false);
assert('runtime code IS source', isSourceWrite('contextkit/runtime/hooks/execution-gate.mjs') === true);
assert('templates code IS source', isSourceWrite('templates/contextkit/runtime/execution/x.mjs') === true);
assert('tools code IS source', isSourceWrite('tools/selfcheck.mjs') === true);
assert('a real root config IS source (R2 guard)', isSourceWrite('package.json') === true);
assert('windows backslashes normalized (memory)', isSourceWrite('contextkit\\memory\\x.json') === false);
assert('empty path defaults to source (safe bias)', isSourceWrite('') === true);
assert('undefined path defaults to source', isSourceWrite(undefined) === true);

// [b] sessionHasSourceWrite — F-B taskId binding
process.stdout.write('[b] sessionHasSourceWrite\n');
assert('memory-only writes ⇒ no source write', sessionHasSourceWrite([memMod('T1'), memMod('T1')], 'T1') === false);
assert('a source write for the task ⇒ true', sessionHasSourceWrite([memMod('T1'), codeMod('T1')], 'T1') === true);
assert('source write for a DIFFERENT task ⇒ false (F-B binding)', sessionHasSourceWrite([codeMod('T2')], 'T1') === false);
assert('a Read (non-write tool) never counts', sessionHasSourceWrite([{ taskId: 'T1', tool: 'Read', path: 'contextkit/runtime/x.mjs' }], 'T1') === false);
assert('empty ledger ⇒ false', sessionHasSourceWrite([], 'T1') === false);
assert('non-array ledger ⇒ false (defensive)', sessionHasSourceWrite(null, 'T1') === false);

// [c] currentCallRevokes
process.stdout.write('[c] currentCallRevokes\n');
assert('Edit to source path revokes', currentCallRevokes('Edit', ['contextkit/runtime/hooks/x.mjs']) === true);
assert('Write to memory path does NOT revoke', currentCallRevokes('Write', ['contextkit/memory/x.json']) === false);
assert('Read to source path does NOT revoke (not a write)', currentCallRevokes('Read', ['contextkit/runtime/x.mjs']) === false);
assert('MultiEdit mixed paths revokes if any is source', currentCallRevokes('MultiEdit', ['docs/a.md', 'tools/b.mjs']) === true);
assert('no paths ⇒ false', currentCallRevokes('Edit', []) === false);

// [d] noCodePriorHolds — the F1-F5 fixtures
process.stdout.write('[d] noCodePriorHolds (F1-F5)\n');
assert('F1/F2 pure question, no writes ⇒ prior holds (suppress)', noCodePriorHolds(noCode(), [], 'T1') === true);
assert('F3 investigation, memory-only writes ⇒ prior STILL holds (the meta-bug fix)', noCodePriorHolds(noCode(), [memMod('T1')], 'T1') === true);
assert('F4 real source write ⇒ prior REVOKED (over-permissive guard)', noCodePriorHolds(noCode(), [codeMod('T1')], 'T1') === false);
assert('F5 no intent signal ⇒ fail-open false (unchanged behavior)', noCodePriorHolds({ signals: {} }, [], 'T1') === false);
assert('mutationVerb ⇒ code intent ⇒ prior does not hold', noCodePriorHolds(noCode({ mutationVerb: true }), [], 'T1') === false);
assert('regulated domain (lgpd) ⇒ never invert ⇒ false', noCodePriorHolds({ signals: { domain: 'lgpd', intent: { intent: 'no-code', mutationVerb: false } } }, [], 'T1') === false);
assert('malformed contract ⇒ fail-open false', noCodePriorHolds(null, [], 'T1') === false);
assert('code intent verdict ⇒ false', noCodePriorHolds({ signals: { domain: 'general', intent: { intent: 'code', mutationVerb: false } } }, [], 'T1') === false);

if (failures.length) {
  process.stdout.write(`\n✗ no-code-prior selftest: ${failures.length} failure(s): ${failures.join('; ')}\n`);
  process.exit(1);
}
process.stdout.write('\n✓ no-code-prior selftest: all assertions held\n');
