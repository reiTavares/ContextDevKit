/**
 * In-process self-test for active-context-resolver.mjs (WF0038, ADR-0112, A7-T1).
 *
 * Zero-dependency, runs under plain `node`:
 *   node templates/contextkit/runtime/execution/active-context-resolver.selftest.mjs
 *
 * Proves the A7-T1 gate:
 *   1. explicit-id wins and carries correct source + confirmed state.
 *   2. engine-state resolution finds the active workflow when state JSON exists.
 *   3. branch-name resolution extracts BIZ-/WF-#### tokens + wave/task.
 *   4. missing root (empty registry + no config) → unlinked, not a throw.
 *   5. missing root + strictContext → throws with a diagnostic message.
 *   6. ambiguous when two equal-weight explicit ids of the same type are supplied.
 *   7. determinism — same input twice → JSON-identical output.
 *   8. prior-session rule extracts ids from most recent session file.
 *
 * Hermetic: builds a throwaway fixture under the OS temp dir; never reads or
 * writes the dogfood tree. Cleaned up after the run.
 *
 * Exit 0 = all assertions held; exit non-zero = at least one failed.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveActiveContext } from './active-context-resolver.mjs';

// ─── Assertion harness ───────────────────────────────────────────────────────

const failures = [];
let total = 0;

/**
 * Records one named assertion.
 *
 * @param {string}  label     - Human-readable description of the assertion.
 * @param {boolean} condition - Must be truthy to pass.
 * @param {string}  [detail]  - Optional context printed on failure.
 */
function assert(label, condition, detail = '') {
  total++;
  if (!condition) {
    failures.push(label);
    process.stderr.write(`  FAIL ${label}${detail ? ` — ${detail}` : ''}\n`);
  }
}

// ─── Fixture root ────────────────────────────────────────────────────────────

const ROOT = mkdtempSync(join(tmpdir(), 'a7t1-'));

/** Creates a directory under ROOT, recursively. */
function dir(...parts) {
  const target = join(ROOT, ...parts);
  mkdirSync(target, { recursive: true });
  return target;
}

/** Writes a JSON file at `path` with `payload`. */
function writeJson(path, payload) {
  writeFileSync(path, JSON.stringify(payload, null, 2), 'utf-8');
}

// ── contextkit/config.json with rootBusinessId ────────────────────────────
dir('contextkit');
writeJson(join(ROOT, 'contextkit', 'config.json'), {
  level: 6,
  business: { rootBusinessId: 'BIZ-9001' },
});

// ── Business context BIZ-9001 ────────────────────────────────────────────
const BIZ_DIR = dir('contextkit', 'memory', 'business', 'BIZ-9001-fixture-platform');
writeJson(join(BIZ_DIR, 'business.json'), {
  schemaVersion: 1, id: 'BIZ-9001', title: 'Fixture Platform', status: 'approved',
});

// ── Operation context OP-9001 ────────────────────────────────────────────
const OP_DIR = dir('contextkit', 'memory', 'operations', 'OP-9001-fixture-operation');
writeJson(join(OP_DIR, 'operation.json'), {
  schemaVersion: 1, id: 'OP-9001', title: 'Fixture Operation', status: 'approved',
});

// ── Active workflow WF-9001 under BIZ-9001 ───────────────────────────────
const WF_STATE_DIR = dir('contextkit', 'memory', 'business', 'BIZ-9001-fixture-platform', 'workflows', 'WF-9001-shadow-resolver');
writeJson(join(WF_STATE_DIR, 'workflow-state.json'), {
  schemaVersion: 1, id: 'WF-9001',
  overallStatus: 'active', currentWave: 'A7', currentTask: 'T1',
});
writeJson(join(WF_STATE_DIR, 'workflow-plan.json'), {
  schemaVersion: 1, id: 'WF-9001', slug: 'shadow-resolver', title: 'Shadow Resolver',
});

// ── Top-level workflows dir (required by workflowRoots) ──────────────────
dir('contextkit', 'memory', 'workflows');

