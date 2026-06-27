/**
 * Architecture-debt gate — the concentration+fragmentation SYMMETRY detector
 * (WF-0057 W2.4, ADR-0122, PROMPT-SPEC §10/§11/§32). The piece that makes the
 * gate treat BOTH a god-module (over-concentration) AND artificial
 * fragmentation (wrappers/pass-throughs coined to satisfy a number) as debt —
 * never line count alone (§11).
 *
 * WHY a single module for two directions: concentration (§10.1) and
 * fragmentation (§10.2) are one cohesive concern — the *modularity balance* of a
 * surface — read from opposite ends of the same MODULARITY dimension. Splitting
 * them would fracture a genuinely single responsibility (constitution §1) and
 * duplicate the shared §32-evidence gating both sides apply.
 *
 * Pure analyzer: callers INJECT signals (module shape, project-map graph
 * signals); this module performs **no** filesystem walk and emits `Finding[]`
 * via the W0.3 `makeFinding` contract. Both directions are capped at
 * REVIEW_REQUIRED/ADVISORY — they are semantic-ish judgments and NEVER carry a
 * BLOCKING floor (decisions fork #3; §32: a SPLIT/MERGE without the structural
 * evidence stays ADVISORY). A cohesive long file yields KEEP_COHESIVE / OBSERVE
 * (no finding-as-mandatory-work, §11/§27, test §34.1).
 *
 * Zero runtime deps, ESM, `node:`/relative imports only (immutable rule #1).
 *
 * @typedef {import('./finding.mjs')} FindingApi
 */

import {
  makeFinding, Enforcement, FindingStatus, Dimension, DebtClass,
  RecommendedAction, EvidenceClass,
} from './finding.mjs';

/**
 * A SPLIT or MERGE recommendation must carry the §32 structural evidence to rise
 * above ADVISORY. Without it the recommendation stays ADVISORY — never a
 * mandatory action (PROMPT-SPEC §32; spec.md "a recommendation without that
 * evidence stays ADVISORY").
 *
 * SPLIT needs: an independent responsibility that leaves, a new contract for it,
 * and a reason the change won't just bounce the coupling elsewhere.
 * MERGE/REMOVE_WRAPPER needs: a single coherent journey across the units and
 * proof the merge preserves the boundaries the split claimed to protect.
 */
const SPLIT_EVIDENCE_KEYS = Object.freeze([
  'independentResponsibility', 'newContract', 'couplingWontBounce',
]);
const MERGE_EVIDENCE_KEYS = Object.freeze([
  'singleCoherentJourney', 'boundariesPreserved',
]);

/** True iff every required §32 evidence key is explicitly present and truthy. */
const hasEvidence = (evidence, keys) =>
  Boolean(evidence) && keys.every((key) => Boolean(evidence[key]));

/**
 * Enforcement for a structural recommendation: REVIEW_REQUIRED only when the
 * §32 evidence is complete, otherwise ADVISORY. Never BLOCKING — these are
 * modularity judgments, not deterministic floors (decisions fork #3).
 */
const enforcementFor = (evidence, keys) =>
  hasEvidence(evidence, keys) ? Enforcement.REVIEW_REQUIRED : Enforcement.ADVISORY;

/**
 * The terminal-positive verdict for a cohesive unit (§11/§27): a long-but-coherent
 * file is OBSERVE, never a SPLIT, and never blocking. Returned as a single
 * OBSERVATION so the report can show "evaluated, kept" — it creates NO mandatory
 * work (test §34.1).
 *
 * @param {{path:string, lineCount?:number}} moduleSignal
 * @returns {Object} a KEEP_COHESIVE finding (OBSERVE action, OBSERVATION status).
 */
function keepCohesive(moduleSignal) {
  return makeFinding({
    id: `D2.modularity.cohesive:${moduleSignal.path}:file`,
    ruleId: 'D2.modularity.concentration',
    dimension: Dimension.MODULARITY,
    debtClass: DebtClass.CODE,
    status: FindingStatus.OBSERVATION,
    confidence: 0.6,
    evidence: {
      class: EvidenceClass.HEURISTIC,
      source: 'fragmentation-detector',
      ref: moduleSignal.path,
    },
    reasonCodes: ['COHESIVE_SINGLE_RESPONSIBILITY'],
    recommendedAction: RecommendedAction.KEEP_COHESIVE,
    enforcement: Enforcement.ADVISORY,
    message:
      `${moduleSignal.path}: long but cohesive (one responsibility) — keep as-is; `
      + 'line count alone is not a split trigger.',
    path: moduleSignal.path,
  });
}

