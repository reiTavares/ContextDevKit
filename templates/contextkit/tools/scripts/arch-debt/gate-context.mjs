/**
 * Architecture-debt gate — the GateContext builder (WF-0057 W4, ADR-0122).
 *
 * The composition root (`architecture-debt-gate.mjs`) stays thin by pushing all
 * the "turn a repo tree into the analyzers' injected inputs" plumbing here. This
 * module owns ONE responsibility: assemble the single `context` object every
 * registered fitness function reads (`fitness-catalogue.mjs`). It does NOT decide
 * a verdict — that is the policy engine's job.
 *
 * The fitness catalogue's `evaluate(ctx)` functions read these exact keys:
 *   - `ctx.conformance`         → `evaluateConformance` input (F1/F2/F3).
 *   - `ctx.floors.{changedFiles, reliability, changedBehaviors, impactedTests}` → floors.
 *   - `ctx.lineSignals`         → the ADVISORY line-count Finding[] (collector).
 *   - `ctx.cognitiveCoherence`  → OBSERVE_ONLY model-graded Finding[] (none at W4).
 *   - `ctx.changeAmplification` → OBSERVE_ONLY blast-radius Finding[] (collector).
 *
 * REUSE-FIRST (decisions.md Fork-1, §15): the module/graph model comes from
 * `scanProject` (project-map-core) and `computeInsights` — no second graph, no
 * duplicated tree walk. The changed-set git reader is INJECTED so the builder
 * stays pure/testable; in production the engine injects a real `git diff` reader.
 *
 * FAIL-CLOSED (§16, test §34.22): when the baseline is absent the conformance
 * floors degrade to UNKNOWN (never PASS) — the evaluator owns that, this builder
 * just passes the (possibly null) baseline through honestly. A degraded git
 * reader yields an EMPTY changed-set; the engine's ratchet then scopes nothing,
 * surfacing all in-scope findings rather than silently clearing them.
 *
 * Zero runtime deps, ESM, `node:`/relative imports only (immutable rule #1).
 */

import { collectStructuralSignals, DEFAULT_LINE_BANDS } from './signal-collector.mjs';

/** Normalise a path list (array | Set | undefined) into forward-slash strings. */
function normChanged(changedPaths) {
  const items = changedPaths instanceof Set
    ? [...changedPaths]
    : Array.isArray(changedPaths) ? changedPaths : [];
  return items
    .filter((p) => typeof p === 'string' && p.length > 0)
    .map((p) => p.replaceAll('\\', '/'));
}

/**
 * Resolve the changed-set from an injected reader, fail-closed to an EMPTY set.
 * An empty changed-set means "scope nothing" downstream — the ratchet then keeps
 * every in-scope finding rather than clearing unrelated legacy debt to a false
 * PASS (constitution §8: degrade refused-to-false-positive, never to a false
 * negative). A reader that throws is swallowed defensively (immutable rule #2).
 *
 * @param {(() => (string[]|null))|undefined} readChangedFiles  injected git reader.
 * @returns {{ changedSet: string[], available: boolean }}
 */
export function resolveChangedSet(readChangedFiles) {
  if (typeof readChangedFiles !== 'function') {
    return { changedSet: [], available: false };
  }
  let raw;
  try {
    raw = readChangedFiles();
  } catch {
    return { changedSet: [], available: false };
  }
  if (!Array.isArray(raw)) return { changedSet: [], available: false };
  return { changedSet: normChanged(raw), available: true };
}

/**
 * Per-file size metrics for the line-count collector, derived from the model.
 * The project-map model carries per-module `files`/`bytes`, not per-file lines,
 * so the size signal is driven from explicit `fileMetrics` when the caller has
 * them (the engine reads them via the tech-debt walk); absent that, no size
 * signal is emitted (a missing measure is never faked to zero, §16).
 *
 * @param {Array<{path:string, lines:number, line?:number}>} [fileMetrics]
 * @returns {Array<{path:string, lines:number, line?:number}>}
 */
function sizeMetrics(fileMetrics) {
  return Array.isArray(fileMetrics) ? fileMetrics.filter(Boolean) : [];
}

/**
 * Build the single `context` object the fitness registry runs against. Pure
 * given its inputs: the caller injects the structural `model` (from `scanProject`),
 * the `insights` (from `computeInsights`), the optional `baseline`, the resolved
 * `changedSet`, the per-file `fileMetrics`, and the optional config slices
 * (layerRules/ownership/writeAuthorities/floors). Analyzers lacking their config
 * degrade to SKIPPED/UNKNOWN inside their own evaluators — never here, never to
 * a silent PASS.
 *
 * @param {Object} input
 * @param {Object} input.insights      output of `computeInsights(model.modules)`.
 * @param {Array}  input.modules       the project-map model modules (edge model).
 * @param {Object|null} [input.baseline]  pre-change graph baseline (null ⇒ floors UNKNOWN).
 * @param {string[]} [input.changedSet]  changed file paths (empty ⇒ scope nothing).
 * @param {Array<{path:string,lines:number,line?:number}>} [input.fileMetrics] per-file sizes.
 * @param {Object} [input.config]      optional config slices for the analyzers:
 *   `{ layerRules?, ownership?, writeAuthorities?, reliability?, changedBehaviors?,
 *      impactedTests?, securityChangedFiles?, lineBands? }`.
 * @returns {Object} the injected `context` for `runFitness`.
 */
export function buildGateContext(input = {}) {
  const {
    insights, modules, baseline, changedSet, fileMetrics, config,
  } = input;
  const cfg = config && typeof config === 'object' ? config : {};
  const changedModules = normChanged(changedSet);

  // Structural signals (line-count ADVISORY + change-amplification OBSERVE_ONLY).
  const structuralFindings = collectStructuralSignals({
    fileMetrics: sizeMetrics(fileMetrics),
    changedModules,
    // before/after blast-radius maps are not available without a baseline graph;
    // absent → the collector emits UNKNOWN amplification (never a faked zero).
    signals: cfg.amplificationSignals || {},
    lineBands: cfg.lineBands || DEFAULT_LINE_BANDS,
  });
  const lineSignals = structuralFindings.filter((f) => f.ruleId === 'arch-debt.line-count');
  const changeAmplification = structuralFindings
    .filter((f) => f.ruleId === 'arch-debt.change-amplification');

  return {
    // F1/F2/F3 — the conformance floor input (baseline-relative; null ⇒ UNKNOWN).
    conformance: {
      insights: insights || null,
      modules: Array.isArray(modules) ? modules : [],
      baseline: baseline || null,
      layerRules: cfg.layerRules,
      ownership: cfg.ownership,
      writeAuthorities: cfg.writeAuthorities,
    },
    // Security / reliability / testability floors (all OPTIONAL config; the floor
    // evaluators emit nothing when their evidence is absent, never a PASS claim).
    floors: {
      changedFiles: cfg.securityChangedFiles || [],
      reliability: cfg.reliability || {},
      changedBehaviors: cfg.changedBehaviors || [],
      impactedTests: cfg.impactedTests,
    },
    lineSignals,
    cognitiveCoherence: cfg.cognitiveCoherence || [], // model-graded; none wired at W4.
    changeAmplification,
  };
}
