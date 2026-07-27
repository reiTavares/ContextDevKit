/**
 * The grounded content engine — the ONE place in ContextDevKit where an LLM
 * writes (WF-0090 GA1, BIZ-0006, ADR-0148 §10 + the "four rails" section).
 *
 * WF-0089 derives the STRUCTURAL half of a spec/PRD for free (projection, zero
 * tokens, no model). What it deliberately leaves as `{{TOKEN}}` is the REASONED
 * half: the problem statement, the semantics of acceptance criteria, the
 * trade-off narratives. This module fills that half — and only that half — behind
 * four hard rails, because ungoverned LLM auto-fill was the top over-engineering
 * risk the whole council flagged.
 *
 * The rails, and where each one lives:
 *   (a) **grounded-only** — every filled field cites a BIZ-0004 graph-retrieved
 *       exemplar; ungrounded stays `{{TOKEN}}` (`content-grounding.mjs`).
 *   (b) **provenance-gated** — a fill is stamped `draft`, never `authored` and
 *       never `derived`; only a human verdict or a human edit promotes it, and
 *       growth targets stay `null` because no write path to one exists at all
 *       (`content-eligibility.mjs` + `provenance.mjs#stampDraftEntry`).
 *   (c) **token-guardrailed with a kill-switch** — GA2 owns the evaluator; this
 *       module takes it as an INJECTED `deps.killSwitch` and, absent one, is
 *       simply off. There is no stub module to forget to replace.
 *   (d) **structure-only fallback** — every off/unavailable/refused path
 *       converges on the same observable outcome: nothing written, nothing
 *       thrown, the skeleton stands, and the run is byte-identical to a build
 *       with this engine absent.
 *
 * Default-refuse is structural, not configured (constitution §8): `deps.generate`
 * defaults to `null`, so an engine nobody wired up cannot spend a token, and
 * every test in the suite runs with a fake generator and zero model calls.
 *
 * Purity: no disk, no clock, no network, no `graph.json` read. The projection
 * arrives loaded, the ledger arrives read, the sidecar arrives parsed, and the
 * generator arrives injected — the caller owns all four boundaries, exactly as
 * `projections.mjs` keeps `loadProjection` outside itself (S1: one read boundary).
 * The engine returns a NEW sidecar; the caller persists it with the existing
 * `writeSidecar`, which refuses an invalid one.
 *
 * What this module must never become: a decision path. An LLM here fills domain
 * *content*; every governance decision stays a deterministic table/graph lookup.
 * A gate that dispatches a model to decide is a token tax and is forbidden
 * (ADR-0148 §13) — enforced structurally by the selftest assertion that no hook
 * and no `*-gate.mjs` imports this file.
 *
 * Zero runtime dependencies — `node:*` and sibling modules only.
 */
import {
  REASONED_FIELD_KEYS,
  evaluateEligibility,
  reasonedSentinels,
} from './content-eligibility.mjs';
import { evaluateGrounding, retrieveExemplars } from './content-grounding.mjs';
import {
  fieldAuthority,
  hashInputDomain,
  inputDomainForGroundedContent,
  setFieldEntry,
  stampDraftEntry,
} from './provenance.mjs';

/** The source id for model-written content — `llm:`-namespaced so a grep separates it from derived fields. */
export const GROUNDED_CONTENT_SOURCE = 'llm:grounded-content';

/**
 * The verdict key carrying the engine-level reason. Deliberately outside
 * `REASONED_FIELD_KEYS` and prefixed so it can never be mistaken for a field
 * write or land in a sidecar.
 */
export const ENGINE_VERDICT_KEY = '__engine';

/** The shipped default config: off twice over (GA0 decision D3). */
export const CONTENT_FILL_DEFAULTS = Object.freeze({
  enabled: false,
  tokenBudgetPerContext: 0,
  promptVersion: 1,
});

