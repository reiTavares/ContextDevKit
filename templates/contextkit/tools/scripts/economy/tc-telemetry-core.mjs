/**
 * Task-Compiler telemetry — pure logic core (WF0022 / ADR-0087..0090).
 *
 * Single responsibility: schema constants, input validators, record constructors,
 * and all pure analytics (summarize + present). No filesystem I/O lives here.
 * Split from tc-telemetry.mjs: I/O layer is a distinct concern with a second
 * consumer seam (the wedge at #275). 308-line budget respected.
 *
 * // consumes: economics/usage-event.mjs → SCHEMA_VERSION (eacp family anchor)
 *
 * [task-compiler] [token-economy] [WF0022] [ADR-0087]
 */

// consumes: economics/usage-event.mjs → SCHEMA_VERSION (family anchor)
import { SCHEMA_VERSION as EACP_SCHEMA_VERSION } from '../economics/usage-event.mjs';

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

/** Canonical schema identifier for all TC telemetry events. */
export const TC_TELEMETRY_SCHEMA_VERSION = 'cdk-tc-telemetry/1';

// ---------------------------------------------------------------------------
// Input validators (fail-fast; throw typed errors at the boundary)
// ---------------------------------------------------------------------------

/**
 * Asserts a non-empty string; throws TypeError on failure.
 * @param {unknown} value
 * @param {string}  fieldName
 * @returns {string}
 * @throws {TypeError}
 */
export function requireString(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(
      `tc-telemetry: '${fieldName}' must be a non-empty string, got ${JSON.stringify(value)}`
    );
  }
  return value.trim();
}

/**
 * Asserts a finite non-negative number; throws RangeError on failure.
 * @param {unknown} value
 * @param {string}  fieldName
 * @returns {number}
 * @throws {RangeError}
 */
export function requireFiniteNonNegative(value, fieldName) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `tc-telemetry: '${fieldName}' must be a finite non-negative number, got ${JSON.stringify(value)}`
    );
  }
  return value;
}

/**
 * Asserts a finite non-negative integer; throws RangeError on failure.
 * @param {unknown} value
 * @param {string}  fieldName
 * @returns {number}
 * @throws {RangeError}
 */
