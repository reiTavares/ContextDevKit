/**
 * Rail (a) grounded-only: exemplar retrieval + deterministic citation validation
 * (WF-0090 GA1, BIZ-0006, ADR-0148 "four rails" (a)).
 *
 * The rule this module enforces: the content engine may fill a reasoned field
 * ONLY when it can cite a BIZ-0004 graph-retrieved exemplar. No exemplar, no
 * fill — the `{{TOKEN}}` stands. Free invention is not a degraded mode here, it
 * is refused outright.
 *
 * Retrieval reuses the existing BIZ-0004 surface and adds no second retrieval
 * layer and no second `graph.json` read: the projection arrives already loaded
 * (`graph-query.mjs#loadProjection`), exactly as WF-0089's `projections.mjs`
 * receives it (S1: one read boundary, owned by the caller). The neighborhood
 * walk is `boundedReachability`, which already avoids expanding THROUGH hub
 * nodes — `mod:templates/contextkit` alone carries degree ~669, so a hand-rolled
 * traversal would drag half the repo into every candidate set.
 *
 * Validation is where the anti-hallucination teeth are, and every check is
 * deterministic — no judgment call, nothing a model can talk its way past:
 *   1. **shape** — `adr:NNNN`, `file:…`, or `sym:…`;
 *   2. **existence** — the id resolves to a real node in the loaded projection;
 *   3. **retrieved-set membership** — the id is in the set handed to the
 *      generator for THIS field. This is the check that catches an id the model
 *      invented *or* borrowed from elsewhere in the graph — it can exist and
 *      still fail;
 *   4. **numeric containment** — every numeric literal in the generated text
 *      appears verbatim in a retrieved exemplar body. This is how "no invented
 *      targets" (constitution §8) becomes enforceable on prose.
 *
 * Sufficiency is **one validated citation** (GA0 decision D2): a higher
 * threshold would be a number nobody measured, and it would make the engine
 * structurally silent on a young project with a single governing ADR — the exact
 * case ADR-0148 §3 wants working.
 *
 * A note the edge filter depends on: graph edges carry **`relation`**, not
 * `kind`/`type`. Filtering the wrong field yields zero cites for every field,
 * and the engine would then "work" while grounding nothing — a silent
 * false-negative that every refusal test would still pass. `CITES_RELATION` and
 * the selftest pin it.
 *
 * Pure and I/O-free: the projection and the exemplar bodies are both injected.
 * Zero runtime dependencies beyond the sibling graph query module.
 */
import { boundedReachability } from '../tools/scripts/graph-query.mjs';

/** The edge `relation` value that links a source file to the decision it cites. */
export const CITES_RELATION = 'cites';

/** Accepted citation id shapes — an ADR rationale node, a file node, or a symbol node. */
const CITATION_SHAPE = /^(adr:\d{4}|file:.+|sym:.+)$/;

/** Matches numeric literals (integers, decimals, and percentages) in generated prose. */
const NUMERIC_LITERAL = /\d+(?:[.,]\d+)?/g;

/**
 * Every `adr:NNNN` rationale node present in the projection, sorted. These are
 * the decision exemplars — the citable record of *why* something was chosen,
 * which is what a problem statement or a trade-off narrative must be drawn from.
 *
 * @param {object} projection a `loadProjection()` result
 * @returns {string[]} sorted `adr:NNNN` node ids (empty when the layer is absent)
 */
export function rationaleNodeIds(projection) {
  if (!projection || projection.available !== true) return [];
  return (projection.nodes ?? [])
    .map((node) => String(node?.id ?? ''))
    .filter((id) => /^adr:\d{4}$/.test(id))
    .sort();
}

/**
 * The source files that cite a given decision node, read through the `relation`
 * field (see the module header — this is the field that silently returns nothing
 * when mistyped).
 *
 * @param {object} projection a `loadProjection()` result
 * @param {string} adrNodeId e.g. `adr:0148`
 * @returns {string[]} sorted citing node ids
 */
export function citingSources(projection, adrNodeId) {
  if (!projection || projection.available !== true) return [];
  const citing = new Set();
  for (const edge of projection.edges ?? []) {
    if (edge?.relation !== CITES_RELATION) continue;
    if (String(edge.target) === adrNodeId) citing.add(String(edge.source));
  }
  return [...citing].sort();
}

/**
 * Builds the candidate exemplar set for one field: the governing decision nodes
 * (plus the sources that cite them) ∪ the bounded, hub-avoiding neighborhood of
 * the context's declared entry symbols.
 *
 * Fail-open (WF-0089 R7): an unavailable projection degrades to an empty set with
 * a reason, never a throw — and an empty set is a refusal upstream, so the
 * `{{TOKEN}}` survives.
 *
 * @param {string} fieldKey the reasoned field being grounded (recorded on the envelope)
 * @param {{governingAdrIds?: string[], entrySymbols?: string[], budget?: number}} context
 *   resolved context: governing ADR ids (`adr:NNNN` or bare `NNNN`), the pack's
 *   declared entry symbols, and the per-symbol graph budget
 * @param {object} projection a `loadProjection()` result
 * @returns {{source:'biz0004:exemplars', available:boolean, value:{exemplars:string[],
 *   excludedHubs:string[]}|null, reason:string|null,
 *   inputs:{fieldKey:string, governingAdrIds:string[], entrySymbols:string[], budget:number}}}
 */
