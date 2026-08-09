/**
 * task-intake.mjs — Task request → deterministic signals (CDK-021, ADR-0072).
 *
 * Turns a raw task request into a typed, canonical `signals` object by running the
 * request's objective through the deterministic complexity rubric classifier.
 * No LLM, no Math.random — same input always produces the same output.
 *
 * Consumers: mutation-only intake commands and the v4 governance dispatcher.
 * NOT consumed by hooks directly — hooks call load.mjs; this module stays out of
 * that chain to avoid circular imports (ADR-0001 / immutable rule 1).
 *
 * Zero runtime dependencies — only `node:*` and the canonical platform helpers.
 *
 * ADDITIVE (B2, BIZ-0001/WF-0037, ADR-0102): `signals.decisionNeed` and
 * `signals.decisionMatch` are attached after the existing A2 `signals.work`.
 * All prior keys are untouched. The B2 enrichment is fail-open: any error
 * omits the two keys entirely without affecting the tier/domain/work flow.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classify, loadRubric } from '../../tools/scripts/complexity-rubric.mjs';
import { classifyWork, loadWorkPolicy } from './work-classifier.mjs';
import { classifyDecisionNeed } from './decision-need-classifier.mjs';
import { classifyIntentLangAware } from './intent-language.mjs';
import { classifyInteraction, detectInteractionLanguage } from './interaction-classify.mjs';
import { pathsFor } from '../config/paths.mjs';

// Attempt to import B2-T2's searchDecisions at module init — degrade silently
// when the module does not yet exist (parallel wave). The variable is null until
// B2-T2 ships; the intake() function checks before calling (fail-open).
let _searchDecisions = null;
try {
  // eslint-disable-next-line n/no-missing-import
  const _mod = await import('../../tools/scripts/decision-search-match.mjs');
  if (typeof _mod?.searchDecisions === 'function') _searchDecisions = _mod.searchDecisions;
} catch { /* B2-T2 not yet present — degrade silently */ }

/**
 * Normalize an already-computed existing-work resolver verdict. This function
 * never searches storage itself: callers must run the resolver only after the
 * interaction is known to be a mutation.
 *
 * @param {string|object|null} resolution resolver output
 * @param {{ prompt?: string, explicitReopen?: boolean }} [context]
 * @returns {{ state: 'explicit'|'inferred'|'ambiguous'|'new'|'none',
 *   canResume: boolean, canCreate: boolean, requiresExplicitReopen: boolean,
 *   clarification: string|null, degraded?: boolean }}
 */
export function normalizeExistingWorkResolution(resolution, context = {}) {
  try {
    const rawState = typeof resolution === 'string'
      ? resolution
      : resolution?.state ?? resolution?.status ?? resolution?.verdict ?? 'none';
    const validState = ['explicit', 'inferred', 'ambiguous', 'new', 'none'].includes(rawState);
    const resolverFailed = resolution?.error || resolution?.unavailable || !validState;
    const state = validState ? rawState : 'none';
    const itemStatus = typeof resolution === 'object' ? resolution?.itemStatus ?? resolution?.workStatus : null;
    const doneWithoutOrder = itemStatus === 'done' && context.explicitReopen !== true;
    const language = detectInteractionLanguage(context.prompt ?? '');
    const clarification = ['inferred', 'ambiguous'].includes(state)
      ? (language === 'pt' ? 'Qual trabalho existente devo usar?' : 'Which existing work should I use?')
      : null;

    const normalized = {
      state,
      canResume: state === 'explicit' && !doneWithoutOrder,
      canCreate: state === 'new',
      requiresExplicitReopen: doneWithoutOrder,
      clarification,
    };
    if (resolverFailed) normalized.degraded = true;
    return normalized;
  } catch {
    return {
      state: 'none',
      canResume: false,
      canCreate: false,
      requiresExplicitReopen: false,
      clarification: null,
      degraded: true,
    };
  }
}

