/**
 * task-intake.mjs — Task request → deterministic signals (CDK-021, ADR-0072).
 *
 * Turns a raw task request into a typed, canonical `signals` object by running the
 * request's objective through the deterministic complexity rubric classifier.
 * No LLM, no Math.random — same input always produces the same output.
 *
 * Consumers: execution-contract.mjs, slash commands, the pre-write governance gate.
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
  if (!request || typeof request !== 'object') {
    throw new TypeError('intake: request must be a non-null object');
  }

  const objective = String(request.objective ?? '').trim();
  const rubric = loadRubric(env.root);
  const classification = classify(objective, rubric);

  const tier = classification.tier;
  const domain = classification.domain;
  const needsAdr = classification.needsAdr;
  const level = request.level ?? env.level ?? 7;

  // Build the reasons array — records the rationale for each key decision.
  const reasons = buildReasons(classification, tier, domain);

  const signals = {
    taskId: request.taskId ?? null,
    sessionId: request.sessionId ?? null,
    branch: request.branch ?? null,
    host: request.host ?? null,
    tier,
    domain,
    needsAdr,
    paths: Array.isArray(request.paths) ? request.paths : [],
    phase: request.phase ?? '*',
    level,
  };

  // ADDITIVE (A2, BIZ-0001/WF-0036, ADR-0102): attach the deterministic
  // methodology classification under a NEW namespace. The legacy tier keys above
  // are untouched — `signals.work` is a pure superset, so existing consumers
  // (execution-contract.mjs, the gate) are unaffected (design §6.1).
  signals.work = classifyWork(objective, loadWorkPolicy(env.root));

  // ADDITIVE (B2, BIZ-0001/WF-0037, ADR-0102): enrich with decision-need
  // classification + registry match. Wrapped in try/catch — fail-open always.
  // The decision registry is loaded ONCE from the generated/cached file; we never
  // rebuild it by scanning the tree on the hot path (frozen interface contract §4).
  // `_searchDecisions` is B2-T2's export resolved at module init; null until B2-T2
  // ships (parallel wave) — this block degrades silently in that case.
  try {
    const registry = loadDecisionRegistry(env.root);
    const needInput = { signals: { ...signals, objective }, decisionRegistry: registry, platformRoot: env.root };
    signals.decisionNeed = classifyDecisionNeed(needInput);

    if (typeof _searchDecisions === 'function' && registry) {
      signals.decisionMatch = _searchDecisions(registry, signals.decisionNeed);
    }
  } catch {
    // B2 enrichment is advisory — never break the existing intake contract.
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
  if (classification.forcedByDomain) {
    reasons.push(
      `tier=${tier} (forced by regulated domain '${domain}' — complexity=high overrides rubric signal)`,
    );
  } else {
    reasons.push(`tier=${tier}${rubricSignalHint ? ` (rubric signal: '${rubricSignalHint}')` : ' (default tier)'}`);
  }

  // Domain reason.
  if (domain !== 'general') {
    reasons.push(`domain=${domain} (regulated domain detected; requiredAgents=[${classification.requiredAgents.join(', ')}])`);
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
