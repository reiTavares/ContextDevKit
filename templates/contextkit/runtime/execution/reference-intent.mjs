/**
 * reference-intent.mjs — WF-0094 (BIZ-0006, ADR-0152). Teaches intake to
 * understand a CITATION of an existing work context.
 *
 * The three intake classifiers carry no continuation notion: `classifyNature` is
 * citation-blind, `matchBusiness` only ever *suggests a parent*, and
 * `runMethodology` frames every operation as new-with-a-parent. This module adds
 * the missing step: given the classified work + the citations found in the
 * objective, resolve WHAT the citation means — continue inside it, add a child,
 * add a workflow, or use it only as context for something new.
 *
 * Two pure functions, both deterministic and fail-open (immutable rule 2):
 *   - `scanCitations(objective, registries)` — detect explicit BIZ/OP/WF ids +
 *     fuzzy title/slug references; resolve existence against injected registry
 *     data (never walks disk itself — the caller injects it, mirroring the
 *     matcher's `options.registry` seam).
 *   - `resolveReferenceIntent(work, citations, options)` — collapse the citation
 *     tier × type × nature × executionMode × intent into one of four intents
 *     (+ `ask` on ambiguity). Same input → same output; no clock, no random.
 *
 * The gate this feeds is ADVISORY (ADR-0125): a strong explicit citation only
 * DOWNGRADES a would-be create-new action; it never blocks. A contextual citation
 * resolves to `new-context` and proceeds. Zero runtime dependencies (rule 1).
 */
import { tokenize } from './work-classify-signals.mjs';

/** The closed reference-intent enum (ADR-0152). */
export const REFERENCE_INTENTS = Object.freeze([
  'new-context', 'work-within', 'new-child-in-context', 'new-workflow-in-owner', 'ask',
]);

/** Explicit work-context id pattern: `BIZ-####` / `OP-####` / `WF-####`. */
const ID_RE = /\b(BIZ|OP|WF)-(\d{4})\b/gi;

/** Prefix → work-context type. */
const TYPE_BY_PREFIX = Object.freeze({ BIZ: 'business', OP: 'operation', WF: 'workflow' });

/** Jaccard threshold for a fuzzy title/slug reference to count (design §1). */
const FUZZY_MIN = 0.34;

/** The four-way clarify question emitted on an ambiguous citation. */
const CLARIFY_Q =
  'A citation of an existing context was detected. Is it (a) only context for '
  + 'something NEW, (b) work INSIDE it, (c) a new item/task inside it, or (d) a '
  + 'new workflow inside it?';

/** English + pt-BR substrings signalling "a new workflow inside the cited owner". */
const NEW_WORKFLOW_SIGNALS = [
  'new workflow', 'another workflow', 'workflow inside', 'add a workflow',
  'nested workflow', 'novo workflow', 'outro workflow', 'novo fluxo',
  'workflow dentro', 'fluxo dentro',
];

/** English + pt-BR substrings signalling "a new item/task inside the cited owner". */
const NEW_CHILD_SIGNALS = [
  'add a task', 'add task', 'new task', 'increment', 'a card', 'nova tarefa',
  'adicionar tarefa', 'novo item', 'novo card',
];

/** English + pt-BR substrings signalling the citation is only CONTEXT for new work. */
const NEW_SCOPE_SIGNALS = [
  'new area', 'different area', 'new market', 'new segment', 'new product',
  'separate ', 'but for', 'nova area', 'nova área', 'outra area', 'outra área',
  'para uma nova', 'mas para',
];

/** Operation kinds that read as "continue the cited context's existing work". */
const WITHIN_KINDS = Object.freeze(new Set(['maintenance', 'fix', 'investigation']));

/** True when any needle is a substring of the (already-lowercased) text. */
function hasAny(text, needles) {
  for (const needle of needles) if (text.includes(needle)) return true;
  return false;
}

