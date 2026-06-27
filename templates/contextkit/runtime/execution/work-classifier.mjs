/**
 * work-classifier.mjs — deterministic, explainable methodology classifiers for
 * the Business-driven methodology (BIZ-0001 / WF-0036 Wave A2, ADR-0102).
 * §17 nature + §18 execution-mode extracted to work-classify-nature.mjs (OP-0005 / ADR-0125).
 *
 * Six pure classifiers over `policy/work-classification.json`:
 *   nature (business|operation) · businessKind · operationKind ·
 *   valueIntent (primary + secondary) · growthLever · executionMode.
 *
 * ADDITIVE to the tier rubric: this module COMPOSES `complexity-rubric.mjs`
 * (importing `classify`/`loadRubric`) and NEVER mutates it. The tier verdict is
 * the single source of truth for tier/domain/ceremony; A2 attaches its result
 * under a NEW `signals.work` namespace, leaving every legacy key byte-identical.
 *
 * Deterministic by construction: integer substring scoring, stable tie-breaks,
 * no `Math.random`, no time, no LLM. Same input → same output, always.
 *
 * Zero runtime dependencies (immutable rule 1): only `node:fs`, the canonical
 * path helper, the shared enums, and the local scoring primitives.
 */
import { existsSync, readFileSync } from 'node:fs';
import { pathsFor } from '../config/paths.mjs';
import { VALUE_INTENTS, EXECUTION_MODES } from '../work/enums.mjs';
import { classify, loadRubric } from '../../tools/scripts/complexity-rubric.mjs';
import { scoreTable, pickWinner, pickSecondary } from './work-classify-signals.mjs';
import { classifyNature, classifyExecutionMode } from './work-classify-nature.mjs';

/**
 * Embedded fallback — byte-equivalent to `policy/work-classification.json` so
 * classification never crashes in a project that seeded nothing (immutable rule
 * 2; mirrors `complexity-rubric.mjs.DEFAULT_RUBRIC`). Frozen to prevent mutation.
 */
