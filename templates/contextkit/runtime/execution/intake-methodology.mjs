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
import { scanCitations, resolveReferenceIntent } from './reference-intent.mjs';
import { buildWorkContextRegistry } from '../../tools/scripts/registry/work-context.mjs';
import { buildWorkflowRegistry } from '../../tools/scripts/registry/workflow.mjs';

/** One notch down the consent ladder, used by the low-confidence downgrade. */
const DOWNGRADE = Object.freeze({ auto: 'suggest', suggest: 'manual', manual: 'manual', debate: 'suggest' });

/**
 * Reference-intents that mean "work inside an existing context" rather than
 * create a new one (ADR-0152 / WF-0094). A strong one of these downgrades a
 * would-be create-new action and re-frames the advisory line.
 */
const CONTINUATION_INTENTS = Object.freeze(
  new Set(['work-within', 'new-child-in-context', 'new-workflow-in-owner']),
);

/**
 * Reads the two registries the citation scan resolves against, fail-open
 * (immutable rule 2). Each read is isolated so one unreadable registry never
 * blanks the other; any failure degrades to an empty list, so `scanCitations`
 * simply surfaces fewer / unresolved citations rather than throwing.
 *
 * @param {string} root - project root.
 * @returns {{ workContexts: object[], workflows: object[] }}
 */
function readCitationRegistries(root) {
  const registries = { workContexts: [], workflows: [] };
  try {
    const wc = buildWorkContextRegistry(root);
    if (wc && Array.isArray(wc.contexts)) registries.workContexts = wc.contexts;
  } catch { /* fail-open — empty work-context list */ }
  try {
    const wf = buildWorkflowRegistry(root);
    if (wf && Array.isArray(wf.workflows)) registries.workflows = wf.workflows;
  } catch { /* fail-open — empty workflow list */ }
  return registries;
}

/** True for a strong (high-confidence) continuation reference-intent. */
function isStrongContinuation(referenceIntent) {
  return Boolean(
    referenceIntent
    && referenceIntent.confidence === 'high'
    && CONTINUATION_INTENTS.has(referenceIntent.intent),
  );
}

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
 * Renders the tail phrase describing an existing-context reference (ADR-0152).
 * A strong continuation re-frames the tail from "new-with-a-parent" into the
 * resolved intent (e.g. `continuation of WF-0094 → work-within`); an `ask`
 * surfaces that a citation needs disambiguation. Returns null when there is no
 * reference-intent to surface (keeping the legacy tail byte-identical).
 *
 * @param {object|null} referenceIntent - the resolveReferenceIntent verdict.
 * @returns {string|null} the tail phrase, or null.
 */
function referenceTail(referenceIntent) {
  if (!referenceIntent) return null;
  const targetId = referenceIntent.target?.id;
  if (isStrongContinuation(referenceIntent) && targetId) {
    return `continuation of ${targetId} → ${referenceIntent.intent} (do not create a new context)`;
  }
  if (referenceIntent.intent === 'ask' && targetId) {
    return `cites ${targetId}? clarify: continue / add-to / new-workflow / new`;
  }
  return null;
}

/**
 * Renders the single ≤1-line advisory the hook appends to its checklist.
 *
 * @param {object} work - the classification.
 * @param {object|null} match - the matcher verdict, or null.
 * @param {object} action - the resolved proposed action.
 * @param {object|null} [referenceIntent] - the ADR-0152 reference-intent verdict.
 * @returns {string} one advisory line (no trailing newline).
 */
export function renderMethodologyLine(work, match, action, referenceIntent = null) {
  const intent = work?.valueIntents?.primary ?? '—';
  const conf = work?.confidence === 'low' ? ' (low-confidence)' : '';
  const refTail = referenceTail(referenceIntent);
  let tail;
  if (refTail) {
    // ADR-0152: a cited existing context takes priority over the matcher's
    // "suggested parent" framing — that framing is exactly what mis-routed a
    // continuation prompt into a new operation.
    tail = refTail;
  } else if (work?.nature === 'business') {
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

    // ADR-0152 / WF-0094 — resolve what a citation of an existing context MEANS.
    // Isolated + fail-open: a failure here degrades to the legacy framing (a null
    // referenceIntent), never to a broken methodology pass (immutable rule 2).
    let referenceIntent = null;
    try {
      const citations = scanCitations(objective, readCitationRegistries(root));
      referenceIntent = resolveReferenceIntent(work, citations, { objective });
      // A strong continuation must never auto-create a redundant context: downgrade
      // the create-new action to `suggest` (advisory — never blocks; ADR-0125).
      if (isStrongContinuation(referenceIntent) && action.mode === 'auto') {
        action.mode = 'suggest';
        action.downgraded = true;
        action.reason = `${action.reason}; downgraded — ${referenceIntent.intent} of ${referenceIntent.target?.id}`;
      }
    } catch { referenceIntent = null; /* fail-open — legacy framing stands */ }

    const proposal = buildIntakeProposal(taskId, work, match, {
      objective,
      action: { nature: action.nature, kind: action.kind, autonomyMode: action.mode, grade: action.grade },
      createdAt: createdAt ?? new Date().toISOString(),
    });
    saveIntakeProposal(root, taskId, proposal); // atomic, fail-open
    return { match, action, referenceIntent, proposal, line: renderMethodologyLine(work, match, action, referenceIntent) };
  } catch {
    return null; // methodology is advisory; never break the prompt
  }
}
