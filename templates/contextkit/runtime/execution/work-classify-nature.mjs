/**
 * work-classify-nature.mjs — §17 nature (Business vs Operation) and §18 execution-mode
 * classifiers, extracted from work-classifier.mjs for the 280-line budget (OP-0005 / ADR-0125).
 *
 * Cohesion note: these two classifiers share the same "scoring from text signals → threshold verdict"
 * pattern and are always called together by classifyWork — extracted as one unit intentionally.
 *
 * Zero runtime dependencies — plain functions over `node:*`-free data.
 */

// ── §17 Nature signal tables (TABLE 1, OP-0005) ─────────────────────────────
// Business signals: exact substring matches (multi-word phrases require exact text).
const BUSINESS_SIGNALS = [
  { s: 'new product', w: 6 }, { s: 'new market', w: 6 }, { s: 'new segment', w: 6 },
  { s: 'new audience', w: 6 }, { s: 'pivot', w: 6 }, { s: 'business-model change', w: 6 },
  { s: 'durable strategic capability', w: 4 },
  { s: 'independent kpi', w: 3 }, { s: 'mission outcome', w: 3 },
  { s: 'multiple workflows', w: 3 }, { s: 'cross-product', w: 3 }, { s: 'cross-team', w: 3 },
  { s: 'independent sponsor', w: 2 }, { s: 'budget', w: 2 }, { s: 'multi-month', w: 2 },
  { s: 'multi-year', w: 2 }, { s: 'portfolio', w: 2 }, { s: 'roadmap decision', w: 2 },
  { s: 'separate outcome review', w: 2 },
];

// Operation signals: exact substring matches.
const OPERATION_SIGNALS = [
  { s: 'bug', w: 6 }, { s: 'incident', w: 6 }, { s: 'error', w: 6 }, { s: 'outage', w: 6 },
  { s: 'hotfix', w: 6 }, { s: 'production recovery', w: 6 },
  { s: 'chore', w: 4 }, { s: 'maintenance', w: 4 }, { s: 'dependency', w: 4 },
  { s: 'support', w: 4 }, { s: 'localized refactor', w: 4 }, { s: 'localized performance', w: 4 },
  { s: 'restore', w: 3 }, { s: 'fix', w: 3 }, { s: 'recover', w: 3 }, { s: 'repair', w: 3 },
  { s: 'operational urgency', w: 3 }, { s: 'severity', w: 3 },
  { s: 'existing bounded capability', w: 2 }, { s: 'batch of corrections', w: 2 },
  { s: 'existing business explains value', w: 2 },
];

/**
 * Scores one signal list against lowercased text.
 * @param {string} text
 * @param {Array<{s:string,w:number}>} signals
 * @returns {{ score: number, matched: string[] }}
 */
function scoreSignals(text, signals) {
  let score = 0;
  const matched = [];
  for (const row of signals) {
    if (typeof row.s === 'string' && text.includes(row.s)) {
      score += Number.isFinite(row.w) ? row.w : 0;
      matched.push(row.s);
    }
  }
  return { score, matched };
}

/**
 * Resolves Business-vs-Operation nature using the §17 OP-0005 algorithm:
 *   B >= 8 AND B >= O + 3  → BUSINESS / high
 *   O >= 6 AND O >= B      → OPERATION / high
 *   |B-O| < 3 OR conf < 0.70 → ASK (value='operation', confidence='ask', needsClarification=true)
 *   else                   → OPERATION / low
 *
 * @param {string} text - lowercased objective.
 * @param {object} natureCfg - the policy `nature` section (for custom signals; falls back to defaults).
 * @returns {{ value: string, confidence: 'ask'|'low'|'high', needsClarification: boolean, clarifyQuestion: string|null, reason: string, evidence: object }}
 */
export function classifyNature(text, natureCfg) {
  const bizSignals = Array.isArray(natureCfg?.business?.signals) ? natureCfg.business.signals : BUSINESS_SIGNALS;
  const opSignals = Array.isArray(natureCfg?.operation?.signals) ? natureCfg.operation.signals : OPERATION_SIGNALS;

  const bizResult = scoreSignals(text, bizSignals);
  const opResult = scoreSignals(text, opSignals);
  const B = bizResult.score;
  const O = opResult.score;
  const topScore = Math.max(B, O);
  const computedConf = Math.min(1, topScore / 8);

  const CLARIFY_Q = 'Is the primary objective to create or change a durable strategic capability (Business), or to fix, maintain or execute work within something that already exists (Operation)?';

  let value, confidence, needsClarification, clarifyQuestion, reason, evidenceMatched;

  if (B >= 8 && B >= O + 3) {
    value = 'business';
    confidence = 'high';
    needsClarification = false;
    clarifyQuestion = null;
    evidenceMatched = bizResult.matched;
    reason = `nature=business (B=${B} >= 8 and B >= O+3=${O + 3}; signals: ${bizResult.matched.map((s) => `'${s}'`).join(', ') || 'none'})`;
  } else if (O >= 6 && O >= B) {
    value = 'operation';
    confidence = 'high';
    needsClarification = false;
    clarifyQuestion = null;
    evidenceMatched = opResult.matched;
    reason = `nature=operation (O=${O} >= 6 and O >= B=${B}; signals: ${opResult.matched.map((s) => `'${s}'`).join(', ') || 'none'})`;
  } else if (Math.abs(B - O) < 3 || computedConf < 0.70) {
    value = 'operation';
    confidence = 'ask';
    needsClarification = true;
    clarifyQuestion = CLARIFY_Q;
    evidenceMatched = topScore === B ? bizResult.matched : opResult.matched;
    reason = `nature=operation (ASK — B=${B}, O=${O}, conf=${computedConf.toFixed(2)} below threshold; defaulting to operation)`;
  } else {
    value = 'operation';
    confidence = 'low';
    needsClarification = false;
    clarifyQuestion = null;
    evidenceMatched = opResult.matched;
    reason = `nature=operation (B=${B}, O=${O}; low-confidence operation default)`;
  }

  return {
    value,
    confidence,
    needsClarification,
    clarifyQuestion,
    reason,
    evidence: {
      winner: value,
      scores: { business: B, operation: O },
      matched: evidenceMatched,
      confidence: computedConf,
    },
  };
}