/** Jaccard of two token sets (0 when either is empty). */
function jaccard(left, right) {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * Detects citations of existing work contexts in an objective.
 *
 * Explicit ids (`BIZ-####`/`OP-####`/`WF-####`) are detected by regex and
 * resolved for existence against the injected registry data; a fuzzy pass adds
 * title/slug references above `FUZZY_MIN` Jaccard. Detection never depends on the
 * registry (a citation is still surfaced when its type's registry is absent, as
 * `resolved:false`); resolution and owner lookup do. Fail-open: any error yields
 * `[]` (rule 2), never a throw and never a guessed citation (refuse-to-null).
 *
 * @param {string} objective - the natural-language work request.
 * @param {{ workContexts?: Array<{id,type,title?,slug?}>, workflows?: Array<{id,owner?,slug?,title?}> }} [registries]
 *   injected registry rows (the caller reads them; this stays pure).
 * @returns {Array<{ id, prefix, type, tier: 'explicit'|'fuzzy', resolved: boolean, ownerId: (string|null), score: number }>}
 */
export function scanCitations(objective, registries = {}) {
  try {
    const text = String(objective || '');
    if (!text) return [];
    const workContexts = Array.isArray(registries.workContexts) ? registries.workContexts : [];
    const workflows = Array.isArray(registries.workflows) ? registries.workflows : [];
    const wfById = new Map(workflows.map((row) => [String(row.id).toUpperCase(), row]));
    const ctxById = new Map(workContexts.map((row) => [String(row.id).toUpperCase(), row]));

    const found = new Map(); // id → citation (dedupe explicit ids)
    for (const match of text.matchAll(ID_RE)) {
      const prefix = match[1].toUpperCase();
      const id = `${prefix}-${match[2]}`;
      if (found.has(id)) continue;
      const type = TYPE_BY_PREFIX[prefix];
      const wfRow = type === 'workflow' ? wfById.get(id) : null;
      const ctxRow = type !== 'workflow' ? ctxById.get(id) : null;
      const resolved = Boolean(wfRow || ctxRow);
      const ownerId = wfRow && typeof wfRow.owner === 'string' ? wfRow.owner : null;
      found.set(id, { id, prefix, type, tier: 'explicit', resolved, ownerId, score: resolved ? 100 : 60 });
    }

    // Fuzzy pass: only when no explicit citation resolved (explicit always wins).
    const anyResolvedExplicit = [...found.values()].some((citation) => citation.resolved);
    if (!anyResolvedExplicit) {
      const objectiveTokens = tokenize(text);
      let best = null;
      for (const row of workContexts) {
        const rowTokens = tokenize(`${row.title || ''} ${row.slug || ''}`);
        const score = jaccard(objectiveTokens, rowTokens);
        if (score >= FUZZY_MIN && (!best || score > best.score)) {
          best = { id: row.id, prefix: String(row.id).split('-')[0], type: row.type, tier: 'fuzzy', resolved: true, ownerId: null, score };
        }
      }
      if (best && !found.has(best.id)) found.set(best.id, best);
    }

    // Order: explicit-resolved > explicit-unresolved > fuzzy; WF before BIZ/OP
    // among equals (a workflow is the more specific continuation target).
    return [...found.values()].sort((left, right) => {
      const tierRank = (citation) => (citation.tier === 'explicit' ? (citation.resolved ? 0 : 1) : 2);
      const byTier = tierRank(left) - tierRank(right);
      if (byTier !== 0) return byTier;
      const typeRank = (citation) => (citation.type === 'workflow' ? 0 : 1);
      const byType = typeRank(left) - typeRank(right);
      if (byType !== 0) return byType;
      return String(left.id).localeCompare(String(right.id));
    });
  } catch {
    return []; // fail-open — never throw to the hot path
  }
}

/** Builds the unlinked verdict shared by the no-citation and error paths. */
function newContextVerdict(reason, target = null, citations = []) {
  return {
    intent: 'new-context',
    target,
    confidence: 'low',
    needsClarification: false,
    clarifyQuestion: null,
    reason,
    evidence: { citations },
  };
}

/**
 * Resolves the reference-intent for a classified work request + its citations.
 *
 * Deterministic collapse (ADR-0152, spec §2). Explicit scope INTENT wins over
 * target-type inference: a "new area / new workflow / new task" signal routes
 * before the cited context's type does. Never resolves an explicit citation to
 * `new-context` unless a genuine new-scope signal (or Business nature) is present
 * — that is the bug fix (a continuation prompt must not mint a duplicate context).
 *
 * @param {object} work - the `signals.work` classification (nature/kind/executionMode).
 * @param {Array} citations - the `scanCitations` output.
 * @param {{ objective?: string }} [options]
 * @returns {{ intent, target, confidence, needsClarification, clarifyQuestion, reason, evidence }}
 */
export function resolveReferenceIntent(work, citations, options = {}) {
  try {
    const cites = Array.isArray(citations) ? citations : [];
    const text = String(options.objective || '').toLowerCase();
    const nature = work && typeof work === 'object' ? work.nature : null;
    const kind = work && typeof work.kind === 'string' ? work.kind.toLowerCase() : '';
    const executionMode = work && typeof work.executionMode === 'string' ? work.executionMode : '';

    if (cites.length === 0) return newContextVerdict('no citation — new work');

    const top = cites[0];
    const explicit = top.tier === 'explicit' && top.resolved;

    // Fuzzy-only citation with no disambiguating intent → ask (spec §2).
    if (!explicit) {
      if (hasAny(text, NEW_WORKFLOW_SIGNALS) || hasAny(text, NEW_CHILD_SIGNALS) || hasAny(text, NEW_SCOPE_SIGNALS)) {
        // A clear intent overrides a weak citation — fall through to the table.
      } else {
        return {
          intent: 'ask', target: top, confidence: 'ask', needsClarification: true,
          clarifyQuestion: CLARIFY_Q,
          reason: `ambiguous ${top.tier} citation of ${top.id} — clarify intent`,
          evidence: { citations: cites },
        };
      }
    }

    // Business nature OR an explicit new-scope signal → the citation is context.
    if (nature === 'business' || hasAny(text, NEW_SCOPE_SIGNALS)) {
      return newContextVerdict(`citation ${top.id} is contextual (${nature === 'business' ? 'business nature' : 'new-scope signal'})`, top, cites);
    }

    const ownerTarget = top.type === 'workflow' && top.ownerId
      ? { id: top.ownerId, type: top.ownerId.startsWith('OP-') ? 'operation' : 'business', tier: top.tier, resolved: true }
      : top;

    // Explicit scope intent wins over target-type inference.
    if (hasAny(text, NEW_WORKFLOW_SIGNALS) || executionMode === 'workflow') {
      return verdict('new-workflow-in-owner', ownerTarget, cites, `new-workflow signal / executionMode=${executionMode}`);
    }
    if (hasAny(text, NEW_CHILD_SIGNALS)) {
      return verdict('new-child-in-context', top, cites, 'new-child signal');
    }
    if (top.type === 'workflow') {
      return verdict('work-within', top, cites, 'cited a workflow — continue inside it');
    }
    if (WITHIN_KINDS.has(kind)) {
      return verdict('work-within', top, cites, `cited ${top.id}; kind=${kind} — continue existing work`);
    }
    // Cited a BIZ/OP with a change intent but no clear scope → ask.
    return {
      intent: 'ask', target: top, confidence: 'ask', needsClarification: true,
      clarifyQuestion: CLARIFY_Q,
      reason: `cited ${top.id} with an ambiguous scope (kind=${kind || 'none'}) — clarify intent`,
      evidence: { citations: cites },
    };
  } catch {
    return newContextVerdict('resolver error — fail-open to new-context');
  }
}

/** Builds a resolved (non-ask) verdict with high confidence. */
function verdict(intent, target, citations, reason) {
  return {
    intent, target, confidence: 'high', needsClarification: false,
    clarifyQuestion: null, reason, evidence: { citations },
  };
}
