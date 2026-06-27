/**
 * integration-test-subagent-gate.mjs — end-to-end tests for the subagent-gate.mjs
 * hook (CDK-041, ADR-0072).
 *
 * Drives the REAL installed hook as a subprocess via installFixture/hook(), exactly
 * as Claude Code invokes it. All cases are HERMETIC: fixture git branch is `main`,
 * no custom rubric/registry, advisory mode (the install default).
 *
 * Coverage:
 *   SG1. L4 (below 5): hook inert — silent, exit 0.
 *   SG2. SPAWN (PreToolUse on Task) with a declared touch-set → records a spawn
 *          file under <pipeline>/state/<taskId>/subagents/ ; spawn is silent.
 *   SG3. COMPLETION (SubagentStop) with an OUT-OF-SCOPE observed write → advisory
 *          warning on stdout, NO decision:block (REAL-OUTPUT case).
 *   SG4. COMPLETION with an in-scope observed write → hook silent.
 *   SG5. No activeTask (UNREGISTERED) → hook silent.
 *   SG6. Malformed stdin → exit 0, silent (fail-open, direct spawnSync).
 */
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { installFixture, reporter } from './it-helpers.mjs';

const rep = reporter();

const TASK_ID = 'task-sg-001';
const SESSION_ID = 'sess-sg-test-01';
// MUST match the fixture's git branch (installFixture does `git init -b main`).
const BRANCH = 'main';

/** Minimal feature contract — no required moments needed for scope governance. */
const featureContract = {
  version: 1,
  taskId: TASK_ID,
  sessionId: SESSION_ID,
  branch: BRANCH,
  host: 'claude',
  signals: { tier: 'feature', domain: 'core', level: 5, needsAdr: false, paths: [] },
  requiredBeforeExploration: [],
  requiredBeforeWrite: [],
  requiredBeforeCompletion: [],
  recommended: [],
  createdAt: Date.now(),
  history: [],
};

/**
 * Seeds the session ledger with activeTask (+ optional extra fields like
 * modifications) so the hook treats this as a registered task.
 *
 * @param {string} proj fixture root
 * @param {object} [overrides] extra ledger fields
 */
function seedLedger(proj, overrides = {}) {
  const sessDir = join(proj, '.claude', '.sessions');
  mkdirSync(sessDir, { recursive: true });
  const ledger = {
    sessionId: SESSION_ID,
    startedAt: Date.now(),
    modifications: [],
    registered: false,
    stopWarnedAt: null,
    activeTask: TASK_ID,
    ...overrides,
  };
  writeFileSync(join(sessDir, `${SESSION_ID}.json`), JSON.stringify(ledger, null, 2), 'utf-8');
}

/** Task PreToolUse (spawn) payload with an explicit declared touch-set. */
const spawnPayload = () => ({
  session_id: SESSION_ID,
  hook_event_name: 'PreToolUse',
  tool_name: 'Task',
  tool_input: { subagent_type: 'context-keeper', description: 'do a thing', touch_set: ['src/'] },
});

/** SubagentStop (completion) payload. */
const completionPayload = () => ({
  session_id: SESSION_ID,
  hook_event_name: 'SubagentStop',
});

const { proj, cfgPath, hook, cleanup } = installFixture(rep);

// Resolve module paths inside the fixture for contract seeding.
const CONTRACT_PATH = join(proj, 'contextkit', 'runtime', 'execution', 'execution-contract.mjs');
let saveContract;
try {
  ({ saveContract } = await import('file://' + CONTRACT_PATH.replaceAll('\\', '/')));
} catch (err) {
  rep.bad(`contract module import failed: ${err?.message ?? err}`);
  cleanup();
  rep.finish('subagent-gate (CDK-041)');
}

function subagentsDir() {
  return join(proj, 'contextkit', 'pipeline', 'state', TASK_ID, 'subagents');
}