/**
 * Converts a task request into canonical, deterministic signals plus a human-
 * readable `reasons` array recording WHY each classification decision was made
 * (ADR-0072 §2: signals and reasons must be recorded, not just the verdict).
 *
 * The function is pure given its arguments: `env.root` drives rubric loading
 * (which itself falls back to the embedded DEFAULT_RUBRIC), but the rubric is
 * deterministic for any given root, so the output is reproducible.
 *
 * @param {{ objective: string, taskId?: string, sessionId?: string,
 *           branch?: string, paths?: string[], level?: number,
 *           phase?: string, host?: string }} request task request object
 * @param {{ root?: string, level?: number }} [env] runtime environment hints
 * @returns {{ signals: object, reasons: string[] }}
 *   signals includes: tier, domain, needsAdr, paths, phase, level, work (A2),
 *   and (when B2 is active) decisionNeed, decisionMatch.
 *
 * @example
 * const { signals, reasons } = intake({ objective: 'fix typo in README' });
 * // signals.tier === 'trivial'
 */
export function intake(request, env = {}) {
  const safeRequest = request && typeof request === 'object' ? request : {};
  const safeEnv = env && typeof env === 'object' ? env : {};
  const objective = String(safeRequest.objective ?? '').trim();
  const interaction = classifyInteraction(objective, safeEnv.interactionContext ?? {});

  // Mutation-only governance: conversation, exploration, and uncertainty stop
  // here. In particular, do not load rubrics, policies, registries, task ids, or
  // governed context on this path. The returned object is an ephemeral signal.
  if (interaction.intent !== 'mutation') {
    return {
      signals: {
        interaction,
        intent: classifyIntentLangAware(objective, {
          interactionContext: safeEnv.interactionContext ?? {},
        }),
      },
      reasons: [`interaction=${interaction.intent} (${interaction.reasonCodes.join(', ')})`],
    };
  }

  const rubric = loadRubric(safeEnv.root);
  const classification = classify(objective, rubric);

  const tier = classification.tier;
  const domain = classification.domain;
  const needsAdr = classification.needsAdr;
  const level = safeRequest.level ?? safeEnv.level ?? 7;

  // Build the reasons array — records the rationale for each key decision.
  const reasons = buildReasons(classification, tier, domain);

  const signals = {
    taskId: safeRequest.taskId ?? null,
    sessionId: safeRequest.sessionId ?? null,
    branch: safeRequest.branch ?? null,
    host: safeRequest.host ?? null,
    tier,
    domain,
    needsAdr,
    paths: Array.isArray(safeRequest.paths) ? safeRequest.paths : [],
    phase: safeRequest.phase ?? '*',
    level,
    interaction,
  };

  signals.existingWork = normalizeExistingWorkResolution(
    safeEnv.existingWorkResolution ?? safeRequest.existingWorkResolution ?? null,
    {
      prompt: objective,
      explicitReopen: safeEnv.explicitReopen === true || safeRequest.explicitReopen === true,
    },
  );

  // ADDITIVE (A2, BIZ-0001/WF-0036, ADR-0102): attach the deterministic
  // methodology classification under a NEW namespace. The legacy tier keys above
  // are untouched — `signals.work` is a pure superset, so existing consumers
  // Existing public signal keys remain stable (design §6.1).
  signals.work = classifyWork(objective, loadWorkPolicy(safeEnv.root));

  // ADDITIVE (B2, BIZ-0001/WF-0037, ADR-0102): enrich with decision-need
  // classification + registry match. Wrapped in try/catch — fail-open always.
  // The decision registry is loaded ONCE from the generated/cached file; we never
  // rebuild it by scanning the tree on the hot path (frozen interface contract §4).
  // `_searchDecisions` is B2-T2's export resolved at module init; null until B2-T2
  // ships (parallel wave) — this block degrades silently in that case.
  try {
    const registry = loadDecisionRegistry(safeEnv.root);
    const needInput = { signals: { ...signals, objective }, decisionRegistry: registry, platformRoot: safeEnv.root };
    signals.decisionNeed = classifyDecisionNeed(needInput);

    if (typeof _searchDecisions === 'function' && registry) {
      signals.decisionMatch = _searchDecisions(registry, signals.decisionNeed);
    }
  } catch {
    // B2 enrichment is advisory — never break the existing intake contract.
  }

  // ADDITIVE (WF-0069, OP-0008, ADR-0131): language-aware intent signal. Attaches
  // `signals.intent = { language, intent, mutationVerb, readOnly, confidence,
  // routeToAI }` under a NEW namespace — all prior keys untouched. Zero-dep, no LLM
  // (immutable rule 1). Wrapped fail-open: any error omits the key without touching
  // the tier/domain/work flow (rule 2). Detection + pt/en fast-path only; translation
  // of other languages is delegated to the model via the hook directive (never here).
  try {
    signals.intent = classifyIntentLangAware(objective, {
      interactionContext: safeEnv.interactionContext ?? {},
    });
  } catch {
    // intent enrichment is advisory — never break the existing intake contract.
  }

  return { signals, reasons };
}