/**
 * Concentration direction (§10.1). Given a single module's shape, flag a
 * god-module candidate → SPLIT, but only when the module shows MULTIPLE
 * responsibilities AND high fan-out (it is orchestrating *and* doing the work).
 * A long file with ONE responsibility yields KEEP_COHESIVE, proving line count
 * alone never triggers a split (§11, test §34.1).
 *
 * The recommendation rises to REVIEW_REQUIRED only with the §32 split-evidence;
 * absent it the SPLIT stays ADVISORY (never mandatory).
 *
 * @param {Object} moduleSignal              one module's injected shape.
 * @param {string} moduleSignal.path         repo-relative, forward-slash path.
 * @param {number} [moduleSignal.lineCount]  useful-line count (advisory anchor only).
 * @param {number} [moduleSignal.fanOut]     count of distinct modules it imports.
 * @param {string[]} [moduleSignal.responsibilities]  distinct responsibility hints.
 * @param {Object} [moduleSignal.splitEvidence]       §32 evidence (see SPLIT_EVIDENCE_KEYS).
 * @returns {Object[]} zero or one Finding (KEEP_COHESIVE observation or SPLIT candidate).
 */
export function detectConcentration(moduleSignal) {
  if (!moduleSignal || typeof moduleSignal.path !== 'string') {
    throw new TypeError('detectConcentration: moduleSignal needs a string path');
  }
  const responsibilities = Array.isArray(moduleSignal.responsibilities)
    ? moduleSignal.responsibilities
    : [];
  const fanOut = typeof moduleSignal.fanOut === 'number' ? moduleSignal.fanOut : 0;
  const multipleResponsibilities = responsibilities.length >= 2;
  const highFanOut = fanOut >= 12;

  // A god-module is multi-responsibility AND high fan-out — not merely long.
  if (!(multipleResponsibilities && highFanOut)) {
    return [keepCohesive(moduleSignal)];
  }

  const evidence = moduleSignal.splitEvidence;
  const reasonCodes = ['MULTI_RESPONSIBILITY', 'FAN_OUT_GT_THRESHOLD'];
  if (!hasEvidence(evidence, SPLIT_EVIDENCE_KEYS)) reasonCodes.push('SPLIT_EVIDENCE_MISSING');
  return [makeFinding({
    id: `D2.modularity.concentration:${moduleSignal.path}:file`,
    ruleId: 'D2.modularity.concentration',
    dimension: Dimension.MODULARITY,
    debtClass: DebtClass.DESIGN,
    status: FindingStatus.OBSERVATION,
    confidence: hasEvidence(evidence, SPLIT_EVIDENCE_KEYS) ? 0.6 : 0.4,
    evidence: {
      class: EvidenceClass.HEURISTIC,
      source: 'fragmentation-detector',
      ref: moduleSignal.path,
    },
    reasonCodes,
    recommendedAction: RecommendedAction.SPLIT,
    enforcement: enforcementFor(evidence, SPLIT_EVIDENCE_KEYS),
    message:
      `${moduleSignal.path}: ${responsibilities.length} responsibilities + fan-out ${fanOut} `
      + `— god-module candidate (split by responsibility, not by line count).`,
    path: moduleSignal.path,
  })];
}

/**
 * Build a MERGE / REMOVE_WRAPPER finding (the fragmentation result). Shared by
 * the wrapper and pass-through branches so they emit one consistent shape.
 *
 * @param {Object} args
 * @param {string} args.path          the fragmented unit's path.
 * @param {string} args.action        RecommendedAction.MERGE or REMOVE_WRAPPER.
 * @param {string[]} args.reasonCodes machine-stable reason codes.
 * @param {string} args.message       human one-liner.
 * @param {Object} [args.mergeEvidence]  §32 merge-evidence (see MERGE_EVIDENCE_KEYS).
 * @returns {Object} a fragmentation Finding (ADVISORY unless merge-evidence complete).
 */
function fragmentationFinding({ path, action, reasonCodes, message, mergeEvidence }) {
  const codes = hasEvidence(mergeEvidence, MERGE_EVIDENCE_KEYS)
    ? reasonCodes
    : [...reasonCodes, 'MERGE_EVIDENCE_MISSING'];
  return makeFinding({
    id: `D2.modularity.fragmentation:${path}:file`,
    ruleId: 'D2.modularity.fragmentation',
    dimension: Dimension.MODULARITY,
    debtClass: action === RecommendedAction.REMOVE_WRAPPER
      ? DebtClass.DESIGN
      : DebtClass.ARCHITECTURAL,
    status: FindingStatus.OBSERVATION,
    confidence: 0.5,
    evidence: {
      class: EvidenceClass.GRAPH_DERIVED,
      source: 'project-map',
      ref: path,
    },
    reasonCodes: codes,
    recommendedAction: action,
    enforcement: enforcementFor(mergeEvidence, MERGE_EVIDENCE_KEYS),
    message,
    path,
  });
}

