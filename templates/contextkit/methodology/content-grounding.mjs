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
 *   4. **quantity containment** — every quantity the generated text asserts must
 *      also be asserted by a retrieved exemplar. Compared as canonical token
 *      SETS, per exemplar: Unicode digits fold to ASCII, thousands separators
 *      drop, leading zeros are not significant, and English number words resolve
 *      to their value, so "forty percent" is constrained exactly like "40%".
 *      Never a substring scan over concatenated bodies — that licensed `4`
 *      because some exemplar said `40`, and manufactured cross-exemplar numbers
 *      belonging to no single exemplar.
 *
 * Sufficiency is **one validated citation** (GA0 decision D2): a higher
 * threshold would be a number nobody measured, and it would make the engine
 * structurally silent on a young project with a single governing ADR — the exact
 * case ADR-0148 §3 wants working.
 *
 * **The honest scope of these four checks**, so no downstream doc overclaims:
 * they constrain *citation provenance* and *asserted quantities*, not entailment.
 * One validated citation plus digit-free prose is `grounded:true` — the model
 * cannot cite something it did not retrieve, and cannot state a number no
 * exemplar states, but nothing here proves a sentence follows from its exemplar.
 * Non-numeric claims ("risk is HIGH") are unconstrained, and a quantity written
 * in a form outside the recognized digit/word vocabulary is not seen as a
 * quantity. That is why rail (b) exists: WF-0090's real guarantee is "every
 * generated field is traceable to a retrieved exemplar and lands as `draft` for
 * human review" — never "every generated sentence is supported".
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

/** Matches numeric literals (integers and decimals) in already-normalized prose. */
const NUMERIC_LITERAL = /\d+(?:\.\d+)?/g;

/**
 * English number words mapped to their canonical value, so a target written in
 * WORDS is constrained exactly like one written in digits — a model asked for
 * prose writes "forty percent" as readily as "40%", so this is the likely form,
 * not the exotic one.
 *
 * Bounded on purpose: units, teens, tens, the common scales, and the fraction
 * words that carry a quantity claim. Compound forms are handled by summing
 * hyphen/space-joined parts (`ninety-nine` -> 99). Anything outside this table is
 * not recognized as a quantity — see the module header for what that means.
 */
const NUMBER_WORDS = Object.freeze({
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
  million: 1000000, billion: 1000000000,
  half: 0.5, third: 3, thirds: 3, quarter: 4, quarters: 4,
});

/**
 * The decimal value of any Unicode decimal digit, as an ASCII digit string.
 * Derived, not tabulated: every `Nd` block is exactly ten contiguous code points,
 * so walking back to the block's zero yields the value without hardcoding a list
 * of digit blocks.
 *
 * @param {string} character a single `\p{Nd}` character
 * @returns {string} the ASCII digit
 */
function digitValue(character) {
  const code = character.codePointAt(0);
  let zero = code;
  while (code - zero < 9 && zero > 0 && /\p{Nd}/u.test(String.fromCodePoint(zero - 1))) zero -= 1;
  return String(code - zero);
}

/**
 * Canonicalizes text before any numeric comparison: every Unicode decimal digit
 * becomes its ASCII equivalent (so fullwidth `４０` and Arabic-Indic `٤٠` cannot
 * smuggle a number past the check), and thousands separators inside a digit group
 * are removed so `1,000` / `1 000` / `1000` are one token.
 *
 * @param {string} text
 * @returns {string}
 */
function normalizeQuantityText(text) {
  const asciiDigits = String(text ?? '').replace(/\p{Nd}/gu, digitValue);
  return asciiDigits.replace(/(\d)[,   ](\d{3})(?!\d)/g, '$1$2');
}

/**
 * The canonical value of a hyphen/space-joined number-word compound, or null when
 * the phrase is not a recognized quantity.
 *
 * @param {string[]} words lowercased word parts
 * @returns {number|null}
 */
function compoundWordValue(words) {
  let total = 0;
  let matched = false;
  for (const word of words) {
    const value = NUMBER_WORDS[word];
    if (value === undefined) return null;
    matched = true;
    total = value >= 100 && total > 0 ? total * value : total + value;
  }
  return matched ? total : null;
}

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

/**
 * Coerces a retrieved-set argument to a `Set` of ids, refusing rather than
 * throwing on a malformed one. These are exported validators on the
 * anti-hallucination path: a caller passing junk must get a REFUSAL (an empty
 * set matches nothing, so every citation fails membership), never a `TypeError`
 * from `new Set(nonIterable)`.
 *
 * @param {Set<string>|string[]|unknown} candidate
 * @returns {Set<string>}
 */
function toIdSet(candidate) {
  if (candidate instanceof Set) return candidate;
  if (Array.isArray(candidate)) return new Set(candidate.map((id) => String(id)));
  return new Set();
}

/** Normalizes `148` / `0148` / `ADR-0148` / `adr:0148` to the `adr:0148` node id form. */
function normalizeAdrId(candidate) {
  const text = String(candidate ?? '').trim();
  const digits = text.match(/(\d{1,4})\s*$/);
  if (!digits) return null;
  return `adr:${digits[1].padStart(4, '0')}`;
}

/**
 * Every quantity a piece of text asserts, as a deduped set of canonical numeric
 * STRINGS. Used by the containment check so a generated target ("reduces cost by
 * 40%") cannot pass unless that 40 came from an exemplar.
 *
 * Canonical, not literal, because the comparison has to survive the ways the same
 * quantity can be spelled: Unicode digits are folded to ASCII, thousands
 * separators are dropped, a leading zero is not significant (`04` and `4` are one
 * quantity), and English number words are resolved to their value so
 * "forty percent" is constrained exactly like "40%".
 *
 * @param {string} text
 * @returns {string[]} sorted canonical quantity strings
 */
export function numericLiteralsIn(text) {
  const normalized = normalizeQuantityText(text);
  const quantities = new Set();
  for (const match of normalized.match(NUMERIC_LITERAL) ?? []) {
    const value = Number(match);
    if (Number.isFinite(value)) quantities.add(String(value));
  }
  // Word compounds: scan maximal runs of hyphen/space-joined number words so
  // `ninety-nine` resolves to 99 rather than to 90 and 9 separately.
  const words = normalized.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  let run = [];
  const flush = () => {
    if (run.length === 0) return;
    const value = compoundWordValue(run);
    if (value !== null) quantities.add(String(value));
    run = [];
  };
  for (const word of words) {
    if (NUMBER_WORDS[word] !== undefined) run.push(word);
    else flush();
  }
  flush();
  return [...quantities].sort();
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

  const retrieved = toIdSet(retrievedSet);
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

  const retrieved = toIdSet(retrievedSet);
  // Quantity containment compares TOKEN SETS, per exemplar — never a substring
  // scan over a concatenated blob. Two reasons, both of which were real holes:
  // a substring test licenses `4` because some exemplar says `40` (and `0`/`00`
  // because one says `1,000`), and concatenating bodies manufactures
  // cross-exemplar numbers that exist in no single exemplar.
  const evidenceQuantities = new Set();
  for (const [id, body] of Object.entries(exemplarBodies ?? {})) {
    if (!retrieved.has(id)) continue;
    for (const quantity of numericLiteralsIn(body)) evidenceQuantities.add(quantity);
  }
  const invented = numericLiteralsIn(text).filter((quantity) => !evidenceQuantities.has(quantity));
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