// ── §18 Execution-mode ceremony points (TABLE 2, OP-0005) ───────────────────

/** Hard workflow triggers: any of these in the triggered set forces 'workflow'. */
const HARD_WORKFLOW_TRIGGERS = new Set([
  'adr-required', 'data-migration', 'rollout-rollback', 'cross-cutting-architecture',
  'multiple-waves', 'critical-compliance', 'multiple-teams', 'breakable-public-contract',
  'complex-multi-agent-coordination', 'business-nature',
]);

/**
 * Computes ceremony points + triggered hard triggers from the objective text.
 *
 * @param {string} text - lowercased objective.
 * @returns {{ points: number, triggers: string[], details: Record<string, number> }}
 */
function computeCeremonyPoints(text) {
  let points = 0;
  const triggers = [];
  const details = {};

  const add = (key, pts, trigger) => {
    points += pts;
    details[key] = (details[key] || 0) + pts;
    if (trigger && !triggers.includes(trigger)) triggers.push(trigger);
  };

  if (text.includes('adr') || text.includes('adrs') || text.includes('decision')) {
    add('adrRequired', 4, 'adr-required');
  }
  if (text.includes('data migration') || text.includes('schema migration')) {
    add('dataMigration', 4, 'data-migration');
  }
  if (text.includes('rollout') || text.includes('rollback')) {
    add('rolloutRollback', 4, 'rollout-rollback');
  }
  if (text.includes('multiple teams') || text.includes('cross-team')) {
    add('multipleTeams', 4, 'multiple-teams');
  }
  if (text.includes('architecture') || text.includes('architectural')) {
    add('architectureChange', 4, 'cross-cutting-architecture');
  }
  if (text.includes('compliance') || text.includes('regulatory')) {
    if (!triggers.includes('critical-compliance')) triggers.push('critical-compliance');
  }
  if (text.includes('multiple agents') || text.includes('multi-agent')) {
    add('multipleAgents', 2, 'complex-multi-agent-coordination');
  }
  if (text.includes('public api') || text.includes('public contract') || text.includes('breaking') || text.includes('compat')) {
    add('publicContractCompatImpact', 3, 'breakable-public-contract');
  }
  if (text.includes('blast radius') || text.includes('high risk')) {
    add('highRiskBlastRadius', 3, null);
  }
  if (text.includes('multi-step') || text.includes('several phases') || text.includes('wave') ||
      text.includes('program') || text.includes('epic') || text.includes('milestones')) {
    add('multipleSessionsLikely', 2, 'multiple-waves');
    add('dependenciesBetweenGroups', 2, null);
  }
  if (text.includes('across modules') || text.includes('multiple modules') ||
      text.includes('across the') || (text.includes('every ') && text.length > 20) ||
      (text.includes('all ') && text.length > 20)) {
    add('multipleModules', 2, null);
  }
  if (text.includes('sweep') || text.includes('rename all') || text.includes('bulk') ||
      text.includes('batch') || text.includes('a few')) {
    add('upTo3TasksOneComponent', 1, null);
  }
  if (text.includes('four to') || text.includes('related tasks') || text.includes('several tasks')) {
    add('fourTo12RelatedTasks', 3, null);
  }

  return { points, triggers, details };
}

/**
 * Classifies execution mode using §18 point bands and hard triggers (OP-0005).
 *
 * Bands: 0–3 → direct, 4–7 → batch, 8+ → workflow.
 * Hard triggers (any): force 'workflow' regardless of points.
 * Business nature: always forces 'workflow'.
 *
 * @param {string} text - lowercased objective.
 * @param {object} _execCfg - policy executionMode section (reserved for custom config; bands/points use defaults).
 * @param {boolean} isBusiness - whether nature is 'business'.
 * @returns {{ value: string, ceremonyPoints: number, hardTriggers: string[], reason: string, evidence: object }}
 */
export function classifyExecutionMode(text, _execCfg, isBusiness) {
  const { points, triggers, details } = computeCeremonyPoints(text);
  const allTriggers = [...triggers];
  if (isBusiness && !allTriggers.includes('business-nature')) allTriggers.push('business-nature');

  const hardFired = allTriggers.filter((t) => HARD_WORKFLOW_TRIGGERS.has(t));

  let value;
  let reason;
  if (hardFired.length > 0) {
    value = 'workflow';
    reason = `executionMode=workflow (hard trigger(s): ${hardFired.join(', ')}; points=${points})`;
  } else if (points >= 8) {
    value = 'workflow';
    reason = `executionMode=workflow (ceremony points=${points} >= 8)`;
  } else if (points >= 4) {
    value = 'batch';
    reason = `executionMode=batch (ceremony points=${points} in 4–7 band)`;
  } else {
    value = 'direct';
    reason = `executionMode=direct (ceremony points=${points} in 0–3 band)`;
  }

  return {
    value,
    ceremonyPoints: points,
    hardTriggers: hardFired,
    reason,
    evidence: { ceremonyPoints: points, hardTriggers: hardFired, pointDetails: details, allTriggers },
  };
}
