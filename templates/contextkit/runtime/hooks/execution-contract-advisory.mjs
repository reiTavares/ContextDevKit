/**
 * Execution-contract advisory surface — methodology + routing + decision-coverage
 * composition.
 *
 * Extracted from execution-contract-hook.mjs (BIZ-0001/WF-0037, B3-split).
 * Owns: ADR-0094 routing pass (runRouting) + BIZ-0001/WF-0036 methodology
 * surface (runMethodology call) + B3-T2 decision-coverage advisory
 * (adviseCoverageGap). All are ADDITIVE and FAIL-OPEN — any error returns null
 * and the caller silently skips output. This module NEVER blocks the user or
 * breaks the contract path (immutable rule 2).
 *
 * Cohesion rationale: every export here is advisory-only output that fires
 * AFTER the execution contract is already saved. No consumer below L3 ever
 * reaches this module. Kept together because all four concerns share the
 * same "append-to-stdout, fail-open, never-block" contract.
 */
import { getLevel, loadConfigSync } from '../config/load.mjs';
import { routePrompt } from '../execution/routing-runtime.mjs';
import { runMethodology } from '../execution/intake-methodology.mjs';
import { renderJourneyAdvisory } from './journey-surface.mjs';

// ---------------------------------------------------------------------------
// Checklist renderer (exported for selfcheck unit testing)
// ---------------------------------------------------------------------------

/**
 * Formats a SHORT actionable checklist for the UserPromptSubmit surface.
 * Advisory only -- guidance, not a block. Maximum 8 lines so it never
 * overwhelms the agent context surface.
 *
 * @param {object} contract execution contract from buildContract()
 * @param {string} taskId resolved task id
 * @param {boolean} isNew true when a new task id was minted
 * @param {object|null} routing routing summary from runAdvisory()
 * @returns {string}
 */