export const DEFAULT_WORK_CLASSIFICATION = Object.freeze({
  version: 1,
  nature: {
    default: 'operation',
    businessFloor: 8,
    businessMargin: 3,
    operationFloor: 6,
    confidenceFloor: 0.70,
    business: { signals: [
      { s: 'new product', w: 6 }, { s: 'new market', w: 6 }, { s: 'new segment', w: 6 },
      { s: 'new audience', w: 6 }, { s: 'pivot', w: 6 }, { s: 'business-model change', w: 6 },
      { s: 'durable strategic capability', w: 4 },
      { s: 'independent kpi', w: 3 }, { s: 'mission outcome', w: 3 },
      { s: 'multiple workflows', w: 3 }, { s: 'cross-product', w: 3 }, { s: 'cross-team', w: 3 },
      { s: 'independent sponsor', w: 2 }, { s: 'budget', w: 2 }, { s: 'multi-month', w: 2 },
      { s: 'multi-year', w: 2 }, { s: 'portfolio', w: 2 }, { s: 'roadmap decision', w: 2 },
      { s: 'separate outcome review', w: 2 },
    ] },
    operation: { signals: [
      { s: 'bug', w: 6 }, { s: 'incident', w: 6 }, { s: 'error', w: 6 }, { s: 'outage', w: 6 },
      { s: 'hotfix', w: 6 }, { s: 'production recovery', w: 6 },
      { s: 'chore', w: 4 }, { s: 'maintenance', w: 4 }, { s: 'dependency', w: 4 },
      { s: 'support', w: 4 }, { s: 'localized refactor', w: 4 }, { s: 'localized performance', w: 4 },
      { s: 'restore', w: 3 }, { s: 'fix', w: 3 }, { s: 'recover', w: 3 }, { s: 'repair', w: 3 },
      { s: 'operational urgency', w: 3 }, { s: 'severity', w: 3 },
      { s: 'existing bounded capability', w: 2 }, { s: 'batch of corrections', w: 2 },
      { s: 'existing business explains value', w: 2 },
    ] },
  },
  businessKind: { default: 'capability', kinds: {
    capability: [ { s: 'platform', w: 2 }, { s: 'capability', w: 3 }, { s: 'engine', w: 1 }, { s: 'framework', w: 1 } ],
    product: [ { s: 'product', w: 3 }, { s: 'feature set', w: 2 }, { s: 'offering', w: 2 }, { s: 'launch', w: 1 } ],
    initiative: [ { s: 'initiative', w: 3 }, { s: 'program', w: 2 }, { s: 'migration program', w: 2 }, { s: 'rollout', w: 1 } ],
    compliance: [ { s: 'compliance', w: 3 }, { s: 'lgpd', w: 2 }, { s: 'audit', w: 2 }, { s: 'regulatory', w: 2 } ],
  } },
  operationKind: { default: 'change', kinds: {
    change: [ { s: 'add ', w: 2 }, { s: 'implement', w: 2 }, { s: 'feature', w: 2 }, { s: 'endpoint', w: 1 }, { s: 'component', w: 1 } ],
    fix: [ { s: 'fix ', w: 3 }, { s: 'bug', w: 3 }, { s: 'broken', w: 2 }, { s: 'regression', w: 2 }, { s: 'hotfix', w: 3 } ],
    maintenance: [ { s: 'refactor', w: 2 }, { s: 'rename', w: 2 }, { s: 'bump', w: 2 }, { s: 'cleanup', w: 2 }, { s: 'lint', w: 1 }, { s: 'tidy', w: 1 } ],
    investigation: [ { s: 'investigate', w: 3 }, { s: 'diagnose', w: 3 }, { s: 'root cause', w: 3 }, { s: 'why ', w: 1 }, { s: 'audit', w: 1 } ],
    operationalresponse: [ { s: 'incident', w: 3 }, { s: 'outage', w: 3 }, { s: 'rollback', w: 2 }, { s: 'restore', w: 2 }, { s: 'recover', w: 2 } ],
  } },
  valueIntent: { default: 'IMPROVE', secondaryMargin: 2, intents: {
    CREATE: [ { s: 'new ', w: 2 }, { s: 'build', w: 2 }, { s: 'create', w: 3 }, { s: 'add ', w: 1 }, { s: 'launch', w: 2 } ],
    PROTECT: [ { s: 'secure', w: 3 }, { s: 'harden', w: 3 }, { s: 'protect', w: 3 }, { s: 'prevent', w: 2 }, { s: 'vulnerab', w: 2 } ],
    RECOVER: [ { s: 'fix ', w: 2 }, { s: 'restore', w: 3 }, { s: 'recover', w: 3 }, { s: 'rollback', w: 2 }, { s: 'incident', w: 2 }, { s: 'outage', w: 2 } ],
    ENABLE: [ { s: 'enable', w: 3 }, { s: 'unblock', w: 2 }, { s: 'foundation', w: 2 }, { s: 'infrastructure', w: 2 }, { s: 'platform', w: 2 }, { s: 'seam', w: 1 }, { s: 'capability', w: 3 }, { s: 'strategic', w: 2 }, { s: 'initiative', w: 2 } ],
    IMPROVE: [ { s: 'improve', w: 3 }, { s: 'optimi', w: 2 }, { s: 'faster', w: 2 }, { s: 'refactor', w: 2 }, { s: 'polish', w: 1 }, { s: 'reduce', w: 1 } ],
    LEARN: [ { s: 'investigate', w: 3 }, { s: 'research', w: 3 }, { s: 'spike', w: 2 }, { s: 'explore', w: 2 }, { s: 'diagnose', w: 2 }, { s: 'measure', w: 1 } ],
    COMPLY: [ { s: 'lgpd', w: 3 }, { s: 'compliance', w: 3 }, { s: 'consent', w: 2 }, { s: 'audit', w: 2 }, { s: 'regulatory', w: 3 }, { s: 'pii', w: 2 } ],
    SERVE_MISSION: [ { s: 'mission', w: 3 }, { s: 'open source', w: 2 }, { s: 'community', w: 2 }, { s: 'accessib', w: 2 } ],
  } },
  growthLever: { default: null, levers: {
    STRATEGIC_ENABLEMENT: [ { s: 'platform', w: 2 }, { s: 'enable', w: 2 }, { s: 'forecast', w: 2 }, { s: 'portfolio', w: 3 }, { s: 'foundation', w: 2 }, { s: 'capability', w: 2 } ],
    OPERATIONAL_EFFICIENCY: [ { s: 'ceremony', w: 3 }, { s: 'automate', w: 2 }, { s: 'faster', w: 2 }, { s: 'batch', w: 2 }, { s: 'workflow', w: 1 }, { s: 'reduce friction', w: 3 }, { s: 'export', w: 2 }, { s: 'endpoint', w: 1 }, { s: 'report', w: 1 } ],
    QUALITY: [ { s: 'test', w: 2 }, { s: 'validate', w: 2 }, { s: 'coverage', w: 2 }, { s: 'correct', w: 2 }, { s: 'review', w: 1 }, { s: 'lint', w: 1 }, { s: 'harden', w: 2 }, { s: 'self-approve', w: 2 }, { s: 'recorded', w: 1 } ],
    COST_EFFICIENCY: [ { s: 'cost', w: 3 }, { s: 'token', w: 2 }, { s: 'quota', w: 2 }, { s: 'budget', w: 2 }, { s: 'cache', w: 1 } ],
    RELIABILITY: [ { s: 'idempotent', w: 2 }, { s: 'deterministic', w: 2 }, { s: 'rebuild', w: 2 }, { s: 'stable', w: 1 }, { s: 'registry', w: 1 }, { s: 'regression', w: 2 }, { s: 'rollback', w: 2 }, { s: 'updater', w: 2 }, { s: 'guard', w: 2 }, { s: 'worktree', w: 1 }, { s: 'across the repo', w: 2 } ],
  } },
  executionMode: {
    default: 'direct',
    bands: { direct: [0, 3], batch: [4, 7], workflowFloor: 8 },
    points: {
      cohesiveReversible: 0, upTo3TasksOneComponent: 1, fourTo12RelatedTasks: 3,
      multipleModules: 2, multipleSessionsLikely: 2, dependenciesBetweenGroups: 2,
      multipleAgents: 2, highRiskBlastRadius: 3, publicContractCompatImpact: 3,
      architectureChange: 4, adrRequired: 4, dataMigration: 4, rolloutRollback: 4, multipleTeams: 4,
    },
    hardWorkflowTriggers: [
      'adr-required', 'data-migration', 'rollout-rollback', 'cross-cutting-architecture',
      'multiple-waves', 'critical-compliance', 'multiple-teams', 'breakable-public-contract',
      'complex-multi-agent-coordination', 'business-nature',
    ],
    modes: {
      workflow: [ { s: 'multi-step', w: 3 }, { s: 'several phases', w: 3 }, { s: 'wave', w: 2 }, { s: 'milestones', w: 2 }, { s: 'across modules', w: 2 }, { s: 'program', w: 2 }, { s: 'epic', w: 2 } ],
      batch: [ { s: 'all ', w: 1 }, { s: 'every ', w: 2 }, { s: 'bulk', w: 3 }, { s: 'across the', w: 2 }, { s: 'each ', w: 1 }, { s: 'sweep', w: 2 }, { s: 'rename all', w: 3 }, { s: 'a few', w: 2 }, { s: 'warnings', w: 1 } ],
      direct: [ { s: 'fix ', w: 1 }, { s: 'one ', w: 1 }, { s: 'single', w: 2 }, { s: 'quick', w: 1 } ],
    },
    precedence: ['workflow', 'batch', 'direct'],
  },
  businessMatch: {
    thresholds: { suggested: 75, confirm: 55 },
    nearTieMargin: 10,
    points: {
      explicitIdMatch: 100, sameProduct: 35, sameAreaCapability: 20,
      compatibleValueIntents: 15, sameRoadmapItem: 10, relatedOutcomeKpi: 10,
      tokenOverlap: 10, activeBusiness: 5, incompatibleProduct: -30, closedRejected: -100,
    },
    kindAffinity: {
      fix: ['capability', 'product'], change: ['capability', 'product'],
      maintenance: ['capability'], investigation: ['capability', 'compliance'],
      operationalresponse: ['capability', 'product'],
    },
  },
});

