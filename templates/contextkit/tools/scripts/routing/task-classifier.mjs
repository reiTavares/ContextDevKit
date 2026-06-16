/**
 * Deterministic risk × complexity → executor classifier (ADR-0094 §3).
 *
 * Pure, extensible, zero-dependency. Given a structured `signals` object it
 * returns `{ complexity, risk, executor, confidence, reasons, needsAuthorization }`.
 * It is the single source of the routing posture *Haiku operates · Sonnet
 * executes · Opus decides* (and Opus implements directly on high/critical-risk
 * code). It never selects Fable (ADR-0052), never throws, and never interrupts
 * the user — classification is silent (ADR-0094 §Decision).
 *
 * It composes, not duplicates: `complexity-rubric.mjs` and
 * `economics/routing-economics.routingFactors` are the upstream signal sources;
 * this module fuses them into the executor verdict. Inputs are a plain object so
 * the classifier is trivially testable without filesystem or model access.
 */

/** Complexity buckets, cheapest → most demanding. */
export const COMPLEXITY = Object.freeze(['mechanical', 'simple', 'moderate', 'complex', 'architectural']);
/** Risk buckets, lowest → highest. */
export const RISK = Object.freeze(['low', 'medium', 'high', 'critical']);
/** Executors the router may pick (Fable is NEVER here — ADR-0052). */
export const EXECUTORS = Object.freeze(['haiku', 'sonnet', 'opus']);

/** Operation kinds treated as mechanical/deterministic (Haiku/runner territory). */
const MECHANICAL_KINDS = Object.freeze([
  'search', 'grep', 'glob', 'symbol', 'project-map', 'shell', 'git-read', 'read',
  'metadata', 'lint', 'typecheck', 'build', 'test', 'log-parse', 'log-collect',
  'diff', 'evidence', 'hash',
]);

/** Shell/git operations that still require explicit authorization (ADR-0094 §13). */
const DESTRUCTIVE_HINTS = Object.freeze([
  'rm', 'reset', 'force-push', 'force push', 'migrate', 'migration', 'secret',
  'credential', 'drop ', 'delete', 'prod', 'deploy',
]);

const isMechanicalKind = (kind) => MECHANICAL_KINDS.includes(String(kind || '').toLowerCase());

/**
 * Score the risk band from boolean/scalar signals (ADR-0094 §5 inputs).
 * @param {object} s - signals
 * @returns {{ risk: string, reasons: string[] }}
 */
function scoreRisk(s) {
  const reasons = [];
  const flag = (cond, label) => { if (cond) reasons.push(label); return !!cond; };

  const auth = flag(s.touchesAuth, 'auth/authz surface');
  const sec = flag(s.touchesSecurity, 'security-sensitive');
  const sensitive = flag(s.sensitiveData, 'sensitive data');
  const contract = flag(s.publicContract, 'public contract');
  const concurrency = flag(s.concurrency, 'concurrency/queues/transactions');
  const migration = flag(s.migration, 'db migration');
  const prodHigh = String(s.prodImpact || '').toLowerCase() === 'high';
  const irreversible = s.reversible === false;
  const repeatedFailures = Number(s.priorFailures || 0) >= 2;
  if (prodHigh) reasons.push('high production impact');
  if (irreversible) reasons.push('hard to reverse');
  if (repeatedFailures) reasons.push('prior attempts failed');

  // critical: irreversible/sensitive combinations or schema migrations
  if (migration || (auth && sensitive) || (sec && contract) || (prodHigh && irreversible)) {
    return { risk: 'critical', reasons };
  }
  // high: any single high-stakes surface or repeated failures
  if (auth || sec || sensitive || contract || concurrency || prodHigh || repeatedFailures) {
    return { risk: 'high', reasons };
  }
  // medium: multi-module, DB, large change, or no test coverage
  const multiModule = Number(s.modulesTouched || 0) > 1;
  const touchesDb = flag(s.touchesDb, 'database access');
  const bigChange = ['l', 'xl'].includes(String(s.changeSize || '').toLowerCase());
  const noCover = String(s.testCoverage || '').toLowerCase() === 'none';
  if (multiModule || touchesDb || bigChange || noCover) {
    if (multiModule) reasons.push('multiple modules');
    if (bigChange) reasons.push('large change');
    if (noCover) reasons.push('no test coverage');
    return { risk: 'medium', reasons };
  }
  return { risk: 'low', reasons };
}

/**
 * Score the complexity band (ADR-0094 §5).
 * @param {object} s - signals
 * @param {string} risk - resolved risk band
 * @returns {{ complexity: string, reasons: string[] }}
 */
