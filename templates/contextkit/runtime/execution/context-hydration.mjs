/**
 * context-hydration.mjs — Role-specific context packing + aggregate state propagation
 * (WF0038 Wave A9-T2, ADR-0112, shadow-first).
 *
 * Exports two pure-first functions:
 *
 *   hydrateRolePack(role, envelope, opts)
 *     Builds a FROZEN, role-scoped context pack from a Request Intent Envelope.
 *     Enforces a hard token budget (default 1500). Never throws; shadow-safe.
 *
 *   propagateState(level, payload, opts)
 *     Rolls up child→task→wave→business counts via receipt/state primitives.
 *     Pure when no I/O target is given; fail-open.
 *
 * Token-estimation convention: same 4-chars-per-token heuristic as playbook-compile.mjs.
 * Zero runtime dependencies — node:* + canonical platform primitives only.
 *
 * @module context-hydration
 */
import { readReceipts } from './receipt-store.mjs';
import { readState } from '../state/state-io.mjs';

// ---------------------------------------------------------------------------
// Token estimation — SAME convention as playbook-compile.mjs (CHARS_PER_TOKEN=4)
// ---------------------------------------------------------------------------

/** ~4 chars/token heuristic — identical to playbook-compile.mjs, deterministic. */
const CHARS_PER_TOKEN = 4;

/**
 * Estimates token count for a string using the platform-wide heuristic.
 *
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / CHARS_PER_TOKEN);
}

// ---------------------------------------------------------------------------
// Role → envelope-field needs map (deterministic; extend here when roles grow)
// ---------------------------------------------------------------------------

/**
 * Maps each role to the top-level envelope keys it requires.
 * Only these keys are included in the role pack — others are omitted entirely.
 *
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
const ROLE_NEEDS = Object.freeze({
  reviewer:    Object.freeze(['classification', 'routing', 'request']),
  scout:       Object.freeze(['context', 'classification', 'request']),
  synthesizer: Object.freeze(['agents', 'playbooks', 'routing']),
  lead:        Object.freeze(['context', 'classification', 'autonomy', 'routing', 'agents', 'playbooks', 'request']),
  council:     Object.freeze(['classification', 'autonomy', 'routing', 'request']),
});

/** Fallback needs when an unknown role is supplied — minimal safe subset. */
const FALLBACK_NEEDS = Object.freeze(['context', 'classification', 'request']);

/**
 * Serialises an envelope field to a compact, labelled text block.
 * Returns a plain string that is safe to inject into a prompt section.
 *
 * @param {string} fieldName
 * @param {unknown} value
 * @returns {string}
 */
function renderField(fieldName, value) {
  const label = `## ${fieldName}`;
  const body = value === null || value === undefined
    ? '(empty)'
    : (typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value));
  return `${label}\n${body}`;
}

// ---------------------------------------------------------------------------
// hydrateRolePack
// ---------------------------------------------------------------------------

/**
 * Builds a FROZEN, role-specific context pack from a Request Intent Envelope.
 *
 * Only the envelope fields the `role` needs (per ROLE_NEEDS) are included.
 * Sections are added in declaration order until the token budget would be
 * exceeded — at that point `truncated` is set to true and remaining sections
 * are skipped. Pure: no disk I/O; the envelope is read but never mutated.
 *
 * @param {string} role
 *   One of: 'reviewer' | 'scout' | 'synthesizer' | 'lead' | 'council'
 *   Unknown roles fall back to FALLBACK_NEEDS.
 * @param {object} envelope
 *   A Request Intent Envelope produced by buildEnvelope() in request-envelope.mjs.
 * @param {{ maxTokens?: number }} [opts]
 *   maxTokens: hard token ceiling (default 1500). NEVER exceeded.
 * @returns {Readonly<{
 *   role: string,
 *   sections: Array<{ name: string, text: string }>,
 *   tokenCount: number,
 *   budget: number,
 *   truncated: boolean,
 *   reasonCodes: string[]
 * }>}
 */
export function hydrateRolePack(role, envelope, opts = {}) {
  const resolvedRole = typeof role === 'string' ? role : 'unknown';
  const budget = Number(opts?.maxTokens ?? 1500);
  const safeEnvelope = envelope && typeof envelope === 'object' ? envelope : {};
  const needs = ROLE_NEEDS[resolvedRole] ?? FALLBACK_NEEDS;
  const reasonCodes = [];
  if (!ROLE_NEEDS[resolvedRole]) reasonCodes.push(`unknown-role:${resolvedRole} fallback-to-default`);

  const sections = [];
  let tokenCount = 0;
  let truncated = false;

  for (const fieldName of needs) {
    if (!(fieldName in safeEnvelope)) {
      reasonCodes.push(`field-absent:${fieldName}`);
      continue;
    }
    const text = renderField(fieldName, safeEnvelope[fieldName]);
    const fieldTokens = estimateTokens(text);

    if (tokenCount + fieldTokens > budget) {
      truncated = true;
      reasonCodes.push(`budget-exceeded-at:${fieldName} budget=${budget} used=${tokenCount}`);
      break;
    }

    sections.push({ name: fieldName, text });
    tokenCount += fieldTokens;
  }

  if (sections.length === 0 && !truncated) {
    reasonCodes.push('no-sections-produced');
  }

  return Object.freeze({
    role: resolvedRole,
    sections,
    tokenCount,
    budget,
    truncated,
    reasonCodes,
  });
}