export function renderChecklist(contract, taskId, isNew, routing = null) {
  const tier = contract.signals?.tier ?? 'unknown';
  const write = contract.requiredBeforeWrite ?? [];
  const complete = contract.requiredBeforeCompletion ?? [];
  const lines = [
    `[execution-contract] ${isNew ? 'New task' : 'Follow-up'}: ${taskId}`,
    `  Tier: ${tier}`,
  ];
  if (write.length > 0) {
    lines.push(`  Required before write: ${write.join(', ')}`);
  }
  if (complete.length > 0) {
    lines.push(`  Required before completion: ${complete.join(', ')}`);
  }
  if (write.length === 0 && complete.length === 0) {
    lines.push('  No required capabilities for this tier.');
  }
  // ADR-0094 routing surface — short, deterministic, recommendation-only (spec §6.4).
  if (routing && routing.active) {
    lines.push(`  Routing: ${routing.mode} — recommend ${routing.recommendedTier} · applied: no (${routing.reason})`);
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// ADR-0094 routing pass (advisory, fail-open)
// ---------------------------------------------------------------------------

/**
 * Runs the ADR-0094 routing pass for a real prompt — classify, decide, record.
 * Best-effort and fail-open (immutable rule 2): any failure returns null and
 * the contract proceeds unchanged. Telemetry failure never blocks the user
 * (spec §6.5).
 *
 * @param {string} promptText trimmed prompt
 * @param {object} signals intake signals from intake()
 * @param {string} sessionId resolved session id
 * @param {string} taskId resolved task id
 * @param {object} opts { root, host, routingLog }
 * @returns {object|null} routing summary ({ active, mode, recommendedTier, reason, summary }) or null
 */
export function runRouting(promptText, signals, sessionId, taskId, opts) {
  const { root, host, routingLog } = opts;
  try {
    return routePrompt({
      promptText,
      intakeSignals: signals,
      sessionId,
      taskId,
      host,
      level: getLevel(root),
      projectRouting: loadConfigSync(root)?.routing,
      logFile: routingLog,
      at: new Date().toISOString(),
    });
  } catch {
    return null; // routing is advisory; never break the prompt
  }
}

// ---------------------------------------------------------------------------
// Composite advisory runner — routing + methodology, writes to stdout
// ---------------------------------------------------------------------------

/**
 * Runs both advisory passes (routing + methodology) after the contract is
 * saved, writes any advisory lines to stdout, and returns the routing result
 * for renderChecklist() back in the hook (which needs it to annotate the
 * contract checklist header).
 *
 * Fail-open: any error in either pass is swallowed silently.
 *
 * @param {object} params
 * @param {string} params.promptText trimmed prompt
 * @param {object} params.signals intake signals from intake()
 * @param {string} params.sessionId resolved session id
 * @param {string} params.taskId resolved task id
 * @param {string} params.root process.cwd() in the hook
 * @param {string} params.host hookHost() value
 * @param {string} params.routingLog absolute path to routing-decisions.jsonl
 * @returns {{ routing: object|null }}
 */
export function runAdvisory({ promptText, signals, sessionId, taskId, root, host, routingLog }) {
  const routing = runRouting(promptText, signals, sessionId, taskId, { root, host, routingLog });

  // A2 (BIZ-0001/WF-0036, ADR-0102) — additive, fail-open methodology surface.
  // Reads signals.work (A2-T1, never reclassifies), matches a Business for
  // operation-nature, persists a temporary intake proposal, and appends ONE
  // advisory line. Mirrors runRouting: null on any failure; nothing surfaced if
  // work is absent.
  try {
    const methodology = runMethodology({ root, taskId, objective: promptText, work: signals.work });
    if (methodology && methodology.line) process.stdout.write(`${methodology.line}\n`);
  } catch {
    // methodology is advisory; silent on any failure
  }

  // B3-T2 (BIZ-0001/WF-0037) — decision-coverage advisory gap surface.
  // When the intake signals carry a work entity or need with decisionRefs,
  // surface a NEEDS_DECISION nudge. Registry is omitted here (hot-path, no I/O)
  // so coverage is advisory-only; the full gate runs in CLI tools.
  try {
    const coverageMsg = adviseCoverageGap(signals.work, null);
    if (coverageMsg) process.stdout.write(`${coverageMsg}\n`);
  } catch {
    // coverage advisory is fail-open; silent on any failure
  }

  // ADR-0127 Phase 2 (first cut) — journey advisory: current stage + exact next
  // command for the resolved branch. Additive + fail-open, same contract as above.
  try {
    const journeyMsg = renderJourneyAdvisory(root, signals);
    if (journeyMsg) process.stdout.write(journeyMsg);
  } catch {
    // journey surfacing is advisory; silent on any failure
  }

  return { routing };
}

// ---------------------------------------------------------------------------
// B3-T2: Decision-coverage gap advisory (fail-open, recommend-not-block)
// ---------------------------------------------------------------------------

/**
 * Returns a non-blocking advisory message string when `entity` has no
 * decisionRefs (NEEDS_DECISION), or null when coverage appears sufficient
 * or the check cannot be performed.
 *
 * This function is ADVISORY ONLY — it NEVER blocks. It fires after the
 * contract is already saved so any error is swallowed silently (fail-open,
 * immutable rule 2). No registry look-up is performed in the hot path (no
 * I/O); callers that need full coverage validation should use
 * `evaluateDecisionCoverage` / `requiredDecisionGate` from
 * `tools/scripts/decision-coverage.mjs` in a gate CLI.
 *
 * Zero npm dependencies — inline detection only.
 *
 * @param {object|null} entity - work entity from intake signals (may be null).
 * @param {object|null} registry - optional ADR registry; when null/absent the
 *   check is presence-only (decisionRefs missing → advisory). When supplied,
 *   a dynamic import of decision-coverage.mjs is attempted for richer analysis,
 *   but failure is silenced (fail-open).
 * @returns {string|null} advisory message or null (silent).
 */
export function adviseCoverageGap(entity, registry) {
  try {
    if (!entity || typeof entity !== 'object') return null;

    // Presence check: does the entity carry any decisionRefs?
    const refs = entity.decisionRefs;
    const decisions = entity.decisions;

    const hasRefs = (
      (refs && typeof refs === 'object' && !Array.isArray(refs) &&
        (refs.primary || (Array.isArray(refs.governing) && refs.governing.length > 0))) ||
      (Array.isArray(refs) && refs.length > 0) ||
      (decisions && typeof decisions === 'object' && typeof decisions.primary === 'string')
    );

    if (hasRefs) return null; // refs present — silent; full gate handles deeper checks

    // No refs: surface a NEEDS_DECISION advisory.
    const entityId = (typeof entity.id === 'string' ? entity.id : null) ||
                     (typeof entity.type === 'string' ? entity.type : null) ||
                     'work entity';
    return `[decision-coverage] NEEDS_DECISION: "${entityId}" has no decisionRefs. ` +
           'A governing accepted ADR is required before material work proceeds. ' +
           '(advisory — does not block; run /new-adr to create one)';
  } catch (_err) {
    return null; // fail-open — never throw to caller
  }
}
