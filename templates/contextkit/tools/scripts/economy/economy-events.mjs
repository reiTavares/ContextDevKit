/**
 * Structured lifecycle events for automatic economy levers (card #349).
 *
 * This is an additive correlation ledger, not a replacement for the existing
 * routing, request-telemetry, or observed-savings ledgers. Events distinguish
 * estimates from observations and preserve requestId/decisionId links.
 * Zero runtime deps; deterministic when opts.now is injected; fail-open reads.
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ECONOMY_RESOURCE_IDS } from './registry.mjs';

export const ECONOMY_EVENTS_SCHEMA_VERSION = 'cdk-economy-event/1';
export const ECONOMY_EVENT_LEVERS = Object.freeze([
  ...new Set(['run-compact', 'project-map', 'routing', 'runner-first', 'dev-start', ...ECONOMY_RESOURCE_IDS]),
]);
export const ECONOMY_EVENT_LIFECYCLE = Object.freeze([
  'evaluated', 'eligible', 'recommended', 'directed',
  'attempted', 'applied', 'skipped', 'failed',
]);

const str = (value) => (
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [values]).map(str).filter(Boolean))];
}

function measurement(input, kind) {
  const alias = kind === 'estimated' ? 'estimate' : 'observation';
  const raw = input?.[kind] ?? input?.[alias];
  const out = {};
  if (finite(raw)) out.tokens = raw;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [unit, value] of Object.entries(raw)) {
      if (finite(value)) out[unit] = value;
    }
  }
  const prefix = kind === 'estimated' ? 'estimated' : 'observed';
  for (const [field, unit] of [
    [`${prefix}Tokens`, 'tokens'],
    [`${prefix}Usd`, 'usd'],
    [`${prefix}RelativeUnits`, 'relativeUnits'],
    [`${prefix}Milliseconds`, 'milliseconds'],
    [`${prefix}Bytes`, 'bytes'],
  ]) {
    if (finite(input?.[field])) out[unit] = input[field];
  }
  return Object.keys(out).length > 0 ? Object.freeze(out) : null;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * Builds one structured event. Invalid lever/lifecycle returns a skipped marker
 * that writers refuse to persist.
 */
export function recordEconomyEvent(input = {}, opts = {}) {
  const lever = str(input.lever);
  const lifecycle = str(input.lifecycle ?? input.status);
  if (!ECONOMY_EVENT_LEVERS.includes(lever)) {
    return Object.freeze({ status: 'skipped', reason: `unknown economy lever: ${lever}` });
  }
  if (!ECONOMY_EVENT_LIFECYCLE.includes(lifecycle)) {
    return Object.freeze({ status: 'skipped', reason: `unknown economy lifecycle: ${lifecycle}` });
  }
  const reasons = uniqueStrings([
    input.reason,
    ...(Array.isArray(input.reasons) ? input.reasons : []),
    ...(Array.isArray(input.reasonCodes) ? input.reasonCodes : []),
  ]);
  const now = input.capturedAt ?? input.at ?? opts.now;
  return deepFreeze({
    schemaVersion: ECONOMY_EVENTS_SCHEMA_VERSION,
    eventId: str(input.eventId),
    lever,
    lifecycle,
    status: lifecycle,
    evaluated: input.evaluated !== false,
    eligible: input.eligible === true,
    recommended: input.recommended === true,
    directed: input.directed === true,
    attempted: input.attempted === true,
    applied: input.applied === true,
    skipped: input.skipped === true || lifecycle === 'skipped',
    failed: input.failed === true || lifecycle === 'failed',
    reason: reasons[0] ?? null,
    reasons,
    reasonCodes: reasons,
    requestId: str(input.requestId),
    decisionId: str(input.decisionId),
    sessionId: str(input.sessionId),
    sourceLedger: str(input.sourceLedger),
    sourceId: str(input.sourceId),
    estimated: measurement(input, 'estimated'),
    observed: measurement(input, 'observed'),
    capturedAt: finite(now) || str(now) ? now : null,
  });
}

/** Compatibility alias for callers that use create* terminology. */
export const createEconomyEvent = recordEconomyEvent;

export function appendEconomyEventSync(record, file) {
  if (record?.status === 'skipped' && !record?.schemaVersion && !record?.lever) {
    throw new TypeError('appendEconomyEvent: refuse to persist a skipped marker');
  }
  if (!str(file)) throw new TypeError('appendEconomyEvent: file must be a non-empty string');
  if (str(record?.eventId)) {
    const duplicate = readEconomyEventsSync(file).some((entry) => entry?.eventId === record.eventId);
    if (duplicate) return Object.freeze({ appended: false, reason: 'duplicate-event-id', file });
  }
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(record) + '\n', 'utf-8');
  return Object.freeze({ appended: true, reason: null, file });
}

export async function appendEconomyEvent(record, file) {
  appendEconomyEventSync(record, file);
  return file;
}

export function readEconomyEventsSync(file) {
  let raw;
  try { raw = readFileSync(file, 'utf-8'); } catch { return []; }
  const records = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch { /* malformed JSONL is ignored */ }
  }
  return records;
}

export async function readEconomyEvents(file) {
  return readEconomyEventsSync(file);
}