/**
 * Fragmentation direction (§10.2). Given the project-map GRAPH signals for one
 * unit, flag ARTIFICIAL fragmentation — a unit coined to satisfy a number rather
 * than to protect a boundary:
 *   - a **one-consumer pass-through wrapper** (single consumer, near-zero own
 *     logic, simply forwarding) → REMOVE_WRAPPER (test §34.7);
 *   - a **pass-through chain** member (one in, one out, no transformation) that
 *     belongs to a co-change cluster → MERGE (test §34.6).
 * Each rises to REVIEW_REQUIRED only with the §32 merge-evidence (single coherent
 * journey, preserved boundaries); absent it the MERGE/REMOVE_WRAPPER stays
 * ADVISORY (never mandatory).
 *
 * @param {Object} graphSignal                 one unit's injected graph signals.
 * @param {string} graphSignal.path            repo-relative, forward-slash path.
 * @param {number} [graphSignal.fanIn]         distinct consumers (1 ⇒ single consumer).
 * @param {number} [graphSignal.fanOut]        distinct dependencies.
 * @param {boolean} [graphSignal.passThrough]  one-in/one-out, forwards without transforming.
 * @param {boolean} [graphSignal.ownLogic]     does it hold any non-forwarding logic?
 * @param {boolean} [graphSignal.coChangeCluster]  always changes with its neighbour(s)?
 * @param {Object} [graphSignal.mergeEvidence] §32 merge-evidence (see MERGE_EVIDENCE_KEYS).
 * @returns {Object[]} zero or one fragmentation Finding (empty when not artificial).
 */
export function detectFragmentation(graphSignal) {
  if (!graphSignal || typeof graphSignal.path !== 'string') {
    throw new TypeError('detectFragmentation: graphSignal needs a string path');
  }
  const fanIn = typeof graphSignal.fanIn === 'number' ? graphSignal.fanIn : 0;
  const passThrough = Boolean(graphSignal.passThrough);
  const hasOwnLogic = graphSignal.ownLogic !== false; // default: assume it does
  const inCluster = Boolean(graphSignal.coChangeCluster);

  // One-consumer pass-through wrapper: a single consumer, no own logic, forwarding.
  if (fanIn <= 1 && passThrough && !hasOwnLogic) {
    return [fragmentationFinding({
      path: graphSignal.path,
      action: RecommendedAction.REMOVE_WRAPPER,
      reasonCodes: ['SINGLE_CONSUMER', 'PASS_THROUGH_NO_OWN_LOGIC'],
      message:
        `${graphSignal.path}: one-consumer pass-through wrapper (no own logic) — `
        + 'inline into its sole consumer unless a boundary justifies it.',
      mergeEvidence: graphSignal.mergeEvidence,
    })];
  }

  // Pass-through chain member inside a co-change cluster: artificial split of one journey.
  if (passThrough && !hasOwnLogic && inCluster) {
    return [fragmentationFinding({
      path: graphSignal.path,
      action: RecommendedAction.MERGE,
      reasonCodes: ['PASS_THROUGH_CHAIN', 'CO_CHANGE_CLUSTER'],
      message:
        `${graphSignal.path}: pass-through link in a co-change cluster — one journey `
        + 'split across files; merge unless each split protects a real boundary.',
      mergeEvidence: graphSignal.mergeEvidence,
    })];
  }

  return []; // not artificially fragmented — no finding, no work
}

/**
 * The symmetric entry point (§10): run BOTH directions over the injected signals
 * so the gate evaluates concentration AND fragmentation in one pass (test §34.19
 * — both directions evaluated). Pure: no FS, no I/O.
 *
 * @param {Object} signals
 * @param {Object[]} [signals.modules]  module shapes for the concentration pass.
 * @param {Object[]} [signals.graph]    graph signals for the fragmentation pass.
 * @returns {Object[]} the merged Finding[] from both directions.
 */
export function analyzeModularityBalance(signals) {
  const modules = Array.isArray(signals && signals.modules) ? signals.modules : [];
  const graph = Array.isArray(signals && signals.graph) ? signals.graph : [];
  return [
    ...modules.flatMap((moduleSignal) => detectConcentration(moduleSignal)),
    ...graph.flatMap((graphSignal) => detectFragmentation(graphSignal)),
  ];
}