/** Builds the uniform "engine did not run" result — rail (d)'s single convergence point. */
function engineOff(sidecar, reason) {
  return {
    fields: { [ENGINE_VERDICT_KEY]: { action: 'skip', text: null, citations: [], reason } },
    provenance: sidecar,
  };
}

/**
 * Resolves whether the engine may run at all. Every condition refuses by default
 * and names its reason; an unavailable measurement is `skipped`, which never
 * authorizes spend and never blocks work (constitution §8).
 *
 * Rail (c) proper is GA2's `evaluateKillSwitch`, injected as `deps.killSwitch`.
 * Absent it, the engine still refuses on the checks knowable here — so wiring
 * order can never accidentally open the gate.
 *
 * @param {object} args
 * @param {object} args.config resolved `methodology.contentFill` block
 * @param {object} args.graph a `loadProjection()` result
 * @param {object} args.ledger a governance-token ledger read
 * @param {object} args.deps injected collaborators
 * @returns {{allowed: boolean, reason: string}}
 */
export function resolveActivation({ config, graph, ledger, deps }) {
  const resolved = { ...CONTENT_FILL_DEFAULTS, ...(config ?? {}) };
  if (resolved.enabled !== true) return { allowed: false, reason: 'config.enabled=false (shipped default is off)' };
  if (!(Number(resolved.tokenBudgetPerContext) > 0)) {
    return { allowed: false, reason: 'config.tokenBudgetPerContext=0 (no spend authorized)' };
  }
  if (typeof deps?.generate !== 'function') return { allowed: false, reason: 'no generator injected (deps.generate=null)' };
  if (!graph || graph.available !== true) {
    return { allowed: false, reason: graph?.reason ?? 'no committed graph projection (nothing to ground against)' };
  }
  if (!ledger || ledger.available !== true) {
    return { allowed: false, reason: `governance-token ledger unavailable: ${ledger?.reason ?? 'not read'} (skipped, never a pass)` };
  }

  // The §13 guardrail FLOOR, enforced here and not only in the injected
  // kill-switch. An `available` ledger is not a trusted ledger: a non-finite or
  // negative measurement is unusable, and unusable is `skipped` — never a pass
  // (constitution §8). And the non-regression comparison is the guardrail
  // itself ("governance-tokens/session must NOT rise"), so it cannot depend on
  // a caller remembering to inject `deps.killSwitch`: a wiring step that forgets
  // one line must not be able to ship an ungoverned engine.
  // Type-checked, never coerced: `Number(null)` is 0, so coercion would read a
  // MISSING measurement as "measured zero spend" and authorize the fill.
  const sessionTokens = ledger.sessionTokens;
  if (typeof sessionTokens !== 'number' || !Number.isFinite(sessionTokens) || sessionTokens < 0) {
    return { allowed: false, reason: `governance-token measurement unusable (skipped, never a pass): ${JSON.stringify(ledger.sessionTokens)}` };
  }
  const budget = Number(resolved.tokenBudgetPerContext);
  if (!Number.isFinite(budget)) {
    return { allowed: false, reason: `config.tokenBudgetPerContext is not a finite number: ${JSON.stringify(resolved.tokenBudgetPerContext)}` };
  }
  if (sessionTokens >= budget) {
    return { allowed: false, reason: `per-context token budget consumed (${sessionTokens} >= ${budget})` };
  }
  const priorRaw = ledger.priorSessionTokens;
  const priorTokens = priorRaw === null || priorRaw === undefined ? null : priorRaw;
  if (priorTokens !== null && (typeof priorTokens !== 'number' || !Number.isFinite(priorTokens))) {
    return { allowed: false, reason: `prior-session measurement unusable (skipped, never a pass): ${JSON.stringify(priorRaw)}` };
  }
  if (priorTokens !== null && sessionTokens > priorTokens) {
    return { allowed: false, reason: `governance-tokens/session rising (${sessionTokens} > ${priorTokens}) — guardrail floor tripped` };
  }

  // The injected kill-switch is an ADDITIONAL layer on top of that floor (it also
  // reads session pressure). Wrapped like `safeGenerate` wraps the generator: the
  // component that interprets an externally-read ledger is the most plausible
  // thing here to fail at runtime, and a throwing guardrail must land in rail (d)
  // rather than escape as an exception.
  if (typeof deps?.killSwitch === 'function') {
    let verdict;
    try {
      verdict = deps.killSwitch(resolved, ledger, deps.pressure ?? null);
    } catch {
      return { allowed: false, reason: 'injected kill-switch threw (treated as tripped)' };
    }
    if (!verdict || verdict.enabled !== true) {
      return { allowed: false, reason: verdict?.reason ?? 'kill-switch tripped' };
    }
  }
  return { allowed: true, reason: 'activated' };
}

