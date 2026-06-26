/**
 * MCP-011 governed write-tool implementations.
 *
 * Cohesion note (constitution s1): all seven exported functions share one
 * responsibility - "accept a write request and route it through the governance
 * gate before any mutation." None of them mutates directly; each hands the gate
 * a `mutate` callback that runs ONLY on an allow verdict. The gate itself
 * (tools.write-gate.mjs) owns the pipeline; this file owns the tool surface and
 * the per-tool mutation closures.
 *
 * Wave-2 reuse: the read-only server scaffolding lives in server.mjs +
 * tools.read.mjs. This module is the write counterpart - it is dispatched the
 * same way (a name -> handler map), but every handler is wrapped by the gate.
 *
 * DEGRADED PATH (CDK-021): with no execution contract loadable for a task, the
 * gate denies with NO_EXECUTION_CONTRACT - never a silent direct mutation. The
 * mutation closures below therefore run only when a contract exists AND every
 * governance stage passes.
 *
 * Zero third-party dependencies (node:* + kit primitives only) - hot-path safe.
 * @module tools.write
 */
import { resolve } from 'node:path';
import { mkdir, writeFile, rename, readFile } from 'node:fs/promises';
import { loadConfigSync } from '../runtime/config/load.mjs';
import { governedMutation, TOOL_AREA } from './tools.write-gate.mjs';

/** Root of the project this server runs against. */
const ROOT = process.cwd();

/** Host id stamped into receipts (overridable via env for non-Claude hosts). */
const HOST = process.env.CONTEXTKIT_HOST || 'claude-code';

/**
 * Validates the common envelope every write tool requires at the boundary
 * (constitution s4 - validate at the boundary, fail fast). Throws TypeError on a
 * malformed request rather than letting a bad shape reach the gate.
 *
 * @param {object} args
 * @param {string} toolName
 * @returns {{ taskId: string|null, run: string, approvalToken: string|undefined }}
 * @throws {TypeError} when the tool is unknown or run is missing
 */
function requireEnvelope(args, toolName) {
  if (!TOOL_AREA[toolName]) {
    throw new TypeError(`tools.write: unknown write tool "${toolName}"`);
  }
  const run = typeof args?.run === 'string' && args.run.length > 0 ? args.run : null;
  if (!run) throw new TypeError(`tools.write: ${toolName} requires a non-empty "run" id`);
  const taskId = typeof args?.taskId === 'string' && args.taskId.length > 0 ? args.taskId : null;
  const approvalToken = typeof args?.approvalToken === 'string' ? args.approvalToken : undefined;
  return { taskId, run, approvalToken };
}

/**
 * Atomically appends a JSON record to a per-tool journal under the runtime write
 * store. This is the ONLY mutation primitive the write tools use directly, and it
 * is reached exclusively from inside a gate-approved `mutate` closure. ATOMIC:
 * tmp + rename, so a crash mid-write cannot corrupt the journal.
 *
 * @param {string} kind     journal name (e.g. 'workflows', 'claims')
 * @param {object} record   metadata-only record to append
 * @returns {Promise<{ path: string, record: object }>}
 */
async function appendJournal(kind, record) {
  const dir = resolve(ROOT, 'contextkit', 'runtime', 'write-journal');
  await mkdir(dir, { recursive: true });
  const path = resolve(dir, `${kind}.jsonl`);
  let existing = '';
  try { existing = await readFile(path, 'utf-8'); } catch { existing = ''; }
  const line = JSON.stringify({ ...record, at: new Date().toISOString() }) + '\n';
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, existing + line, 'utf-8');
  await rename(tmp, path);
  return { path, record };
}

/**
 * Shared entry: wrap a mutation closure in the governance gate. Loads config
 * (the I/O the gate is pure of) and forwards the resolved envelope. The closure
 * runs only on an allow verdict.
 *
 * @param {string} toolName
 * @param {object} args     raw tool arguments
 * @param {(env: { taskId: string|null }) => Promise<object>} mutate
 * @param {object} [evidence]
 * @returns {Promise<object>} gate verdict { status, reason, receipt?, result? }
 */