// ---------------------------------------------------------------------------
// propagateState — aggregate rollup (child→task→wave→business)
// ---------------------------------------------------------------------------

/**
 * Valid propagation levels in ascending chain order.
 * @type {ReadonlyArray<string>}
 */
const PROPAGATION_LEVELS = Object.freeze(['child', 'task', 'wave', 'business']);

/**
 * Computes a rollup summary from an array of child payload items.
 * Recognises `status` fields: 'done'|'passed'|'success' count as done.
 *
 * @param {Array<object>} children
 * @returns {{ done: number, total: number, failedCount: number, blockedCount: number }}
 */
function computeRollup(children) {
  const safeChildren = Array.isArray(children) ? children : [];
  let done = 0;
  let failedCount = 0;
  let blockedCount = 0;

  for (const child of safeChildren) {
    if (!child || typeof child !== 'object') continue;
    const status = String(child.status ?? '').toLowerCase();
    if (status === 'done' || status === 'passed' || status === 'success') done += 1;
    else if (status === 'failed' || status === 'error') failedCount += 1;
    else if (status === 'blocked' || status === 'blocked-on-checkpoint') blockedCount += 1;
  }

  return { done, total: safeChildren.length, failedCount, blockedCount };
}

/**
 * Reads receipts from the store when an I/O target is available, merging each
 * receipt's result into a normalised child-like object.
 *
 * @param {string} root project root (from opts)
 * @param {string} taskId
 * @returns {Array<{ id: string, status: string }>}
 */
function readReceiptsAsChildren(root, taskId) {
  try {
    const receipts = readReceipts(root, String(taskId));
    return receipts.map((r) => ({
      id: `${r.capability ?? 'unknown'}@${r.taskId ?? taskId}`,
      status: r.result === 'passed' ? 'done' : (r.result ?? 'unknown'),
    }));
  } catch {
    return [];
  }
}

/**
 * Reads the task state and derives a child-like status for it.
 *
 * @param {string} pipeDir
 * @param {string} id
 * @returns {{ id: string, status: string }|null}
 */
function readStateAsChild(pipeDir, id) {
  try {
    const state = readState(pipeDir, String(id));
    if (!state) return null;
    return { id: String(state.id ?? id), status: String(state.status ?? 'unknown') };
  } catch {
    return null;
  }
}

/**
 * Aggregates progress up one level of the chain and optionally writes to the
 * receipt/state stores when I/O targets are provided.
 *
 * Pure when opts has no `root`/`pipeDir` — operates entirely on `payload.children`
 * and returns the rollup. With I/O targets, additionally reads receipts or state
 * to supplement the in-memory list before computing the rollup.
 *
 * Never throws (shadow-safe, rule 2). Deterministic given the same inputs + store.
 *
 * @param {'child'|'task'|'wave'|'business'} level
 *   The granularity of the aggregate being produced.
 * @param {{
 *   children?: Array<{ id?: string, status?: string }>,
 *   taskId?: string,
 *   waveId?: string,
 *   businessId?: string,
 * }} payload
 *   In-memory children plus optional ids for I/O-backed enrichment.
 * @param {{
 *   root?: string,
 *   pipeDir?: string,
 * }} [opts]
 *   When root is provided, receipt I/O is attempted.
 *   When pipeDir is provided, state I/O is attempted.
 * @returns {{
 *   level: string,
 *   children: Array<{ id: string, status: string }>,
 *   rollup: { done: number, total: number, failedCount: number, blockedCount: number }
 * }}
 */
export function propagateState(level, payload, opts = {}) {
  try {
    const safeLevel = PROPAGATION_LEVELS.includes(level) ? level : 'child';
    const safePayload = payload && typeof payload === 'object' ? payload : {};
    const inMemoryChildren = Array.isArray(safePayload.children)
      ? safePayload.children.filter((c) => c && typeof c === 'object')
      : [];

    // Supplement in-memory list with I/O-backed receipts/state (purely additive).
    const ioChildren = [];
    if (opts?.root && safePayload.taskId) {
      const receiptChildren = readReceiptsAsChildren(String(opts.root), String(safePayload.taskId));
      ioChildren.push(...receiptChildren);
    }
    if (opts?.pipeDir && safePayload.taskId) {
      const stateChild = readStateAsChild(String(opts.pipeDir), String(safePayload.taskId));
      if (stateChild) ioChildren.push(stateChild);
    }

    // Merge: in-memory children take precedence; I/O children fill gaps by id.
    const childIndex = new Map(inMemoryChildren.map((c) => [String(c.id ?? ''), c]));
    for (const io of ioChildren) {
      const ioId = String(io.id ?? '');
      if (!childIndex.has(ioId)) childIndex.set(ioId, io);
    }
    const mergedChildren = [...childIndex.values()];

    return {
      level: safeLevel,
      children: mergedChildren,
      rollup: computeRollup(mergedChildren),
    };
  } catch {
    // Fail-open: return a zero-count rollup rather than throwing (rule 2).
    return {
      level: typeof level === 'string' ? level : 'child',
      children: [],
      rollup: { done: 0, total: 0, failedCount: 0, blockedCount: 0 },
    };
  }
}