export function retrieveExemplars(fieldKey, context = {}, projection = null) {
  const budget = Number.isInteger(context.budget) && context.budget > 0 ? context.budget : 40;
  const governingAdrIds = [...new Set((context.governingAdrIds ?? []).map(normalizeAdrId).filter(Boolean))].sort();
  const entrySymbols = [...new Set((context.entrySymbols ?? []).filter((symbol) => typeof symbol === 'string' && symbol.trim()))].sort();
  const inputs = { fieldKey, governingAdrIds, entrySymbols, budget };

  if (!projection || projection.available !== true) {
    return {
      source: 'biz0004:exemplars',
      available: false,
      value: null,
      reason: projection?.reason ?? 'no committed graph projection',
      inputs,
    };
  }

  const known = new Set((projection.nodes ?? []).map((node) => String(node?.id ?? '')));
  const exemplars = new Set();
  const excludedHubs = new Set();

  for (const adrId of governingAdrIds) {
    if (!known.has(adrId)) continue;
    exemplars.add(adrId);
    for (const citing of citingSources(projection, adrId)) exemplars.add(citing);
  }
  for (const seedId of entrySymbols) {
    if (!known.has(seedId)) continue;
    const walk = boundedReachability(projection, seedId, budget);
    if (walk.available !== true) continue;
    for (const node of walk.nodes) exemplars.add(node);
    for (const hub of walk.excludedHubs) excludedHubs.add(hub);
  }

  return {
    source: 'biz0004:exemplars',
    available: true,
    value: { exemplars: [...exemplars].sort(), excludedHubs: [...excludedHubs].sort() },
    reason: null,
    inputs,
  };
}

/** Normalizes `148` / `0148` / `ADR-0148` / `adr:0148` to the `adr:0148` node id form. */
function normalizeAdrId(candidate) {
  const text = String(candidate ?? '').trim();
  const digits = text.match(/(\d{1,4})\s*$/);
  if (!digits) return null;
  return `adr:${digits[1].padStart(4, '0')}`;
}

/**
 * Every numeric literal in a piece of text, deduped. Used by the containment
 * check so a generated target ("reduces cost by 40%") cannot pass unless the 40
 * came from an exemplar.
 *
 * @param {string} text
 * @returns {string[]} sorted numeric literals
 */
export function numericLiteralsIn(text) {
  const matches = String(text ?? '').match(NUMERIC_LITERAL) ?? [];
  return [...new Set(matches)].sort();
}

/**
 * Validates ONE citation against the four deterministic checks. Refuses by
 * default: an unknown shape, an id absent from the projection, or an id outside
 * this field's retrieved set all decline with a named reason.
 *
 * @param {object} args
 * @param {string} args.citation the citation id the generator returned
 * @param {object} args.projection a `loadProjection()` result
 * @param {Set<string>|string[]} args.retrievedSet the exemplar set handed to the
 *   generator for THIS field
 * @returns {{valid: boolean, reason: string}}
 */
export function validateCitation({ citation, projection, retrievedSet }) {
  const id = String(citation ?? '').trim();
  if (!CITATION_SHAPE.test(id)) return { valid: false, reason: 'citation-shape-rejected' };
  if (!projection || projection.available !== true) return { valid: false, reason: 'no-projection-to-validate-against' };

  const known = new Set((projection.nodes ?? []).map((node) => String(node?.id ?? '')));
  if (!known.has(id)) return { valid: false, reason: 'citation-resolves-to-no-node (hallucinated)' };

  const retrieved = retrievedSet instanceof Set ? retrievedSet : new Set(retrievedSet ?? []);
  if (!retrieved.has(id)) return { valid: false, reason: 'citation-outside-this-field-retrieved-set' };

  return { valid: true, reason: 'validated' };
}

/**
 * The full rail (a) verdict for one generated candidate: validates every returned
 * citation, then requires numeric containment against the retrieved exemplar
 * bodies. Sufficiency is one validated citation (D2).
 *
 * Exemplar bodies are INJECTED, not read: this module never touches disk. A
 * retrieved exemplar with no supplied body contributes no numeric evidence, so a
 * generated number simply fails containment — which is the correct outcome for
 * GA0 risk R-B (an ADR node exists in the graph but its prose is not indexed).
 *
 * @param {object} args
 * @param {string} args.text the generated content
 * @param {string[]} args.citations the citation ids the generator returned
 * @param {object} args.projection a `loadProjection()` result
 * @param {Set<string>|string[]} args.retrievedSet this field's retrieved exemplar set
 * @param {Record<string,string>} [args.exemplarBodies] exemplar id → body text
 * @returns {{grounded: boolean, citations: string[], reason: string,
 *   rejected: Array<{citation:string, reason:string}>}}
 */
export function evaluateGrounding({ text, citations, projection, retrievedSet, exemplarBodies = {} }) {
  const validated = [];
  const rejected = [];
  for (const candidate of citations ?? []) {
    const verdict = validateCitation({ citation: candidate, projection, retrievedSet });
    if (verdict.valid) validated.push(String(candidate).trim());
    else rejected.push({ citation: String(candidate ?? ''), reason: verdict.reason });
  }

  const unique = [...new Set(validated)].sort();
  if (unique.length === 0) {
    return { grounded: false, citations: [], reason: 'no-validated-citation', rejected };
  }

  const retrieved = retrievedSet instanceof Set ? retrievedSet : new Set(retrievedSet ?? []);
  const evidence = Object.entries(exemplarBodies)
    .filter(([id]) => retrieved.has(id))
    .map(([, body]) => String(body ?? ''))
    .join('\n');
  const invented = numericLiteralsIn(text).filter((literal) => !evidence.includes(literal));
  if (invented.length > 0) {
    return {
      grounded: false,
      citations: [],
      reason: `numeric-literal-not-in-exemplar: ${invented.join(', ')}`,
      rejected,
    };
  }

  return { grounded: true, citations: unique, reason: 'grounded', rejected };
}