function spawnRecordFiles() {
  try {
    return readdirSync(subagentsDir()).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
}

try {
  // SG1. L4 inert guard.
  console.log('\nSG1. L4 inert guard...');
  {
    writeFileSync(cfgPath, JSON.stringify({ level: 4 }), 'utf-8');
    seedLedger(proj);
    saveContract(proj, TASK_ID, featureContract);
    const out = hook('subagent-gate.mjs', spawnPayload());
    (out === '' || !out.includes('subagent-gate')) && spawnRecordFiles().length === 0
      ? rep.ok('SG1. L4: hook inert (silent, no spawn record)')
      : rep.bad(`SG1. L4: expected inert, got out=${out.slice(0, 120)} files=${spawnRecordFiles().length}`);
  }

  // Restore L5. Advisory mode is explicit here so SG3 (which tests warn-only,
  // non-blocking behaviour on out-of-scope writes) is not affected by the guarded
  // default introduced in ADR-0125. SG2/SG4/SG5/SG6 are mode-agnostic (spawn
  // recording, in-scope, no task, and malformed input each resolve before
  // enforcement mode is consulted).
  writeFileSync(cfgPath, JSON.stringify({ level: 5, enforcement: { mode: 'advisory' } }), 'utf-8');

  // SG2. SPAWN records a spawn file, silent.
  console.log('\nSG2. SPAWN records a spawn file...');
  {
    seedLedger(proj);
    saveContract(proj, TASK_ID, featureContract);
    const out = hook('subagent-gate.mjs', spawnPayload());
    const files = spawnRecordFiles();
    files.length === 1
      ? rep.ok('SG2. spawn record persisted under pipeline state substrate')
      : rep.bad(`SG2. expected 1 spawn record, found ${files.length}`);
    out === '' || !out.includes('subagent-gate')
      ? rep.ok('SG2. spawn moment is silent (recording is not a finding)')
      : rep.bad(`SG2. expected silence on spawn, got: ${out.slice(0, 160)}`);
  }

  // SG3. COMPLETION with an OUT-OF-SCOPE observed write → advisory warning (REAL-OUTPUT).
  console.log('\nSG3. COMPLETION out-of-scope write → advisory warning...');
  {
    // Spawn first (declared touch-set = ['src/']).
    seedLedger(proj);
    hook('subagent-gate.mjs', spawnPayload());
    // Now seed an out-of-scope modification recorded AFTER the spawn, then complete.
    const future = Date.now() + 10_000_000;
    seedLedger(proj, { modifications: [{ path: 'lib/rogue.mjs', tool: 'Write', at: future }] });
    const out = hook('subagent-gate.mjs', completionPayload());
    out.includes('subagent-gate') && out.includes('subagent-out-of-scope-write')
      ? rep.ok('SG3. advisory text emitted with subagent-out-of-scope-write code')
      : rep.bad(`SG3. advisory text missing/wrong: ${out.slice(0, 300)}`);
    out.includes('lib/rogue.mjs')
      ? rep.ok('SG3. output names the out-of-scope path')
      : rep.bad(`SG3. output missing the offending path: ${out.slice(0, 200)}`);
    !out.includes('"decision":"block"') && !out.includes('"decision": "block"')
      ? rep.ok('SG3. advisory mode does NOT block (no decision:block in stdout)')
      : rep.bad('SG3. advisory should NOT produce a block decision');
  }

  // SG4. COMPLETION with an in-scope write → silent.
  console.log('\nSG4. COMPLETION in-scope write → silent...');
  {
    seedLedger(proj);
    hook('subagent-gate.mjs', spawnPayload());
    const future = Date.now() + 10_000_000;
    seedLedger(proj, { modifications: [{ path: 'src/feature.mjs', tool: 'Write', at: future }] });
    const out = hook('subagent-gate.mjs', completionPayload());
    out === '' || !out.includes('subagent-gate')
      ? rep.ok('SG4. in-scope write → hook silent')
      : rep.bad(`SG4. expected silence for in-scope write, got: ${out.slice(0, 200)}`);
  }

  // SG5. No activeTask → silent.
  console.log('\nSG5. No activeTask (UNREGISTERED) → silent...');
  {
    seedLedger(proj, { activeTask: undefined });
    const out = hook('subagent-gate.mjs', completionPayload());
    out === '' || !out.includes('subagent-gate')
      ? rep.ok('SG5. no activeTask → hook silent')
      : rep.bad(`SG5. expected silence when unregistered, got: ${out.slice(0, 200)}`);
  }

  // SG6. Malformed stdin → exit 0, silent (fail-open, direct spawnSync).
  console.log('\nSG6. Malformed stdin → fail-open...');
  {
    const { spawnSync } = await import('node:child_process');
    const hookFile = join(proj, 'contextkit', 'runtime', 'hooks', 'subagent-gate.mjs');
    const result = spawnSync(process.execPath, [hookFile], {
      cwd: proj,
      input: 'not-valid-json{{{',
      encoding: 'utf-8',
      timeout: 15_000,
    });
    result.status === 0
      ? rep.ok('SG6. malformed stdin → exit 0 (fail-open)')
      : rep.bad(`SG6. malformed stdin: expected exit 0, got ${result.status}: ${result.stderr?.slice(0, 120)}`);
    !result.stdout || result.stdout.trim() === '' || !result.stdout.includes('decision')
      ? rep.ok('SG6. malformed stdin → no output (silent fail-open)')
      : rep.bad(`SG6. malformed stdin produced output: ${result.stdout.slice(0, 200)}`);
  }
} finally {
  cleanup();
}

rep.finish('subagent-gate (CDK-041)');
