/**
 * work-classifier.mjs — deterministic, explainable methodology classifiers for
 * the Business-driven methodology (BIZ-0001 / WF-0036 Wave A2, ADR-0102).
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

/**
 * Embedded fallback — byte-equivalent to `policy/work-classification.json` so
 * classification never crashes in a project that seeded nothing (immutable rule
 * 2; mirrors `complexity-rubric.mjs.DEFAULT_RUBRIC`). Frozen to prevent mutation.
 */
export const DEFAULT_WORK_CLASSIFICATION = Object.freeze({
  version: 1,
  nature: {
    default: 'operation',
    margin: 1,
    business: { signals: [
      { s: 'strategy', w: 3 }, { s: 'strategic', w: 3 }, { s: 'initiative', w: 3 },
      { s: 'program', w: 3 }, { s: 'roadmap', w: 2 }, { s: 'portfolio', w: 2 },
      { s: 'capability', w: 2 }, { s: 'platform', w: 2 }, { s: 'north star', w: 3 },
      { s: 'business case', w: 3 }, { s: 'quarter', w: 1 }, { s: 'okr', w: 2 }, { s: 'goal', w: 1 },
      { s: 'compliance', w: 3 }, { s: 'governance', w: 2 }, { s: 'methodology', w: 2 },
    ] },
    operation: { signals: [
      { s: 'fix ', w: 3 }, { s: 'bug', w: 3 }, { s: 'add ', w: 2 }, { s: 'implement', w: 2 },
      { s: 'update ', w: 2 }, { s: 'refactor', w: 2 }, { s: 'ticket', w: 2 }, { s: 'task', w: 1 },
      { s: 'endpoint', w: 1 }, { s: 'rename', w: 2 }, { s: 'migrate', w: 1 },
      { s: 'incident', w: 3 }, { s: 'hotfix', w: 3 }, { s: 'batch', w: 1 },
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
  executionMode: { default: 'direct', precedence: ['workflow', 'batch', 'direct'], modes: {
    workflow: [ { s: 'multi-step', w: 3 }, { s: 'several phases', w: 3 }, { s: 'wave', w: 2 }, { s: 'milestones', w: 2 }, { s: 'across modules', w: 2 }, { s: 'program', w: 2 }, { s: 'epic', w: 2 } ],
    batch: [ { s: 'all ', w: 1 }, { s: 'every ', w: 2 }, { s: 'bulk', w: 3 }, { s: 'across the', w: 2 }, { s: 'each ', w: 1 }, { s: 'sweep', w: 2 }, { s: 'rename all', w: 3 }, { s: 'a few', w: 2 }, { s: 'warnings', w: 1 } ],
    direct: [ { s: 'fix ', w: 1 }, { s: 'one ', w: 1 }, { s: 'single', w: 2 }, { s: 'quick', w: 1 } ],
  } },
  businessMatch: {
    weights: { valueIntent: 3, kind: 2, token: 1 },
    thresholds: { suggested: 0.45, confirmed: 0.75 },
    winnerMargin: 0.1,
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
 * Resolves the Business-vs-Operation nature with the §4.5 margin rule: a near-tie
 * (`|business − operation| < margin`) refuses LOW to `operation` with low
 * confidence — promoting to a Business is a heavier, human-approved act.
 *
 * @param {string} text - lowercased objective.
 * @param {object} natureCfg - the policy `nature` section.
 * @returns {{ value: string, lowConfidence: boolean, reason: string, evidence: object }}
 */
function classifyNature(text, natureCfg) {
  const business = scoreTable(text, { business: natureCfg.business?.signals })[0];
  const operation = scoreTable(text, { operation: natureCfg.operation?.signals })[0];
  const scores = { business: business.score, operation: operation.score };
  const margin = Number.isFinite(natureCfg.margin) ? natureCfg.margin : 1;
  const def = natureCfg.default || 'operation';

  const diff = business.score - operation.score;
  let value;
  let lowConfidence = false;
  let note;
  if (Math.abs(diff) < margin) {
    value = def;
    lowConfidence = true;
    note = `near-tie within margin ${margin} → refuse-low to default '${def}'`;
  } else {
    value = diff > 0 ? 'business' : 'operation';
    note = `business ${business.score} vs operation ${operation.score}`;
  }
  const matched = value === 'business' ? business.matched : operation.matched;
  return {
    value,
    lowConfidence,
    reason: `nature=${value} (${note}; signals: ${matched.map((s) => `'${s}'`).join(', ') || 'none'})`,
    evidence: { winner: value, scores, matched, tieBreak: lowConfidence ? 'margin' : null },
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

  const exec = classifyArgmax(
    text,
    policy.executionMode?.modes || {},
    policy.executionMode?.default || 'direct',
    'executionMode',
    policy.executionMode?.precedence || EXECUTION_MODES,
  );
  let executionMode = EXECUTION_MODES.includes(exec.value) ? exec.value : 'direct';
  // Structural rule (design §12): a Business is an inherently multi-wave entity
  // (growth.md frames every Business as a program of Workflows), so its execution
  // mode floors at `workflow` unless an explicit signal already raised it there.
  if (isBusiness && executionMode !== 'workflow') {
    reasons.push(`executionMode=workflow (business nature floors to workflow; was ${executionMode})`);
    exec.evidence.tieBreak = 'businessFloor';
    exec.evidence.winner = 'workflow';
    executionMode = 'workflow';
  } else {
    reasons.push(exec.reason);
  }

  const confidence = nature.lowConfidence ? 'low' : 'high';

  return {
    nature: nature.value,
    kind,
    valueIntents: { primary: intent.primary, secondary: intent.secondary },
    growthLever: lever.value,
    executionMode,
    confidence,
    reasons,
    evidence: {
      nature: nature.evidence,
      kind: kindRes.evidence,
      valueIntent: intent.evidence,
      growthLever: lever.evidence,
      executionMode: exec.evidence,
    },
  };
}