function addReason(target, rec) {
  for (const reason of uniqueStrings([
    rec.reason,
    ...(Array.isArray(rec.reasons) ? rec.reasons : []),
    ...(Array.isArray(rec.reasonCodes) ? rec.reasonCodes : []),
  ])) {
    target[reason] = (target[reason] ?? 0) + 1;
  }
}

function addMeasurement(target, sample) {
  if (!sample || typeof sample !== 'object') return;
  for (const [unit, value] of Object.entries(sample)) {
    if (!finite(value)) continue;
    target[unit] ??= { total: 0, samples: 0 };
    target[unit].total += value;
    target[unit].samples += 1;
  }
}

function reasonList(counts) {
  return Object.entries(counts)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

function eventBucket() {
  return {
    events: 0, lifecycle: {}, reasons: {},
    estimated: {}, observed: {}, requests: new Set(), decisions: new Set(),
  };
}

function finalizeBucket(bucket) {
  const out = {
    events: bucket.events,
    lifecycle: bucket.lifecycle,
    reasons: reasonList(bucket.reasons),
  };
  if (Object.keys(bucket.estimated).length > 0) out.estimated = bucket.estimated;
  if (Object.keys(bucket.observed).length > 0) out.observed = bucket.observed;
  if (bucket.requests.size > 0) out.requests = bucket.requests.size;
  if (bucket.decisions.size > 0) out.decisions = bucket.decisions.size;
  return out;
}

/**
 * Summarizes only valid structured events. Lifecycle keys exist only when seen;
 * measurement totals carry sample counts so an observed zero is never ambiguous.
 */
export function summarizeEconomyEvents(records) {
  const list = Array.isArray(records) ? records : [];
  const total = eventBucket();
  const byLever = {};
  for (const rec of list) {
    const lever = str(rec?.lever);
    const lifecycle = str(rec?.lifecycle ?? rec?.status);
    if (!ECONOMY_EVENT_LEVERS.includes(lever) || !ECONOMY_EVENT_LIFECYCLE.includes(lifecycle)) continue;
    const bucket = byLever[lever] ??= eventBucket();
    for (const target of [total, bucket]) {
      target.events += 1;
      target.lifecycle[lifecycle] = (target.lifecycle[lifecycle] ?? 0) + 1;
      addReason(target.reasons, rec);
      addMeasurement(target.estimated, rec.estimated ?? rec.estimate);
      addMeasurement(target.observed, rec.observed ?? rec.observation);
      if (str(rec.requestId)) target.requests.add(rec.requestId);
      if (str(rec.decisionId)) target.decisions.add(rec.decisionId);
    }
  }
  if (total.events === 0) {
    return Object.freeze({
      schemaVersion: ECONOMY_EVENTS_SCHEMA_VERSION,
      status: 'no-events',
      reason: 'no structured economy events recorded',
      byLever: Object.freeze({}),
    });
  }
  const leverSummary = {};
  for (const [lever, bucket] of Object.entries(byLever)) leverSummary[lever] = finalizeBucket(bucket);
  return deepFreeze({
    schemaVersion: ECONOMY_EVENTS_SCHEMA_VERSION,
    status: 'observed',
    ...finalizeBucket(total),
    byLever: leverSummary,
  });
}

/** Compatibility alias matching the older savingsSummary naming pattern. */
export const economyEventsSummary = summarizeEconomyEvents;

function measurementText(label, values) {
  if (!values) return null;
  const parts = Object.entries(values).map(
    ([unit, fact]) => `${unit} ${fact.total} (${fact.samples} sample${fact.samples === 1 ? '' : 's'})`,
  );
  return parts.length > 0 ? `${label}: ${parts.join(', ')}` : null;
}

export function presentEconomyEvents(summary) {
  if (!summary || summary.status === 'no-events') {
    return `Economy lifecycle: no events (${summary?.reason ?? 'no data'})`;
  }
  const lines = [`Economy lifecycle (${summary.events} structured events):`];
  for (const [lever, bucket] of Object.entries(summary.byLever ?? {})) {
    const lifecycle = Object.entries(bucket.lifecycle).map(([stage, count]) => `${stage} ${count}`).join(' -> ');
    lines.push(`  ${lever}: ${lifecycle}`);
    if (bucket.reasons.length > 0) {
      lines.push(`    reasons: ${bucket.reasons.map((r) => `${r.reason} (${r.count})`).join(', ')}`);
    }
    const estimated = measurementText('estimated', bucket.estimated);
    const observed = measurementText('observed', bucket.observed);
    if (estimated) lines.push(`    ${estimated}`);
    if (observed) lines.push(`    ${observed}`);
  }
  return lines.join('\n');
}

export function economyEventsFile(root) {
  return join(root, 'contextkit', 'memory', 'economy-events.jsonl');
}

export function logEconomyEventSync(root, input, opts = {}) {
  if (!str(root)) return null;
  const record = recordEconomyEvent(input, opts);
  if (record.status === 'skipped') return null;
  try {
    const file = economyEventsFile(root);
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(record) + '\n', 'utf-8');
    return record;
  } catch {
    return null;
  }
}
