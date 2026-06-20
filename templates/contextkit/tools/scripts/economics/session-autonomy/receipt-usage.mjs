/**
 * receipt-usage.mjs — Session Autonomy Receipt: token accounting + executor block.
 *
 * Builds the TOKEN ACCOUNTING block (spec §5, §21) and the EXECUTOR BREAKDOWN
 * block (spec §18) of the receipt. This module is an ASSEMBLER over the existing
 * economics layer — it NAMES and SHAPES what other modules already produced; it
 * does NOT introduce a parallel ledger and does NOT re-derive bucket math.
 *
 * Honesty invariants enforced here:
 *  - Unknown categories stay `null`, never `0` (#19). The ONLY explicit zeros are
 *    a deterministic executor's tokens/cost — deterministic execution genuinely
 *    consumes no model tokens, so that 0 is a measured fact, not a missing value.
 *  - Token totals are NEVER double-counted (spec §5). `observedTokens` is the
 *    accounted bucket sum the source carries; the provider-reported total is kept
 *    as a SEPARATE field and only RECONCILED against the calculated total — the
 *    two are never added together.
 *  - ContextDevKit overhead is never excluded (#6): every executor — retries,
 *    escalations, fallbacks, validators — appears in the breakdown.
 *  - Pure + deterministic (constitution §2): no I/O, no Date.now()/Math.random().
 *
 * Zero runtime dependencies — node:* / sibling kernel only.
 */

import { emptyUsageBlock } from './receipt-schema.mjs';