/**
 * Fills the reasoned half of a skeleton behind all four rails.
 *
 * Never blocks: a refusal on any rail leaves the field's bytes and the sidecar
 * untouched, and the caller can ignore the result entirely and still hold a valid
 * artifact. Every rail path — an off engine, a refused field, a throwing
 * generator, a throwing kill-switch — is a refusal, not an exception.
 *
 * It is NOT throw-proof against a hostile argument: a getter that throws on
 * `context.config`, `skeleton.fields`, `graph.nodes` or `ledger.available` will
 * propagate. GA0 assigns fail-open at the boundary to the CALLER's try/catch (the
 * same discipline as SA2's `stampWorkflowTasksProvenance`), so wrap the call the
 * way `workflow/create.mjs` wraps the provenance stamp.
 *
 * @param {object} context resolved work context —
 *   `{ contextRef, sidecar, governingAdrIds, entrySymbols, title, graphSignature, config }`.
 *   `sidecar` is the parsed provenance sidecar (`provenance.mjs#readSidecar`);
 *   the engine reads it and returns a new one but never persists it.
 * @param {{fields: Record<string,{contentKind?:'markdown'|'json', current:string}>}} skeleton
 *   the current content of each candidate field, extracted by the caller (e.g.
 *   via `markdownSectionBody`)
 * @param {object} graph an already-loaded `loadProjection()` result
 * @param {{available:boolean, sessionTokens?:number, priorSessionTokens?:number|null, reason?:string}} ledger
 *   an already-read governance-token ledger
 * @param {{generate?: (request:object) => {text:string, citations:string[]},
 *   killSwitch?: Function, pressure?: object, exemplarBodies?: Record<string,string>}} [deps]
 *   injected collaborators; `generate` defaults to `null`, which keeps the engine off
 * @returns {{fields: Record<string,{action:'fill'|'refuse'|'skip', text:string|null,
 *   citations:string[], reason:string}>, provenance: object}}
 */