/**
 * Loads the pre-built decision registry from its generated/cached JSON path.
 * Returns null (fail-open) on any error. Never scans the ADR tree at call time.
 *
 * @param {string} [root] - project root; used to locate the registry cache.
 * @returns {object[]|null}
 */
export function resolveDecisionRegistryPath(root) {
  // Canonical cached projection path (immutable rule 4 — never hardcode it).
  const canonical = pathsFor(root).decisionRegistry;
  // §22/§33 read-shim (OP-0005 Wave 4): a future layout may co-locate the cache
  // under `decisions/`. Prefer that location when it exists, else fall back to the
  // memory-root cache. Read-only reconcile — the writer still owns the canonical
  // location, so this never moves generated state (updater-safe).
  const nested = canonical.replace(/decision-registry\.json$/, 'decisions/decision-registry.json');
  return existsSync(nested) ? nested : canonical;
}

function loadDecisionRegistry(root) {
  try {
    if (!root) return null;
    const registryPath = resolveDecisionRegistryPath(root);
    if (!existsSync(registryPath)) return null;
    const parsed = JSON.parse(readFileSync(registryPath, 'utf-8').replace(/^﻿/, ''));
    // searchDecisions(registry, need) reads `registry.decisions`; pass the object through.
    return (parsed && Array.isArray(parsed.decisions)) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Builds the human-readable reasons array from the classification result.
 * Each entry is a short string identifying WHY the classifier produced a value.
 *
 * @param {object} classification result from classify()
 * @param {string} tier resolved tier
 * @param {string} domain resolved domain
 * @returns {string[]}
 */
function buildReasons(classification, tier, domain) {
  const reasons = [];

  // Tier reason — identify which rubric signal triggered the tier.
  const rubricSignalHint = inferTierSignalHint(classification);
  reasons.push(`tier=${tier}${rubricSignalHint ? ` (rubric signal: '${rubricSignalHint}')` : ' (default tier)'}`);

  // Domain reason.
  if (domain !== 'general') {
    reasons.push(`domain=${domain} (advisory risk context; recommendedAgents=[${classification.recommendedAgents.join(', ')}])`);
  } else {
    reasons.push('domain=general (no regulated domain signals matched)');
  }

  // ADR reason.
  if (classification.needsAdr) {
    reasons.push('needsAdr=true (tier=architectural requires an ADR before implementation)');
  }

  return reasons;
}

/**
 * Attempts to surface the single rubric signal that drove the tier classification.
 * Because classify() does not expose which specific signal matched, we infer it
 * from the input text so the reason stays informative without re-implementing the
 * rubric match loop.
 *
 * Returns the first matched signal string, or '' when the tier was the default.
 *
 * @param {object} classification classify() result
 * @returns {string}
 */
function inferTierSignalHint(classification) {
  // The input text that was classified is available as classification.input.
  const text = String(classification.input ?? '').toLowerCase();
  if (!text) return '';
  // Map tier → common trigger words that exist in the rubric's embedded fallback.
  const tierHints = {
    architectural: ['refactor', 'migrate', 'migration', 'auth', 'schema', 'breaking', 'rewrite', 'encrypt', 'deprecat', 'add dependency', 'new dependency'],
    feature: ['add', 'feature', 'endpoint', 'component', 'screen', 'page', 'command', 'field', 'report', 'export'],
    trivial: ['typo', 'rename', 'comment', 'bump', 'lint', 'format', 'whitespace', 'docstring', 'fix link'],
  };
  const candidates = tierHints[classification.tier] ?? [];
  return candidates.find((hint) => text.includes(hint)) ?? '';
}