/** JSON keys are lowercase; canonical Operation-kind output is camelCase. */
const OPERATION_KIND_CANONICAL = Object.freeze({ operationalresponse: 'operationalResponse' });

/**
 * Loads the work-classification policy for `root`, falling back to the embedded
 * `DEFAULT_WORK_CLASSIFICATION` on any failure (missing/malformed). Never throws
 * (immutable rule 2; mirrors `loadRubric`). Resolves the path via
 * `pathsFor(root).workClassification` — never hardcodes the platform folder.
 *
 * @param {string} [root] - project root (default cwd).
 * @returns {object} a usable policy object (file or embedded fallback).
 */
export function loadWorkPolicy(root = process.cwd()) {
  const path = pathsFor(root).workClassification;
  if (!existsSync(path)) return structuredClone(DEFAULT_WORK_CLASSIFICATION);
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8').replace(/^﻿/, ''));
    return parsed && parsed.nature && parsed.valueIntent ? parsed : structuredClone(DEFAULT_WORK_CLASSIFICATION);
  } catch {
    return structuredClone(DEFAULT_WORK_CLASSIFICATION);
  }
}

/**
 * Classifies a single argmax category and records its reason/evidence.
 *
 * @param {string} text - lowercased objective.
 * @param {Record<string, Array>} table - `{ name → signals[] }`.
 * @param {string|null} fallback - value when nothing scores (default/null).
 * @param {string} label - reason label (e.g. `kind`, `growthLever`).
 * @param {string[]} [precedence] - optional precedence order for the tie-break.
 * @returns {{ value: string|null, reason: string, evidence: object }}
 */
