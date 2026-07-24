/**
 * In-process self-test for WF-0088 (BIZ-0006, ADR-0148 position 11) — the
 * governance-contract envelope: schema + validator + emit hook. Tests the ACTUAL
 * exported API against in-memory fixtures and a temp dir (no live tree).
 *
 * Sections:
 *   [a] validator — round-trip (valid passes), malformed rejection (drift bugs +
 *       live-state leak), override invariant, uncovered governing decision, never-throws
 *   [b] emit — validate-before-write, diff-aware idempotency, atomic, self-heal,
 *       override serialization, fail-open on any garbage (never throws)
 *   [c] refresh — status-move rewrite, no-op unchanged, no-file skip, fail-open
 *   [d] SCOPE GUARD — the BIZ-0002 seam: 0 runtime/dispatcher/adapter code ships;
 *       the reader example carries no executable adapter (ADR-0148 position 11)
 *
 * Exit 0 = all held; exit 1 = at least one failed.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateGovernanceContract } from './schema-governance-contract.mjs';
import {
  buildGovernanceContract,
  emitGovernanceContract,
  refreshGovernanceContract,
  GOVERNANCE_CONTRACT_FILENAME,
} from '../../tools/scripts/emit-governance-contract.mjs';
import {
  readGovernanceContract,
  formatGovernanceContractAdvisory,
  renderGovernanceContractAdvisory,
} from '../../tools/scripts/read-governance-contract.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..'); // templates/contextkit/runtime/work → repo root
const failures = [];
function assert(label, cond, detail = '') {
  process.stdout.write(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}\n`);
  if (!cond) failures.push(label);
}

/** A canonical schema-valid contract fixture (covered). */
const validCovered = () => ({
  schemaVersion: 1,
  contextRef: { type: 'workflow', id: 'WF-0088' },
  ceremonyShape: 'multi-workflow-program',
  resolvedAxes: { nature: 'business', executionMode: 'workflow', tier: 'architectural', kind: 'capability' },
  ceremonyOverride: { applied: false, resolvedShape: null, shape: null, reason: null, authorizedBy: null, authorizedAt: null },
  governingDecision: { ref: 'ADR-0148', status: 'accepted' },
  stateAuthority: 'workflow-state.json (fold of the ADR-0043 event journal)',
  derivedFrom: { resolver: 'resolveCeremonyShape', classifier: 'work-classifier' },
  emittedAt: '2026-07-24T10:00:00.000Z',
  emittedBy: 'create',
});

// [a] validator
process.stdout.write('[a] validateGovernanceContract\n');
assert('a schema-valid covered contract passes', validateGovernanceContract(validCovered()).ok === true);
{
  const uncovered = { ...validCovered(), governingDecision: { ref: null, status: null } };
  assert('uncovered { ref:null, status:null } is valid (created before its ADR exists)', validateGovernanceContract(uncovered).ok === true);
}
{
  const bad = validCovered();
  bad.resolvedAxes = { nature: 'business', executionMode: 'decision', tier: 'architectural', kind: 'capability', workType: 'x' };
  const r = validateGovernanceContract(bad);
  assert('polluted executionMode "decision" is rejected (round-trip drift bug)', r.ok === false && r.errors.some((e) => e.includes('executionMode')));
  assert('phantom resolvedAxes.workType is rejected (invented field)', r.errors.some((e) => e.includes('workType')));
}
{
  const bad = { ...validCovered(), taskStates: { GC0: 'done' } };
  const r = validateGovernanceContract(bad);
  assert('a live-state leak (taskStates) is rejected (containment / projection)', r.ok === false && r.errors.some((e) => e.includes('taskStates')));
}
{
  const bad = validCovered();
  bad.ceremonyOverride = { applied: true, resolvedShape: null, shape: 'quick-fix', reason: null, authorizedBy: null, authorizedAt: null };
  const r = validateGovernanceContract(bad);
  assert('applied override with null coupled fields is rejected (co-occurrence invariant)', r.ok === false && r.errors.some((e) => e.includes('authorizedBy')));
}
{
  const bad = validCovered();
  bad.governingDecision = { ref: null, status: 'accepted' };
  assert('governingDecision ref:null + status set is rejected (ref⟺status co-occur)', validateGovernanceContract(bad).ok === false);
}
assert('null never throws → ok:false', validateGovernanceContract(null).ok === false);
assert('a string never throws → ok:false', validateGovernanceContract('nope').ok === false);

