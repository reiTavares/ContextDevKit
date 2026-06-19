/**
 * intake-methodology.mjs — the A2 methodology decision layer that the
 * execution-contract hook plugs into (BIZ-0001 / WF-0036 Wave A2, ADR-0102;
 * design §6.3 + §6.4).
 *
 * It is the thin, PURE orchestration that turns a `signals.work` classification
 * (already computed by intake, A2-T1) into:
 *   - a Business-match suggestion (operation-nature only — propose-not-auto),
 *   - the autonomy-per-grade proposed action, and
 *   - the persisted intake proposal,
 * plus one advisory checklist line. Extracting it from the hook keeps the hook a
 * minimal, fail-open superset (immutable rule 2) and makes the autonomy mapping
 * unit-testable without spawning a process.
 *
 * Autonomy-per-grade (design §6.4) — NO new gate, reuses `resolveAutonomy`:
 *   - Business creation/approval is ALWAYS human at EVERY grade (the `adr` floor
 *     guarantees it). The classifier may only ever PROPOSE a Business.
 *   - Operations are auto-actionable from grade 3 via the existing `edit` area.
 *   - A `nature` near-tie (`confidence: low`) downgrades the action one notch so
 *     an uncertain guess never auto-acts.
 *
 * Zero runtime dependencies — only the matcher, the proposal store, and the
 * autonomy resolver (all `node:*`-only themselves).
 */
import { resolveAutonomy, readAutonomyOverride } from '../config/resolve-autonomy.mjs';
import { loadConfigSync } from '../config/load.mjs';
import { matchBusiness } from './business-matcher.mjs';
import { buildIntakeProposal, saveIntakeProposal } from './intake-proposal-store.mjs';

/** One notch down the consent ladder, used by the low-confidence downgrade. */
const DOWNGRADE = Object.freeze({ auto: 'suggest', suggest: 'manual', manual: 'manual', debate: 'suggest' });

/**
 * Resolves the proposed action mode for a classification at a given grade.
 *
 * Business → always `manual` (human consent floor; map onto the `adr` area which
 * is `manual` at every grade). Operation → the `edit` area mode (auto from grade
 * 3). A low-confidence near-tie downgrades one notch so an uncertain Business
 * guess never auto-acts.
 *
 * @param {object} work - the `signals.work` classification.
 * @param {object} config - loaded contextkit config (caller owns the I/O).
 * @param {number|null} sessionOverride - live `/autonomy --session` grade or null.
 * @returns {{ nature, kind, grade, mode, area, reason, downgraded: boolean }}
 */
export function resolveProposedAction(work, config = {}, sessionOverride = null) {
  const isBusiness = work?.nature === 'business';
  const area = isBusiness ? 'adr' : 'edit';
  let resolved;
  try {
    resolved = resolveAutonomy(area, config, sessionOverride);
  } catch {
    resolved = { grade: 1, mode: 'manual', reason: 'resolve-failed-fail-safe' };
  }
  let mode = resolved.mode;
  let downgraded = false;
  // Low-confidence near-tie: never let an uncertain guess auto-act (design §6.4).
  if (work?.confidence === 'low' && mode !== 'manual') {
    mode = DOWNGRADE[mode] || 'manual';
    downgraded = true;
  }
  return {
    nature: work?.nature ?? null,
    kind: work?.kind ?? null,
    grade: resolved.grade,
    mode,
    area,
    reason: resolved.reason,
    downgraded,
  };
}

/**
 * Renders the single ≤1-line advisory the hook appends to its checklist.
 *
 * @param {object} work - the classification.
 * @param {object|null} match - the matcher verdict, or null.
 * @param {object} action - the resolved proposed action.
 * @returns {string} one advisory line (no trailing newline).
 */
export function renderMethodologyLine(work, match, action) {
  const intent = work?.valueIntents?.primary ?? '—';
  const conf = work?.confidence === 'low' ? ' (low-confidence)' : '';
  let tail;
  if (work?.nature === 'business') {
    tail = 'business → propose (human approval, never auto)';
  } else if (match && match.status === 'suggested') {
    tail = `business ${match.suggested}? suggested (${match.score})`;
  } else {
    tail = 'business: unlinked';
  }
  return `  Work: ${work?.nature ?? '?'}/${work?.kind ?? '?'} · intent ${intent} · ${tail} · action ${action.mode}${conf}`;
}

/**
 * The full best-effort methodology pass the hook invokes after intake. Runs the
 * matcher for operation-nature only (Business is propose-not-auto, no matcher),
 * resolves the autonomy-per-grade action, persists the proposal, and returns the
 * advisory line + the structured result. Fail-OPEN: any error returns null so the
 * legacy contract path proceeds byte-identically (immutable rule 2).
 *
 * `config` / `sessionOverride` are loaded defensively from `root` when omitted,
 * so the hot-path caller (the hook) stays a one-line invocation.
 *
 * @param {object} params - `{ root, taskId, objective, work, config?, sessionOverride?, createdAt? }`.
 * @returns {{ match, action, proposal, line }|null}
 */
export function runMethodology(params) {
  try {
    const { root, taskId, objective, work, createdAt } = params;
    if (!work || typeof work !== 'object') return null;
    const config = params.config ?? loadConfigSync(root);
    const sessionOverride = params.sessionOverride ?? readAutonomyOverride(root);

    const match = work.nature === 'operation'
      ? matchBusiness(work, { root, objective })
      : null;
    const action = resolveProposedAction(work, config, sessionOverride);
    const proposal = buildIntakeProposal(taskId, work, match, {
      objective,
      action: { nature: action.nature, kind: action.kind, autonomyMode: action.mode, grade: action.grade },
      createdAt: createdAt ?? new Date().toISOString(),
    });
    saveIntakeProposal(root, taskId, proposal); // atomic, fail-open
    return { match, action, proposal, line: renderMethodologyLine(work, match, action) };
  } catch {
    return null; // methodology is advisory; never break the prompt
  }
}