function scoreComplexity(s, risk) {
  const reasons = [];
  if (isMechanicalKind(s.kind)) {
    reasons.push(`mechanical op (${String(s.kind).toLowerCase()})`);
    return { complexity: 'mechanical', reasons };
  }
  if (s.kind === 'decision' || s.architectural) {
    reasons.push('architectural decision');
    return { complexity: 'architectural', reasons };
  }
  const modules = Number(s.modulesTouched || 1);
  const size = String(s.changeSize || 's').toLowerCase();
  const causeUnclear = s.causeClear === false;
  if (modules >= 4 || size === 'xl' || (causeUnclear && risk !== 'low')) {
    reasons.push(modules >= 4 ? 'cross-cutting (≥4 modules)' : causeUnclear ? 'unknown cause' : 'xl change');
    return { complexity: 'complex', reasons };
  }
  if (modules > 1 || ['m', 'l'].includes(size) || risk === 'high') {
    reasons.push('moderate scope');
    return { complexity: 'moderate', reasons };
  }
  reasons.push('single, small, well-scoped');
  return { complexity: 'simple', reasons };
}

/**
 * Pick the executor from (complexity, risk) honoring the ADR-0094 posture.
 * @param {string} complexity
 * @param {string} risk
 * @param {object} cfg - resolved routing config (executor aliases + allowOpusCoding)
 * @returns {{ executor: string, reasons: string[] }}
 */
function pickExecutor(complexity, risk, cfg) {
  const mech = cfg.mechanicalExecutor || 'haiku';
  const impl = cfg.implementationExecutor || 'sonnet';
  const reason = cfg.reasoningExecutor || 'opus';

  if (complexity === 'mechanical') {
    return { executor: mech, reasons: ['mechanical → operates tier'] };
  }
  if (risk === 'critical' || risk === 'high') {
    return { executor: reason, reasons: [`${risk} risk → reasoning tier implements directly`] };
  }
  if (complexity === 'architectural' || complexity === 'complex') {
    return { executor: reason, reasons: [`${complexity} → reasoning tier`] };
  }
  // simple/moderate + low/medium risk → implementation tier
  return { executor: impl, reasons: [`${complexity}/${risk} → execution tier`] };
}

/**
 * Classify a task into complexity, risk, and executor.
 *
 * @param {object} [signals] - structured signals (all optional, safe defaults).
 * @param {object} [cfg] - resolved routing config (executor aliases). Defaults to the posture.
 * @returns {{ complexity, risk, executor, confidence, reasons, needsAuthorization, escalate }}
 */
export function classifyTask(signals = {}, cfg = {}) {
  const s = signals && typeof signals === 'object' ? signals : {};
  const { risk, reasons: riskReasons } = scoreRisk(s);
  const { complexity, reasons: cxReasons } = scoreComplexity(s, risk);
  const { executor, reasons: exReasons } = pickExecutor(complexity, risk, cfg);

  // Confidence drops on ambiguity / unknown cause / prior failures → escalation hint.
  let confidence = 'high';
  if (s.causeClear === false || s.ambiguous) confidence = 'low';
  else if (risk === 'high' || risk === 'critical') confidence = 'medium';

  const text = `${s.kind || ''} ${s.title || ''}`.toLowerCase();
  const needsAuthorization = DESTRUCTIVE_HINTS.some((h) => text.includes(h)) || !!s.destructive;

  return Object.freeze({
    complexity,
    risk,
    executor,
    confidence,
    needsAuthorization,
    escalate: confidence === 'low' || Number(s.priorFailures || 0) >= 2,
    reasons: [...cxReasons, ...riskReasons, ...exReasons],
  });
}

/**
 * Convenience: derive coarse signals from a free-text task title + optional kind.
 * Heuristic only — a structured `signals` object always beats this.
 *
 * @param {string} title - the task description.
 * @param {object} [extra] - extra signals merged on top.
 * @returns {object} signals object suitable for classifyTask.
 */
export function signalsFromTitle(title = '', extra = {}) {
  const t = String(title).toLowerCase();
  const has = (...ws) => ws.some((w) => t.includes(w));
  const kind = has('grep', 'search', 'find', 'glob', 'list') ? 'search'
    : has('run test', 'tests', 'lint', 'type-check', 'typecheck', 'build') ? 'test'
    : has('log', 'collect', 'summar') ? 'log-collect'
    : has('decide', 'architecture', 'adr', 'design') ? 'decision'
    : 'implement';
  return {
    kind,
    touchesAuth: has('auth', 'login', 'token', 'session', 'rls', 'permission'),
    touchesSecurity: has('security', 'secret', 'credential', 'crypto'),
    sensitiveData: has('pii', 'personal data', 'sensitive', 'financ', 'clinical', 'patient'),
    publicContract: has('public api', 'contract', 'breaking', 'export'),
    concurrency: has('concurren', 'queue', 'transaction', 'distributed', 'race'),
    migration: has('migration', 'migrate schema', 'alter table'),
    title,
    ...extra,
  };
}