// [b] emit
process.stdout.write('[b] emitGovernanceContract\n');
{
  const dir = mkdtempSync(join(tmpdir(), 'gc-st-'));
  const base = { ...validCovered(), contextDir: dir, nature: 'business', executionMode: 'workflow', tier: 'architectural', kind: 'capability', shape: 'multi-workflow-program', governingDecision: { ref: 'ADR-0148', status: 'accepted' }, emittedBy: 'create', now: '2026-07-24T10:00:00.000Z' };
  const r1 = emitGovernanceContract(base);
  assert('emit-on-create writes the contract', r1.emitted === true && existsSync(join(dir, GOVERNANCE_CONTRACT_FILENAME)));
  const written = JSON.parse(readFileSync(join(dir, GOVERNANCE_CONTRACT_FILENAME), 'utf-8'));
  assert('written contract is schema-valid', validateGovernanceContract(written).ok === true);
  const r2 = emitGovernanceContract({ ...base, emittedBy: 'transition', now: '2026-07-24T11:00:00.000Z' });
  assert('diff-aware: identical payload on transition ⇒ unchanged (no churn)', r2.emitted === false && r2.reason === 'unchanged');
  const r3 = emitGovernanceContract({ ...base, tier: 'feature', emittedBy: 'transition', now: '2026-07-24T12:00:00.000Z' });
  assert('a real axis change ⇒ rewrite', r3.emitted === true && r3.reason === 'transition');
  writeFileSync(join(dir, GOVERNANCE_CONTRACT_FILENAME), '{ not json');
  const r4 = emitGovernanceContract({ ...base, tier: 'feature', emittedBy: 'transition', now: '2026-07-24T13:00:00.000Z' });
  assert('self-heal: a corrupt existing contract ⇒ rewrite', r4.emitted === true);
}
{
  const dir = mkdtempSync(join(tmpdir(), 'gc-st2-'));
  const r = emitGovernanceContract({ ...validCovered(), contextDir: dir, nature: 'business', executionMode: 'decision', tier: 'architectural', kind: 'capability', shape: 'multi-workflow-program', governingDecision: { ref: 'ADR-0148', status: 'accepted' }, emittedBy: 'create', now: 'x' });
  assert('validate-before-write: an invalid contract is NOT written', r.emitted === false && r.reason === 'invalid' && !existsSync(join(dir, GOVERNANCE_CONTRACT_FILENAME)));
}
{
  const dir = mkdtempSync(join(tmpdir(), 'gc-st3-'));
  emitGovernanceContract({ ...validCovered(), contextDir: dir, nature: 'business', executionMode: 'workflow', tier: 'architectural', kind: 'capability', shape: 'multi-workflow-program', governingDecision: { ref: 'ADR-0148', status: 'accepted' }, emittedBy: 'create', now: '2026-07-24T10:00:00.000Z', override: { applied: true, shape: 'decision-only', reason: 'manual downgrade', authorizedBy: 'human:IT', authorizedAt: '2026-07-24T09:00:00.000Z' } });
  const c = JSON.parse(readFileSync(join(dir, GOVERNANCE_CONTRACT_FILENAME), 'utf-8'));
  assert('override serialization: effective shape = override target', c.ceremonyShape === 'decision-only');
  assert('override serialization: resolvedShape preserved alongside', c.ceremonyOverride.resolvedShape === 'multi-workflow-program' && c.ceremonyOverride.applied === true);
}
assert('emit fail-open: null args never throws', emitGovernanceContract(null).emitted === false);
assert('emit fail-open: {} never throws', emitGovernanceContract({}).emitted === false);
assert('buildGovernanceContract uncovered ⇒ valid object', validateGovernanceContract(buildGovernanceContract({ ...validCovered(), nature: 'business', executionMode: 'workflow', tier: 'architectural', kind: 'capability', shape: 'multi-workflow-program', governingDecision: { ref: null, status: null }, emittedBy: 'create', now: '2026-07-24T10:00:00.000Z' })).ok === true);

// [c] refresh
process.stdout.write('[c] refreshGovernanceContract\n');
{
  const dir = mkdtempSync(join(tmpdir(), 'gc-st4-'));
  emitGovernanceContract({ ...validCovered(), contextDir: dir, nature: 'business', executionMode: 'workflow', tier: 'architectural', kind: 'capability', shape: 'multi-workflow-program', governingDecision: { ref: 'ADR-0200', status: 'proposed' }, emittedBy: 'create', now: '2026-07-24T10:00:00.000Z' });
  const r = refreshGovernanceContract({ contextDir: dir, governingDecision: { ref: 'ADR-0200', status: 'accepted' }, emittedBy: 'transition', now: '2026-07-24T12:00:00.000Z' });
  const c = JSON.parse(readFileSync(join(dir, GOVERNANCE_CONTRACT_FILENAME), 'utf-8'));
  assert('refresh: a status move (proposed→accepted) rewrites', r.emitted === true && c.governingDecision.status === 'accepted');
  const r2 = refreshGovernanceContract({ contextDir: dir, governingDecision: { ref: 'ADR-0200', status: 'accepted' }, emittedBy: 'transition', now: '2026-07-24T13:00:00.000Z' });
  assert('refresh no-op: same status ⇒ unchanged', r2.emitted === false && r2.reason === 'unchanged');
}
{
  const dir = mkdtempSync(join(tmpdir(), 'gc-st5-'));
  const r = refreshGovernanceContract({ contextDir: dir, governingDecision: { ref: 'X', status: 'accepted' }, emittedBy: 'transition', now: 'x' });
  assert('refresh when no contract exists ⇒ skipped', r.emitted === false && r.reason === 'insufficient-inputs');
}
assert('refresh fail-open: null never throws', refreshGovernanceContract(null).emitted === false);