/** Returns true for a finite, non-negative number (the only valid token count). */
function isFiniteNonNegNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Coerces a candidate token/cost value to a non-negative number, or `null` when
 * it is absent or invalid. NEVER returns 0 for a missing value (#19) — the
 * caller supplies an explicit 0 only for deterministic executors.
 * @param {*} value
 * @returns {number|null}
 */
function numericOrNull(value) {
  return isFiniteNonNegNumber(value) ? value : null;
}

/**
 * Reads a bucket field from a normalized usage source, tolerating both the
 * canonical `{ buckets: {...} }` shape (usage-event.mjs) and a flat object.
 * @param {object} source
 * @param {string} bucketKey - one of freshInput|output|cacheRead|cacheWrite|reasoning
 * @returns {number|null} the bucket value, or null when absent/invalid.
 */
function readBucket(source, bucketKey) {
  const buckets = source && typeof source.buckets === 'object' && source.buckets !== null
    ? source.buckets
    : null;
  if (buckets && bucketKey in buckets) return numericOrNull(buckets[bucketKey]);
  return null;
}

/**
 * Maps a normalized usage source to the receipt's usage block (spec §21).
 *
 * Buckets map: freshInput→inputTokens, output→outputTokens, cacheRead→
 * cacheReadTokens, cacheWrite→cacheWriteTokens, reasoning→reasoningTokens.
 * `observedTokens` is the ACCOUNTED total — the bucket sum the source carries
 * (its `total`), NOT the provider-reported total (which reconcileUsage keeps
 * separate so the two are never summed). Categories absent in the source stay
 * `null`; we start from emptyUsageBlock() and overwrite only what is present.
 *
 * @param {object|null|undefined} sessionUsage - normalized usage. May carry
 *   `buckets` (per usage-event.mjs) and/or a `total` (accounted bucket sum).
 * @param {object} [opts] - reserved for future estimation inputs; unused today.
 * @returns {Readonly<object>} a frozen usage block (shape: emptyUsageBlock()).
 */
export function buildUsageBlock(sessionUsage, opts) {
  void opts;
  const block = emptyUsageBlock();
  const source = sessionUsage && typeof sessionUsage === 'object' ? sessionUsage : null;
  if (!source) return Object.freeze(block);

  block.inputTokens = readBucket(source, 'freshInput');
  block.outputTokens = readBucket(source, 'output');
  block.cacheReadTokens = readBucket(source, 'cacheRead');
  block.cacheWriteTokens = readBucket(source, 'cacheWrite');
  block.reasoningTokens = readBucket(source, 'reasoning');

  // observedTokens = the accounted total carried by the source. We prefer the
  // source's invariant-checked `total`; we do NOT add the provider total here.
  block.observedTokens = numericOrNull(source.total);

  return Object.freeze(block);
}

/**
 * Reconciles a provider-reported total against the calculated (bucket-summed)
 * total WITHOUT ever adding them (spec §5). Tolerance is exact (0): the two are
 * 'matched' only when both are present and strictly equal.
 *
 * @param {object} args
 * @param {number|null} [args.providerReportedTotal]   - provider's own total, or null.
 * @param {number|null} [args.normalizedCalculatedTotal] - our bucket-summed total, or null.
 * @param {string} [args.adapter]        - adapter id that produced the source.
 * @param {string} [args.adapterVersion] - adapter version.
 * @returns {Readonly<{providerReportedTotal: number|null,
 *   normalizedCalculatedTotal: number|null, reconciliationStatus: string,
 *   adapter: string|null, adapterVersion: string|null}>}
 */
export function reconcileUsage(args) {
  const input = args && typeof args === 'object' ? args : {};
  const providerReportedTotal = numericOrNull(input.providerReportedTotal);
  const normalizedCalculatedTotal = numericOrNull(input.normalizedCalculatedTotal);

  const reconciliationStatus = resolveReconciliationStatus(
    providerReportedTotal,
    normalizedCalculatedTotal,
  );

  return Object.freeze({
    providerReportedTotal,
    normalizedCalculatedTotal,
    reconciliationStatus,
    adapter: typeof input.adapter === 'string' ? input.adapter : null,
    adapterVersion: typeof input.adapterVersion === 'string' ? input.adapterVersion : null,
  });
}

/**
 * Resolves the reconciliation verdict from the two totals. Tolerance is exact.
 * @param {number|null} providerTotal
 * @param {number|null} calculatedTotal
 * @returns {string} one of RECONCILIATION_STATES.
 */
function resolveReconciliationStatus(providerTotal, calculatedTotal) {
  const hasProvider = providerTotal !== null;
  const hasCalculated = calculatedTotal !== null;
  if (hasProvider && hasCalculated) {
    return providerTotal === calculatedTotal ? 'matched' : 'mismatch';
  }
  if (hasProvider) return 'provider-total-only';
  if (hasCalculated) return 'calculated-total-only';
  return 'unavailable';
}

/**
 * Normalizes a single raw executor descriptor to a frozen breakdown element
 * (spec §18). Deterministic executors carry an explicit `tokens: 0` / `cost: 0`
 * (a measured fact); model executors keep `null` for any absent numeric. Every
 * executor — including retries, escalations, fallbacks and validators — is kept
 * (#6); the caller does the filtering policy, this function never drops one.
 *
 * @param {object} raw - { type, executorId?, provider?, model?, calls?,
 *   executions?, successfulExecutions?, inputTokens?, outputTokens?,
 *   cacheReadTokens?, cacheWriteTokens?, tokens?, cost? }
 * @returns {Readonly<object>} frozen executor breakdown element.
 */
function buildExecutorElement(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const isDeterministic = source.type === 'deterministic';
  const type = source.type === 'model' || isDeterministic ? source.type : 'model';

  // Deterministic execution consumes no model tokens — that zero is explicit
  // and measured, distinct from a missing-and-therefore-null model value.
  const tokens = isDeterministic ? 0 : numericOrNull(source.tokens);
  const cost = isDeterministic ? 0 : numericOrNull(source.cost);

  const element = {
    type,
    executorId: typeof source.executorId === 'string' ? source.executorId : null,
    provider: typeof source.provider === 'string' ? source.provider : null,
    model: typeof source.model === 'string' ? source.model : null,
    calls: numericOrNull(source.calls),
    executions: numericOrNull(source.executions),
    successfulExecutions: numericOrNull(source.successfulExecutions),
    inputTokens: isDeterministic ? 0 : numericOrNull(source.inputTokens),
    outputTokens: isDeterministic ? 0 : numericOrNull(source.outputTokens),
    cacheReadTokens: isDeterministic ? 0 : numericOrNull(source.cacheReadTokens),
    cacheWriteTokens: isDeterministic ? 0 : numericOrNull(source.cacheWriteTokens),
    tokens,
    cost,
  };
  return Object.freeze(element);
}

/**
 * Builds the executor breakdown (spec §18) — a frozen array, one element per
 * executor. ALL executors are included; ContextDevKit overhead is never
 * excluded (#6).
 *
 * @param {Array<object>|null|undefined} executors - raw executor descriptors.
 * @returns {ReadonlyArray<Readonly<object>>} frozen array of frozen elements.
 */
export function buildExecutorBreakdown(executors) {
  if (!Array.isArray(executors)) return Object.freeze([]);
  return Object.freeze(executors.map(buildExecutorElement));
}

/**
 * Sums every executor's `tokens` into the accounted total (spec §5). Returns a
 * number when at least one executor carries a numeric token count, else `null`
 * (never 0 for an empty/unknown set, #19). Deterministic zeros count as 0.
 *
 * @param {Array<object>|null|undefined} executors - raw or built executors.
 * @returns {number|null}
 */
export function accountedTotal(executors) {
  if (!Array.isArray(executors)) return null;
  let sum = 0;
  let sawNumeric = false;
  for (const executor of executors) {
    const element = buildExecutorElement(executor);
    if (element.tokens !== null) {
      sum += element.tokens;
      sawNumeric = true;
    }
  }
  return sawNumeric ? sum : null;
}