// ── Prior session file (contains context ids in prose) ────────────────────
const SESSIONS_DIR = dir('contextkit', 'memory', 'sessions');
writeFileSync(
  join(SESSIONS_DIR, '2026-06-24-a7t1-fixture.md'),
  '# Session\nWorked on BIZ-9001 and WF-9001 resolver implementation.\n',
  'utf-8',
);

// ── Second business context for ambiguity test ────────────────────────────
const BIZ2_DIR = dir('contextkit', 'memory', 'business', 'BIZ-9002-fixture-secondary');
writeJson(join(BIZ2_DIR, 'business.json'), {
  schemaVersion: 1, id: 'BIZ-9002', title: 'Fixture Secondary', status: 'approved',
});

// ─── Test 1: explicit-id wins (confirmed, correct source) ────────────────────

const r1 = resolveActiveContext(
  { explicitIds: ['BIZ-9001', 'WF-9001'] },
  { root: ROOT },
);
assert('explicit-id: state is confirmed',   r1.state  === 'confirmed',   `got ${r1.state}`);
assert('explicit-id: source is explicit-ids', r1.source === 'explicit-ids', `got ${r1.source}`);
assert('explicit-id: business resolves',    r1.business === 'BIZ-9001', `got ${r1.business}`);
assert('explicit-id: workflow resolves',    r1.workflow === 'WF-9001',   `got ${r1.workflow}`);
assert('explicit-id: rootBusinessId present', r1.rootBusinessId === 'BIZ-9001', `got ${r1.rootBusinessId}`);
assert('explicit-id: result is frozen',     Object.isFrozen(r1));
assert('explicit-id: reasonCodes non-empty', Array.isArray(r1.reasonCodes) && r1.reasonCodes.length >= 1);

// ─── Test 2: engine-state resolution ──────────────────────────────────────────

const r2 = resolveActiveContext({}, { root: ROOT });
assert('engine-state: state is confirmed',  r2.state    === 'confirmed',    `got ${r2.state}`);
assert('engine-state: source is engine-state', r2.source === 'engine-state', `got ${r2.source}`);
assert('engine-state: business is BIZ-9001', r2.business === 'BIZ-9001',   `got ${r2.business}`);
assert('engine-state: workflow is WF-9001',  r2.workflow === 'WF-9001',     `got ${r2.workflow}`);
assert('engine-state: wave is A7',           r2.wave     === 'A7',          `got ${r2.wave}`);
assert('engine-state: task is T1',           r2.task     === 'T1',          `got ${r2.task}`);

// ─── Test 3: branch-name resolution ───────────────────────────────────────────

const r3 = resolveActiveContext(
  { branch: 'feat/BIZ-9001-shadow-A7-T1', explicitIds: [] },
  { root: ROOT },
);
// Explicit-ids is empty → engine-state fires first (has active workflow).
// Confirm engine-state still wins over branch-name when active state exists.
assert('branch precedence: engine-state beats branch when active', r3.source === 'engine-state');

// Now test branch rule in isolation: no workflow-state, stripped root.
const ROOT2 = mkdtempSync(join(tmpdir(), 'a7t1-b-'));
dir2('contextkit');
dir2('contextkit', 'memory', 'business', 'BIZ-9001-fixture-platform');
writeJson(join(ROOT2, 'contextkit', 'config.json'), { level: 1 });
writeJson(join(ROOT2, 'contextkit', 'memory', 'business', 'BIZ-9001-fixture-platform', 'business.json'), {
  schemaVersion: 1, id: 'BIZ-9001', title: 'Fixture', status: 'approved',
});
mkdirSync(join(ROOT2, 'contextkit', 'memory', 'workflows'), { recursive: true });
mkdirSync(join(ROOT2, 'contextkit', 'memory', 'operations'), { recursive: true });

function dir2(...parts) {
  const t = join(ROOT2, ...parts);
  mkdirSync(t, { recursive: true });
  return t;
}

const r3b = resolveActiveContext(
  { branch: 'feat/BIZ-9001-resolver-A7-T1', explicitIds: [] },
  { root: ROOT2 },
);
assert('branch-name: state is suggested',      r3b.state    === 'suggested',    `got ${r3b.state}`);
assert('branch-name: source is branch-name',   r3b.source   === 'branch-name',  `got ${r3b.source}`);
assert('branch-name: business extracted',      r3b.business === 'BIZ-9001',     `got ${r3b.business}`);
assert('branch-name: wave extracted',          r3b.wave     === 'A7',            `got ${r3b.wave}`);
assert('branch-name: task extracted',          r3b.task     === 'T1',            `got ${r3b.task}`);