export function requireNonNegativeInt(value, fieldName) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    !Number.isInteger(value)
  ) {
    throw new RangeError(
      `tc-telemetry: '${fieldName}' must be a non-negative integer, got ${JSON.stringify(value)}`
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Record constructors (validate fields; return plain objects ready to append)
// ---------------------------------------------------------------------------

/**
 * Builds a validated packet-cost event object (does NOT write to disk).
 *
 * All cost fields are in USD. qaGreen must be an explicit boolean —
 * constitution §8: callers must assert QA outcome; null is refused.
 *
 * @param {{
 *   taskId:        string,
 *   route:         string,
 *   model:         string,
 *   inputTokens:   number,
 *   outputTokens:  number,
 *   compileCost:   number,
 *   executionCost: number,
 *   qaGreen:       boolean,
 *   capturedAt?:   string | number | null
 * }} record
 * @returns {object} Plain telemetry event ready for JSONL serialization.
 * @throws {TypeError|RangeError} On invalid or missing required fields.
 */
export function buildPacketCostEvent(record) {
  if (record === null || typeof record !== 'object') {
    throw new TypeError('tc-telemetry buildPacketCostEvent: record must be a non-null object');
  }

  const taskId        = requireString(record.taskId,        'taskId');
  const route         = requireString(record.route,         'route');
  const model         = requireString(record.model,         'model');
  const inputTokens   = requireNonNegativeInt(record.inputTokens,   'inputTokens');
  const outputTokens  = requireNonNegativeInt(record.outputTokens,  'outputTokens');
  const compileCost   = requireFiniteNonNegative(record.compileCost,   'compileCost');
  const executionCost = requireFiniteNonNegative(record.executionCost, 'executionCost');

  if (typeof record.qaGreen !== 'boolean') {
    throw new TypeError(
      `tc-telemetry: 'qaGreen' must be an explicit boolean, got ${JSON.stringify(record.qaGreen)}`
    );
  }

  return {
    schemaVersion: TC_TELEMETRY_SCHEMA_VERSION,
    eacpFamily:    EACP_SCHEMA_VERSION,
    eventKind:     'packet-cost',
    taskId,
    route,
    model,
    inputTokens,
    outputTokens,
    compileCost,
    executionCost,
    totalCost:     compileCost + executionCost,
    qaGreen:       record.qaGreen,
    capturedAt:    record.capturedAt ?? null,
  };
}

/**
 * Builds a validated escalation event object (does NOT write to disk).
 *
 * Escalation occurs when the execution ladder steps up from a cheaper tier
 * to a more capable one (e.g. scripts → haiku → sonnet).
 *
 * @param {{
 *   taskId:      string,
 *   fromTier:    string,
 *   toTier:      string,
 *   trigger:     string,
 *   retryCount:  number,
 *   capturedAt?: string | number | null
 * }} record
 * @returns {object} Plain telemetry event ready for JSONL serialization.
 * @throws {TypeError|RangeError} On invalid or missing required fields.
 */
export function buildEscalationEvent(record) {
  if (record === null || typeof record !== 'object') {
    throw new TypeError('tc-telemetry buildEscalationEvent: record must be a non-null object');
  }

  const taskId     = requireString(record.taskId,   'taskId');
  const fromTier   = requireString(record.fromTier, 'fromTier');
  const toTier     = requireString(record.toTier,   'toTier');
  const trigger    = requireString(record.trigger,  'trigger');
  const retryCount = requireNonNegativeInt(record.retryCount, 'retryCount');

  return {
    schemaVersion: TC_TELEMETRY_SCHEMA_VERSION,
    eacpFamily:    EACP_SCHEMA_VERSION,
    eventKind:     'escalation',
    taskId,
    fromTier,
    toTier,
    trigger,
    retryCount,
    capturedAt:    record.capturedAt ?? null,
  };
}

// ---------------------------------------------------------------------------
// summarizeTelemetry
// ---------------------------------------------------------------------------

/**
 * Aggregates TC telemetry records into a summary object.
 *
 * Mirrors the spirit of economics/routing-economics.costPerQaGreenTask:
 * cost-per-QA-green task is null when no qualifying events exist
 * (constitution §8: never fabricate a number; missing data → null).
 *
 * @param {object[]} records - Array of parsed telemetry events.
 * @returns {{
 *   packetCostCount:       number,
 *   escalationCount:       number,
 *   escalationRate:        number | null,
 *   costByRoute:           Record<string, { totalCost: number, count: number }>,
 *   escalationByTier:      Record<string, number>,
 *   totalCostUsd:          number,
 *   avgCostPerQaGreenTask: number | null,
 *   qaGreenCount:          number,
 *   claim:                 null
 * }}
 */
export function summarizeTelemetry(records) {
  if (!Array.isArray(records)) records = [];

  const packetCosts = records.filter((r) => r?.eventKind === 'packet-cost');
  const escalations = records.filter((r) => r?.eventKind === 'escalation');

  const costByRoute = {};
  let totalCostUsd  = 0;
  let qaGreenCount  = 0;
  let qaGreenCost   = 0;

  for (const pc of packetCosts) {
    const route = typeof pc.route === 'string' ? pc.route : 'unknown';
    if (!costByRoute[route]) costByRoute[route] = { totalCost: 0, count: 0 };
    const cost = typeof pc.totalCost === 'number' && Number.isFinite(pc.totalCost)
      ? pc.totalCost : 0;
    costByRoute[route].totalCost += cost;
    costByRoute[route].count     += 1;
    totalCostUsd                 += cost;
    if (pc.qaGreen === true) {
      qaGreenCount += 1;
      qaGreenCost  += cost;
    }
  }

  const escalationByTier = {};
  for (const esc of escalations) {
    const key = `${esc.fromTier ?? '?'}->${esc.toTier ?? '?'}`;
    escalationByTier[key] = (escalationByTier[key] ?? 0) + 1;
  }

  const packetCostCount = packetCosts.length;
  const escalationCount = escalations.length;

  // Escalation rate = escalations / tasks (null when no packet-cost events yet)
  const escalationRate = packetCostCount > 0
    ? escalationCount / packetCostCount
    : null;

  // Cost per QA-green task: null when no qualifying events (constitution §8)
  const avgCostPerQaGreenTask = qaGreenCount > 0
    ? qaGreenCost / qaGreenCount
    : null;

  return {
    packetCostCount,
    escalationCount,
    escalationRate,
    costByRoute,
    escalationByTier,
    totalCostUsd,
    avgCostPerQaGreenTask,
    qaGreenCount,
    claim: null,
  };
}

// ---------------------------------------------------------------------------
// presentTelemetry
// ---------------------------------------------------------------------------

/**
 * Renders a telemetry summary as a human-readable string (SCRIPT_ONLY use).
 *
 * @param {ReturnType<typeof summarizeTelemetry>} summary
 * @returns {string}
 */
export function presentTelemetry(summary) {
  if (!summary || typeof summary !== 'object') return 'tc-telemetry: no summary';

  const rate = summary.escalationRate !== null
    ? (summary.escalationRate * 100).toFixed(1) + '%'
    : 'n/a';

  const avgCost = summary.avgCostPerQaGreenTask !== null
    ? '$' + summary.avgCostPerQaGreenTask.toFixed(6)
    : 'null (no qa-green tasks yet)';

  const routeLines = Object.entries(summary.costByRoute)
    .map(([r, v]) => `    ${r}: ${v.count} tasks, $${v.totalCost.toFixed(6)} total`)
    .join('\n') || '    (none)';

  const tierLines = Object.entries(summary.escalationByTier)
    .map(([t, n]) => `    ${t}: ${n}`)
    .join('\n') || '    (none)';

  return [
    `tc-telemetry [${TC_TELEMETRY_SCHEMA_VERSION}]`,
    `  packet-cost events : ${summary.packetCostCount}`,
    `  escalation events  : ${summary.escalationCount}`,
    `  escalation rate    : ${rate}`,
    `  total cost (USD)   : $${summary.totalCostUsd.toFixed(6)}`,
    `  avg cost/qa-green  : ${avgCost}`,
    `  qa-green tasks     : ${summary.qaGreenCount}`,
    `  cost by route:`,
    routeLines,
    `  escalations by tier transition:`,
    tierLines,
  ].join('\n');
}
