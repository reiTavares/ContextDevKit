/**
 * Routing decision telemetry — append-only ledger + aggregate summary (ADR-0094 §7).
 *
 * Records one entry per routing decision so the cost of the policy can be MEASURED
 * (the whole point of `shadow` mode). It reports kit-ROUTING economics only — it
 * NEVER claims the provider's native cache savings as its own (ADR-0044 / EACP
 * invariant). All I/O is defensive (never throws, rule 2): a telemetry failure
 * must never break real work.
 *
 * File-path is caller-provided (the hook passes the session's runtime path, tests
 * pass a temp file) so this module stays decoupled from host path layout.
 */

import { appendFileSync, readFileSync, existsSync } from 'node:fs';

/**
 * Normalize a decision (from `decideRoute`) into a compact telemetry record.
 * @param {object} decision - the route decision.
 * @param {object} [extra] - { at, sessionId, taskId, handoffTokens, escalationReason, reviewed, rework, testsPassed }.
 * @returns {object} a flat, serializable record.
 */
export function decisionRecord(decision, extra = {}) {
  const d = decision || {};
  const est = d.estimate || {};
  return {
    at: extra.at ?? null,
    sessionId: extra.sessionId ?? null,
    taskId: extra.taskId ?? null,
    executor: d.executor ?? null,
    model: d.model ?? null,
    mode: d.mode ?? null,
    applied: !!d.applied,
    runnerFirst: !!d.runnerFirst,
    complexity: d.classification?.complexity ?? null,
    risk: d.classification?.risk ?? null,
    directRelative: est.directRelative ?? null,
    delegatedRelative: est.delegatedRelative ?? null,
    recommendation: est.recommendation ?? null,
    escalated: !!(d.escalation && d.escalation.suggested),
    escalationReason: extra.escalationReason ?? null,
    handoffTokens: extra.handoffTokens ?? null,
    reviewed: extra.reviewed ?? null,
    rework: extra.rework ?? null,
    testsPassed: extra.testsPassed ?? null,
  };
}

/**
 * Append a telemetry record as one JSON line. Silent on any I/O error.
 * @param {string} file - absolute path to the routing telemetry jsonl.
 * @param {object} record - a record from `decisionRecord`.
 * @returns {boolean} true on success, false if it degraded silently.
 */
export function appendDecision(file, record) {
  try {
    appendFileSync(file, JSON.stringify(record) + '\n', 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Read all telemetry records from a jsonl file. Skips malformed lines.
 * @param {string} file - absolute path.
 * @returns {object[]} parsed records (empty if missing/unreadable).
 */
export function readDecisions(file) {
  try {
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Aggregate routing telemetry into a summary (ADR-0094 §7 / §12 observability).
 *
 * @param {object[]} decisions - records from `readDecisions`.
 * @returns {object} a frozen summary with counts + estimated net routing benefit.
 */
export function routingTelemetrySummary(decisions = []) {
  const list = Array.isArray(decisions) ? decisions : [];
  const byExecutor = {};
  let runnerFirst = 0, applied = 0, escalations = 0, fableAuto = 0;
  let directUnits = 0, delegatedUnits = 0;
  const escalationReasons = [];

  for (const rec of list) {
    const ex = rec.executor || 'unknown';
    byExecutor[ex] = (byExecutor[ex] || 0) + 1;
    if (rec.runnerFirst) runnerFirst += 1;
    if (rec.applied) applied += 1;
    if (rec.escalated) { escalations += 1; if (rec.escalationReason) escalationReasons.push(rec.escalationReason); }
    if (ex === 'fable' && rec.mode !== 'manual') fableAuto += 1; // invariant: must stay 0
    if (typeof rec.directRelative === 'number') directUnits += rec.directRelative;
    if (typeof rec.delegatedRelative === 'number') delegatedUnits += rec.delegatedRelative;
  }

  const total = list.length;
  const netBenefitUnits = Number((directUnits - delegatedUnits).toFixed(2));
  return Object.freeze({
    schemaVersion: 'routing-telemetry/1',
    total,
    byExecutor: Object.freeze({ ...byExecutor }),
    runnerFirst,
    runnerFirstPct: total ? Math.round((runnerFirst / total) * 100) : 0,
    applied,
    escalations,
    escalationReasons,
    fableAutoSelected: fableAuto,
    mechanicalToHaiku: byExecutor.haiku || 0,
    sonnetImplemented: byExecutor.sonnet || 0,
    opusDirect: byExecutor.opus || 0,
    estimatedDirectUnits: Number(directUnits.toFixed(2)),
    estimatedDelegatedUnits: Number(delegatedUnits.toFixed(2)),
    netBenefitUnits,
    note: 'relative cost units (not USD); kit-routing only — excludes provider cache savings',
  });
}

/**
 * Render the summary as a compact markdown block for the `/token-report` surface.
 * @param {object} summary - from `routingTelemetrySummary`.
 * @returns {string}
 */
export function presentRoutingTelemetry(summary) {
  if (!summary || !summary.total) return '_No routing decisions recorded yet (routing shadow mode logs as tasks route)._';
  const ex = summary.byExecutor;
  const exLine = Object.keys(ex).map((k) => `${k} ${ex[k]}`).join(' · ');
  const benefit = summary.netBenefitUnits >= 0
    ? `~${summary.netBenefitUnits} relative units saved`
    : `~${Math.abs(summary.netBenefitUnits)} relative units OVER baseline (routing not paying off)`;
  return [
    `**Routing telemetry** (${summary.total} decisions) — ${exLine}`,
    `- runner-first: ${summary.runnerFirst} (${summary.runnerFirstPct}%) · applied: ${summary.applied} · escalations: ${summary.escalations}`,
    `- estimated net routing benefit: ${benefit}`,
    `- Fable auto-selected: ${summary.fableAutoSelected} (must be 0)`,
    `- _${summary.note}_`,
  ].join('\n');
}