export function fillGroundedContent(context, skeleton, graph, ledger, deps = {}) {
  const sidecar = context?.sidecar ?? { schemaVersion: 1, contextRef: context?.contextRef ?? null, fields: {} };
  const activation = resolveActivation({ config: context?.config, graph, ledger, deps });
  if (!activation.allowed) return engineOff(sidecar, activation.reason);

  const resolvedConfig = { ...CONTENT_FILL_DEFAULTS, ...(context.config ?? {}) };
  const sentinels = reasonedSentinels({ title: context?.title ?? '' });
  const fields = {};
  let nextSidecar = sidecar;

  for (const fieldKey of REASONED_FIELD_KEYS) {
    const slot = skeleton?.fields?.[fieldKey];
    if (!slot) continue;

    const { entry, claimed } = fieldAuthority(nextSidecar, fieldKey);
    const eligibility = evaluateEligibility({ fieldKey, current: slot.current, entry, claimed, sentinels });
    if (!eligibility.eligible) {
      fields[fieldKey] = { action: 'refuse', text: null, citations: [], reason: eligibility.reason };
      continue;
    }

    // Rail (a) step 1-2: retrieve, and refuse for free when nothing was retrieved.
    // The generator is never reached on this path, so an ungrounded field costs
    // zero tokens rather than a wasted call the validator then throws away.
    const retrieval = retrieveExemplars(fieldKey, {
      governingAdrIds: context?.governingAdrIds,
      entrySymbols: context?.entrySymbols,
      budget: context?.budget,
    }, graph);
    const exemplars = retrieval.available ? retrieval.value.exemplars : [];
    if (exemplars.length === 0) {
      fields[fieldKey] = {
        action: 'refuse',
        text: null,
        citations: [],
        reason: retrieval.available ? 'empty-retrieved-set' : `retrieval-unavailable: ${retrieval.reason}`,
      };
      continue;
    }

    const candidate = safeGenerate(deps.generate, {
      fieldKey,
      exemplars,
      exemplarBodies: pickBodies(deps.exemplarBodies, exemplars),
      promptVersion: resolvedConfig.promptVersion,
    });
    if (!candidate) {
      fields[fieldKey] = { action: 'refuse', text: null, citations: [], reason: 'generator-returned-nothing' };
      continue;
    }

    // Rail (a) steps 3-5: every citation validated against the graph and this
    // field's own retrieved set, then numeric containment. One validated
    // citation is sufficient (D2); zero refuses.
    const grounding = evaluateGrounding({
      text: candidate.text,
      citations: candidate.citations,
      projection: graph,
      retrievedSet: exemplars,
      exemplarBodies: deps.exemplarBodies ?? {},
    });
    if (!grounding.grounded) {
      fields[fieldKey] = { action: 'refuse', text: null, citations: [], reason: grounding.reason };
      continue;
    }

    // Rail (b): stamp `draft` — never `authored`, never `derived`. The inputHash
    // folds the citations and the prompt version, so an identical re-run is a
    // no-op and burns no tokens.
    const inputHash = hashInputDomain(inputDomainForGroundedContent({
      fieldKey,
      citations: grounding.citations,
      graphSignature: context?.graphSignature ?? '',
      promptVersion: resolvedConfig.promptVersion,
    }));
    const contentKind = slot.contentKind === 'json' ? 'json' : 'markdown';
    const draftEntry = stampDraftEntry({
      source: GROUNDED_CONTENT_SOURCE,
      inputHash,
      newContent: candidate.text,
      citations: grounding.citations,
      contentKind,
    });
    nextSidecar = setFieldEntry(nextSidecar, fieldKey, draftEntry);
    fields[fieldKey] = {
      action: 'fill',
      text: candidate.text,
      citations: grounding.citations,
      reason: 'grounded-draft',
    };
  }

  return { fields, provenance: nextSidecar };
}

/** Restricts the injected exemplar bodies to the ids actually retrieved for this field. */
function pickBodies(exemplarBodies, exemplars) {
  const bodies = {};
  for (const id of exemplars) {
    const body = exemplarBodies?.[id];
    if (typeof body === 'string' && body.length > 0) bodies[id] = body;
  }
  return bodies;
}

/**
 * Calls the injected generator defensively. A generator that throws, or returns a
 * malformed shape, degrades to `null` — which the caller turns into a refusal, so
 * a broken model path lands in rail (d) instead of escaping as an exception.
 *
 * @param {Function} generate the injected generator
 * @param {object} request `{ fieldKey, exemplars, exemplarBodies, promptVersion }`
 * @returns {{text:string, citations:string[]}|null}
 */
function safeGenerate(generate, request) {
  let candidate;
  try {
    candidate = generate(request);
  } catch {
    return null;
  }
  if (!candidate || typeof candidate !== 'object') return null;
  const text = typeof candidate.text === 'string' ? candidate.text.trim() : '';
  if (text.length === 0) return null;
  return { text, citations: Array.isArray(candidate.citations) ? candidate.citations : [] };
}
