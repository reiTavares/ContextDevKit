/**
 * intake-methodology.mjs — the A2 methodology decision layer that the
 * execution-contract hook plugs into (BIZ-0001 / WF-0036 Wave A2, ADR-0102;
 * design §6.3 + §6.4).
 *
 * It is the thin, PURE orchestration that turns a `signals.work` classification
 * (already computed by intake, A2-T1) into:
 *   - a Business-match suggestion (operation-nature only — propose-not-auto),
 *   - a non-authoritative action recommendation, and
 *   - the persisted intake proposal,
 * plus one advisory checklist line. Extracting it from the hook keeps the hook a
 * minimal, fail-open superset (immutable rule 2) and makes the recommendation
 * unit-testable without spawning a process.
 *
 * ContextDevKit 4 has no autonomy grade or execution floor. This module only
 * describes the proposed work; explicit owner intent remains authoritative.
 *
 * Zero runtime dependencies — only the matcher and proposal store.
 */
import { matchBusiness } from './business-matcher.mjs';
import { buildIntakeProposal, saveIntakeProposal } from './intake-proposal-store.mjs';
import { scanCitations, resolveReferenceIntent } from './reference-intent.mjs';
import { buildWorkContextRegistry } from '../../tools/scripts/registry/work-context.mjs';
import { readAuthoritySnapshot } from '../authority-reader.mjs';

/**
 * Reference-intents that mean "work inside an existing context" rather than
 * create a new one (ADR-0152 / WF-0094). A strong one of these downgrades a
 * would-be create-new action and re-frames the advisory line.
 */
const CONTINUATION_INTENTS = Object.freeze(
  new Set(['work-within', 'new-child-in-context', 'new-workflow-in-owner']),
);

/** Cheap pre-check: does the objective contain an explicit `WF-####` id? */
const WF_ID_RE = /\bWF-\d{4}\b/i;

/**
 * Reads the two registries the citation scan resolves against, fail-open
 * (immutable rule 2). Each read is isolated so one unreadable registry never
 * blanks the other; any failure degrades to an empty list, so `scanCitations`
 * simply surfaces fewer / unresolved citations rather than throwing.
 *
 * The workflow-registry walk is skipped unless the objective actually contains a
 * `WF-####` id: only the explicit workflow-citation path consumes it (the fuzzy
 * pass matches BIZ/OP titles from the work-context registry only), so the common
 * no-`WF-`-mention prompt avoids that disk walk entirely.
 *
 * @param {string} root - project root.
 * @param {string} [objective] - the request text (gates the workflow walk).
 * @returns {{ workContexts: object[], workflows: object[] }}
 */
function readCitationRegistries(root, objective = '') {
  const registries = { workContexts: [], workflows: [] };
  try {
    const wc = buildWorkContextRegistry(root);
    if (wc && Array.isArray(wc.contexts)) registries.workContexts = wc.contexts;
  } catch { /* fail-open — empty work-context list */ }
  if (WF_ID_RE.test(String(objective || ''))) {
    try {
      const snapshot = readAuthoritySnapshot(root);
      if (Array.isArray(snapshot.workflows)) registries.workflows = snapshot.workflows;
    } catch { /* fail-open — empty workflow list */ }
  }
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
 * Resolves the non-binding action recommendation for a classification.
 *
 * Owner intent and external platform/security controls decide whether an action
 * proceeds. No runtime compatibility fields preserve the legacy grade model.
 *
 * @param {object} work - the `signals.work` classification.
 * @returns {{ nature, kind, mode:'advisory', area, reason, downgraded: false }}
 */
export function resolveProposedAction(work) {
  const isBusiness = work?.nature === 'business';
  const area = isBusiness ? 'adr' : 'edit';
  return {
    nature: work?.nature ?? null,
    kind: work?.kind ?? null,
    mode: 'advisory',
    area,
    reason: 'Owner intent controls execution; ContextDevKit recommendations are non-binding.',
    downgraded: false,
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
 * resolves the advisory action, persists the proposal, and returns the
 * advisory line + the structured result. Fail-OPEN: any error returns null so the
 * legacy contract path proceeds byte-identically (immutable rule 2).
 *
 * @param {object} params - `{ root, taskId, objective, work, createdAt? }`.
 * @returns {{ match, action, proposal, line }|null}
 */
export function runMethodology(params) {
  try {
    const { root, taskId, objective, work, createdAt } = params;
    if (!work || typeof work !== 'object') return null;
    const match = work.nature === 'operation'
      ? matchBusiness(work, { root, objective })
      : null;
    const action = resolveProposedAction(work);

    // ADR-0152 / WF-0094 — resolve what a citation of an existing context MEANS.
    // Isolated + fail-open: a failure here degrades to the legacy framing (a null
    // referenceIntent), never to a broken methodology pass (immutable rule 2).
    let referenceIntent = null;
    try {
      const citations = scanCitations(objective, readCitationRegistries(root, objective));
      referenceIntent = resolveReferenceIntent(work, citations, { objective });
      if (isStrongContinuation(referenceIntent)) {
        action.reason = `${action.reason} Continue ${referenceIntent.target?.id}; do not create a duplicate context.`;
      }
    } catch { referenceIntent = null; /* fail-open — legacy framing stands */ }

    const proposal = buildIntakeProposal(taskId, work, match, {
      objective,
      action: { nature: action.nature, kind: action.kind, mode: action.mode },
      createdAt: createdAt ?? new Date().toISOString(),
    });
    saveIntakeProposal(root, taskId, proposal); // atomic, fail-open
    return { match, action, referenceIntent, proposal, line: renderMethodologyLine(work, match, action, referenceIntent) };
  } catch {
    return null; // methodology is advisory; never break the prompt
  }
}