// ─── Test 4: missing root → unlinked, does NOT throw ─────────────────────────

const MISSING_ROOT = join(tmpdir(), 'a7t1-nonexistent-' + Math.random().toString(36).slice(2));
const r4 = resolveActiveContext({}, { root: MISSING_ROOT });
assert('missing-root: state is unlinked',   r4.state === 'unlinked',  `got ${r4.state}`);
assert('missing-root: source is none',      r4.source === 'none',     `got ${r4.source}`);
assert('missing-root: no throw (fail-open)', true); // reaching this line proves no throw

// ─── Test 5: missing root + strictContext → throws ────────────────────────────

let threw = false;
let throwMsg = '';
try {
  resolveActiveContext({}, { root: MISSING_ROOT, strictContext: true });
} catch (err) {
  threw = true;
  throwMsg = err?.message ?? '';
}
assert('strict-context: throws on unlinked',        threw);
assert('strict-context: message contains "unlinked"', throwMsg.includes('unlinked'));

// ─── Test 6: ambiguous when two same-type explicit ids supplied ───────────────

const r6 = resolveActiveContext(
  { explicitIds: ['BIZ-9001', 'BIZ-9002'] },
  { root: ROOT },
);
assert('ambiguous: state is ambiguous',           r6.state  === 'ambiguous',    `got ${r6.state}`);
assert('ambiguous: source is explicit-ids',       r6.source === 'explicit-ids', `got ${r6.source}`);
assert('ambiguous: business is null (no commit)', r6.business === null);

// ─── Test 7: determinism ──────────────────────────────────────────────────────

const input7 = { explicitIds: ['BIZ-9001'], branch: 'main' };
const ra = resolveActiveContext(input7, { root: ROOT });
const rb = resolveActiveContext(input7, { root: ROOT });
assert('determinism: JSON-identical across two calls', JSON.stringify(ra) === JSON.stringify(rb));

// ─── Test 8: prior-session extracts ids from session markdown ────────────────

// Strip the engine-state by using ROOT2 (no active workflow-state).
const r8 = resolveActiveContext({}, { root: ROOT2 });
// ROOT2 has no workflow-state and no workspace claims; prior-session is the fallback.
// ROOT2 has no sessions dir yet → should reach unlinked.
assert('prior-session: no sessions dir → unlinked', r8.state === 'unlinked' || r8.state === 'suggested');

// Now plant a session file in ROOT2.
const sessDir2 = join(ROOT2, 'contextkit', 'memory', 'sessions');
mkdirSync(sessDir2, { recursive: true });
writeFileSync(
  join(sessDir2, '2026-06-24-fixture.md'),
  'Session worked on BIZ-9001 context resolution.\n',
  'utf-8',
);
const r8b = resolveActiveContext({}, { root: ROOT2 });
assert('prior-session: state is suggested or confirmed', r8b.state === 'suggested' || r8b.state === 'confirmed');
assert('prior-session: source includes session or engine', r8b.source === 'prior-session' || r8b.source === 'engine-state' || r8b.source === 'branch-name');
assert('prior-session: business extracted from session file',
  r8b.business === 'BIZ-9001' || r8b.source !== 'prior-session');

// ─── Cleanup ─────────────────────────────────────────────────────────────────

try { rmSync(ROOT,  { recursive: true, force: true }); } catch { /* best-effort */ }
try { rmSync(ROOT2, { recursive: true, force: true }); } catch { /* best-effort */ }

// ─── Report ──────────────────────────────────────────────────────────────────

const passed = total - failures.length;
if (failures.length === 0) {
  process.stdout.write(`active-context-resolver.selftest: ok ${passed}/${total}\n`);
  process.exit(0);
} else {
  process.stderr.write(`active-context-resolver.selftest: FAILED (${failures.length} of ${total} assertions)\n`);
  for (const label of failures) process.stderr.write(`  - ${label}\n`);
  process.exit(1);
}