// [d] SCOPE GUARD — the BIZ-0002 seam stays schema-only (ADR-0148 position 11)
process.stdout.write('[d] scope guard (0 runtime/dispatcher/adapter)\n');
{
  // Strip comments so the guard scans CODE, not the header prose that draws the
  // seam by NAMING GovernedExecutionEnvelope to say it is not built here.
  const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
  const emitCode = stripComments(readFileSync(join(REPO_ROOT, 'templates/contextkit/tools/scripts/emit-governance-contract.mjs'), 'utf-8'));
  const bizCode = stripComments(readFileSync(join(REPO_ROOT, 'templates/contextkit/tools/scripts/emit-business-contract.mjs'), 'utf-8'));
  // Forbidden EXECUTABLE runtime idioms — dispatch/exec/envelope as code, not prose:
  const forbidden = [
    /from ['"](node:)?child_process['"]/, /require\(['"](node:)?child_process/,
    /\.spawn(Sync)?\s*\(/, /\.exec(Sync|File)?\s*\(/,
    /new\s+GovernedExecutionEnvelope/, /class\s+GovernedExecutionEnvelope/,
    /dispatchAgent\s*\(/, /new\s+Worker\b/,
  ];
  const hit = (code) => forbidden.find((rx) => rx.test(code));
  assert('emit module ships no dispatcher/exec/envelope runtime CODE', !hit(emitCode), String(hit(emitCode)));
  assert('business adapter ships no dispatcher/exec/envelope runtime CODE', !hit(bizCode), String(hit(bizCode)));
  const readerDoc = readFileSync(join(REPO_ROOT, 'docs/reference/governance-contract.md'), 'utf-8');
  assert('reader example ships no executable .mjs adapter (illustration only)', !/```[a-z]*\s*\n[\s\S]*?\bimport\s+\{[\s\S]*?\bfrom\s+['"]\.[\s\S]*?```/.test(readerDoc));
  assert('no GovernedExecutionEnvelope class is defined here', !/class\s+GovernedExecutionEnvelope/.test(emitCode));
}

// [e] advisory reader — the contract is READ + surfaced (advisory default-on), not shadow
process.stdout.write('[e] read-only advisory reader\n');
{
  const dir = mkdtempSync(join(tmpdir(), 'gc-rd-'));
  emitGovernanceContract({
    contextDir: dir, contextRef: { type: 'business', id: 'BIZ-0006' },
    nature: 'business', executionMode: 'workflow', tier: 'architectural', kind: 'initiative',
    shape: 'multi-workflow-program', governingDecision: { ref: 'ADR-0148', status: 'accepted' },
    emittedBy: 'create', now: '2026-07-24T17:00:00.000Z',
  });
  const contract = readGovernanceContract(dir);
  assert('reader reads a valid contract from disk', contract !== null && contract.ceremonyShape === 'multi-workflow-program');
  const advisory = formatGovernanceContractAdvisory(contract);
  assert('advisory block names the effective shape', advisory.includes('shape: multi-workflow-program'));
  assert('advisory block names the governing decision', advisory.includes('ADR-0148 (accepted)'));
  assert('advisory block declares read-only / never blocks', advisory.includes('never blocks'));
  assert('reader returns null for an absent contract (skip, not throw)', readGovernanceContract(mkdtempSync(join(tmpdir(), 'gc-empty-'))) === null);
  assert('formatter on null → empty string (never throws)', formatGovernanceContractAdvisory(null) === '');
  assert('render on null id → empty string (fail-open)', renderGovernanceContractAdvisory('.', null) === '');
  // A malformed on-disk contract must be rejected by validate-on-read → reader returns null.
  writeFileSync(join(dir, GOVERNANCE_CONTRACT_FILENAME), '{"schemaVersion":1,"resolvedAxes":{"executionMode":"decision"}}');
  assert('reader rejects a malformed on-disk contract (validate-on-read)', readGovernanceContract(dir) === null);
}

if (failures.length) {
  process.stdout.write(`\n✗ governance-contract selftest: ${failures.length} failure(s): ${failures.join('; ')}\n`);
  process.exit(1);
}
process.stdout.write('\n✓ governance-contract selftest: all assertions held\n');