function classifyArgmax(text, table, fallback, label, precedence = []) {
  const scored = scoreTable(text, table);
  const pick = pickWinner(scored, precedence);
  const scores = Object.fromEntries(scored.map((entry) => [entry.name, entry.score]));
  if (!pick) {
    return {
      value: fallback,
      reason: `${label}=${fallback === null ? 'none' : fallback} (no signal matched — default)`,
      evidence: { winner: fallback, scores, matched: [], tieBreak: 'default' },
    };
  }
  const { winner, tieBreak } = pick;
  const tieNote = tieBreak ? `; tie-break: ${tieBreak}` : '';
  return {
    value: winner.name,
    reason: `${label}=${winner.name} (score ${winner.score}; signals: ${winner.matched.map((s) => `'${s}'`).join(', ')}${tieNote})`,
    evidence: { winner: winner.name, scores, matched: winner.matched, tieBreak },
  };
}

/**
 * Classifies the value-intent: a primary argmax plus secondary intents within
 * `secondaryMargin` (design §4.6). Validates the result against the imported
 * `VALUE_INTENTS` enum (never forks it).
 *
 * @param {string} text - lowercased objective.
 * @param {object} intentCfg - the policy `valueIntent` section.
 * @returns {{ primary: string, secondary: string[], reasons: string[], evidence: object }}
 */
function classifyValueIntent(text, intentCfg) {
  const scored = scoreTable(text, intentCfg.intents);
  const pick = pickWinner(scored);
  const scores = Object.fromEntries(scored.map((entry) => [entry.name, entry.score]));
  const def = intentCfg.default || 'IMPROVE';
  const primary = pick && VALUE_INTENTS.includes(pick.winner.name) ? pick.winner.name : def;
  const margin = Number.isFinite(intentCfg.secondaryMargin) ? intentCfg.secondaryMargin : 2;
  const secondary = pick
    ? pickSecondary(scored, primary, margin).filter((name) => VALUE_INTENTS.includes(name))
    : [];
  const reasons = [
    pick
      ? `valueIntent.primary=${primary} (score ${scores[primary] ?? 0}; signals: ${pick.winner.matched.map((s) => `'${s}'`).join(', ')})`
      : `valueIntent.primary=${primary} (no signal — default)`,
  ];
  if (secondary.length) {
    reasons.push(`valueIntent.secondary=[${secondary.join(', ')}] (within margin ${margin} of primary)`);
  }
  return { primary, secondary, reasons, evidence: { primary, secondary, scores } };
}

/**
 * Runs all six classifiers over `objective` and returns the canonical
 * `signals.work` payload (design §5): nature, kind, valueIntents, growthLever,
 * executionMode, confidence, plus a flat `reasons[]` and a structured `evidence`
 * mirror. Pure and deterministic for a given `(objective, policy)`.
 *
 * @param {string} objective - the natural-language work request.
 * @param {object} [policy] - loaded policy (defaults to the embedded fallback).
 * @returns {object} the `signals.work` classification result.
 */
export function classifyWork(objective, policy = DEFAULT_WORK_CLASSIFICATION) {
  try {
    const text = String(objective || '').toLowerCase();
    const reasons = [];

    const nature = classifyNature(text, policy.nature || {});
    reasons.push(nature.reason);

    const isBusiness = nature.value === 'business';
    const kindCfg = isBusiness ? policy.businessKind : policy.operationKind;
    const kindRes = classifyArgmax(text, kindCfg?.kinds || {}, kindCfg?.default ?? null, 'kind');
    const kind = OPERATION_KIND_CANONICAL[kindRes.value] || kindRes.value;
    reasons.push(kindRes.reason);

    const intent = classifyValueIntent(text, policy.valueIntent || {});
    reasons.push(...intent.reasons);

    const lever = classifyArgmax(text, policy.growthLever?.levers || {}, policy.growthLever?.default ?? null, 'growthLever');
    reasons.push(lever.reason);

    const exec = classifyExecutionMode(text, policy.executionMode || {}, isBusiness);
    const executionMode = EXECUTION_MODES.includes(exec.value) ? exec.value : 'direct';
    reasons.push(exec.reason);

    // Confidence: 'ask' | 'low' | 'high' — propagated from classifyNature.
    const confidence = nature.confidence;

    return {
      nature: nature.value,
      kind,
      valueIntents: { primary: intent.primary, secondary: intent.secondary },
      growthLever: lever.value,
      executionMode,
      confidence,
      needsClarification: nature.needsClarification,
      clarifyQuestion: nature.clarifyQuestion,
      reasons,
      evidence: {
        nature: nature.evidence,
        kind: kindRes.evidence,
        valueIntent: intent.evidence,
        growthLever: lever.evidence,
        executionMode: exec.evidence,
      },
    };
  } catch {
    return {
      nature: 'operation',
      kind: null,
      valueIntents: { primary: 'IMPROVE', secondary: [] },
      growthLever: null,
      executionMode: 'direct',
      confidence: 'low',
      needsClarification: false,
      clarifyQuestion: null,
      reasons: ['classifyWork error — fail-open defaults'],
      evidence: {},
    };
  }
}