async function runGoverned(toolName, args, mutate, evidence = {}) {
  let env;
  try {
    env = requireEnvelope(args, toolName);
  } catch (err) {
    return { status: 'denied', reason: `gate:bad-request(${err.message})`, error: err.message };
  }
  const config = loadConfigSync(ROOT);
  return governedMutation({
    toolName,
    root: ROOT,
    taskId: env.taskId,
    config,
    host: HOST,
    run: env.run,
    approvalToken: env.approvalToken,
    evidence,
    mutate: () => mutate(env),
  });
}

// --- Write tools (each routes through the gate; none mutates directly) -------

/** create_workflow - propose a new workflow shell (journal record only). */
export function createWorkflow(args = {}) {
  const slug = typeof args.slug === 'string' ? args.slug : '';
  return runGoverned(
    'create_workflow',
    args,
    () => appendJournal('workflows', { op: 'create', slug, kind: args.kind ?? 'feature' }),
    { slug },
  );
}

/** advance_workflow - record a workflow phase advance. */
export function advanceWorkflow(args = {}) {
  const slug = typeof args.slug === 'string' ? args.slug : '';
  return runGoverned(
    'advance_workflow',
    args,
    () => appendJournal('workflows', { op: 'advance', slug, toPhase: args.toPhase ?? '' }),
    { slug },
  );
}

/** claim_scope - reserve path(s) for the current session. */
export function claimScope(args = {}) {
  const paths = Array.isArray(args.paths) ? args.paths : [];
  return runGoverned(
    'claim_scope',
    args,
    (env) => appendJournal('claims', { op: 'claim', paths, sessionId: env.run }),
    { pathCount: paths.length },
  );
}

/** release_claim - release a previously held claim. */
export function releaseClaim(args = {}) {
  const paths = Array.isArray(args.paths) ? args.paths : [];
  return runGoverned(
    'release_claim',
    args,
    (env) => appendJournal('claims', { op: 'release', paths, sessionId: env.run }),
    { pathCount: paths.length },
  );
}

/** move_pipeline_card - move a card between pipeline stages. */
export function movePipelineCard(args = {}) {
  const cardId = args.cardId != null ? String(args.cardId) : '';
  return runGoverned(
    'move_pipeline_card',
    args,
    () => appendJournal('pipeline', { op: 'move', cardId, toStage: args.toStage ?? '' }),
    { cardId, toStage: args.toStage ?? '' },
  );
}

/** record_test_receipt - register a QA/test outcome. */
export function recordTestReceipt(args = {}) {
  const outcome = typeof args.outcome === 'string' ? args.outcome : '';
  return runGoverned(
    'record_test_receipt',
    args,
    () => appendJournal('test-receipts', { op: 'record', outcome, suite: args.suite ?? '' }),
    { outcome, suite: args.suite ?? '' },
  );
}

/** log_session - register the current session log entry. */
export function logSession(args = {}) {
  const summary = typeof args.summary === 'string' ? args.summary : '';
  return runGoverned(
    'log_session',
    args,
    (env) => appendJournal('sessions', { op: 'log', sessionId: env.run, hasSummary: summary.length > 0 }),
    { hasSummary: summary.length > 0 },
  );
}

/** Maps write tool name -> implementation (mirrors server.mjs TOOL_HANDLERS). */
export const WRITE_TOOL_HANDLERS = Object.freeze({
  create_workflow: createWorkflow,
  advance_workflow: advanceWorkflow,
  claim_scope: claimScope,
  release_claim: releaseClaim,
  move_pipeline_card: movePipelineCard,
  record_test_receipt: recordTestReceipt,
  log_session: logSession,
});
