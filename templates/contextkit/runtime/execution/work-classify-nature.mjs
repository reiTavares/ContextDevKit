/**
 * work-classify-nature.mjs — owner nature and execution-shape classifiers
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
  { s: 'novo produto', w: 6 }, { s: 'novo mercado', w: 6 },
  { s: 'novo segmento', w: 6 }, { s: 'novo público', w: 6 }, { s: 'novo publico', w: 6 },
  { s: 'pivô', w: 6 }, { s: 'pivo', w: 6 }, { s: 'pivotar', w: 6 },
  { s: 'mudança de modelo de negócio', w: 6 }, { s: 'mudanca de modelo de negocio', w: 6 },
  { s: 'capacidade estratégica durável', w: 4 }, { s: 'capacidade estrategica duravel', w: 4 },
  { s: 'kpi independente', w: 3 },
  { s: 'resultado da missão', w: 3 }, { s: 'resultado da missao', w: 3 },
  { s: 'vários fluxos de trabalho', w: 3 }, { s: 'varios fluxos de trabalho', w: 3 },
  { s: 'entre produtos', w: 3 }, { s: 'entre equipes', w: 3 },
  { s: 'patrocinador independente', w: 2 }, { s: 'orçamento', w: 2 }, { s: 'orcamento', w: 2 },
  { s: 'vários meses', w: 2 }, { s: 'varios meses', w: 2 },
  { s: 'vários anos', w: 2 }, { s: 'varios anos', w: 2 },
  { s: 'portfólio', w: 2 },
  { s: 'decisão de roadmap', w: 2 }, { s: 'decisao de roadmap', w: 2 },
  { s: 'revisão de resultado separada', w: 2 }, { s: 'revisao de resultado separada', w: 2 },
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
  { s: 'incidente', w: 6 }, { s: 'erro', w: 6 },
  { s: 'queda', w: 6 }, { s: 'indisponibilidade', w: 6 },
  { s: 'recuperação de produção', w: 6 }, { s: 'recuperacao de producao', w: 6 },
  { s: 'tarefa', w: 4 }, { s: 'manutenção', w: 4 }, { s: 'manutencao', w: 4 },
  { s: 'dependência', w: 4 }, { s: 'dependencia', w: 4 }, { s: 'suporte', w: 4 },
  { s: 'refatoração localizada', w: 4 }, { s: 'refatoracao localizada', w: 4 },
  { s: 'desempenho localizado', w: 4 },
  { s: 'restaurar', w: 3 }, { s: 'corrigir', w: 3 }, { s: 'recuperar', w: 3 },
  { s: 'reparar', w: 3 }, { s: 'urgência operacional', w: 3 }, { s: 'urgencia operacional', w: 3 },
  { s: 'severidade', w: 3 },
  { s: 'capacidade existente limitada', w: 2 },
  { s: 'lote de correções', w: 2 }, { s: 'lote de correcoes', w: 2 },
  { s: 'negócio existente explica o valor', w: 2 }, { s: 'negocio existente explica o valor', w: 2 },
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
 * Resolves the 4.0 owner nature. `none` is the common neutral result; the
 * classifier never invents an Operation merely to hold a technical change.
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

  const portuguese = /\b(?:isso|este|esta|uma|para|corrigir|criar|negocio|operação|operacao)\b/.test(text);
  const CLARIFY_Q = portuguese
    ? 'Isso pertence a Business, Operation ou nenhum contexto?'
    : 'Does this belong to Business, Operation, or neither?';

  let value, confidence, needsClarification, clarifyQuestion, reason, evidenceMatched;

  if (B >= 8 && B >= O + 3) {
    value = 'business';
    confidence = 'high';
    needsClarification = false;
    clarifyQuestion = null;
    evidenceMatched = bizResult.matched;
    reason = `nature=business (B=${B} >= 8 and B >= O+3=${O + 3}; signals: ${bizResult.matched.map((s) => `'${s}'`).join(', ') || 'none'})`;
  } else if (O >= 6 && O >= B && (
    O >= 8
    || opResult.matched.some((signal) => [
      'incident', 'outage', 'hotfix', 'production recovery', 'incidente',
      'queda', 'indisponibilidade', 'recuperação de produção', 'recuperacao de producao',
    ].includes(signal))
  )) {
    value = 'operation';
    confidence = 'high';
    needsClarification = false;
    clarifyQuestion = null;
    evidenceMatched = opResult.matched;
    reason = `nature=operation (O=${O} >= 6 and O >= B=${B}; signals: ${opResult.matched.map((s) => `'${s}'`).join(', ') || 'none'})`;
  } else if (B > 0 && O > 0 && Math.abs(B - O) < 3) {
    value = 'unclassified';
    confidence = 'ask';
    needsClarification = true;
    clarifyQuestion = CLARIFY_Q;
    evidenceMatched = topScore === B ? bizResult.matched : opResult.matched;
    reason = `nature=unclassified (B=${B}, O=${O}; competing evidence)`;
  } else {
    value = 'none';
    confidence = topScore === 0 ? 'high' : 'low';
    needsClarification = false;
    clarifyQuestion = null;
    evidenceMatched = topScore === B ? bizResult.matched : opResult.matched;
    reason = `nature=none (B=${B}, O=${O}; no durable owner context proven)`;
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

/** Structural facts that justify a durable workflow. Vocabulary alone never does. */
const HARD_WORKFLOW_TRIGGERS = new Set([
  'multiple-waves', 'dependent-groups', 'cutover-rollback', 'ordered-integration',
  'multiple-sessions', 'explicit-workflow',
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

  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/\b(?:multiple|several) waves?\b|\bwaves?\s+[1-9]\b|\b(?:varias|multiplas) ondas\b/.test(normalized)) {
    add('multipleWaves', 8, 'multiple-waves');
  }
  if (/\bdependenc(?:y|ies) between (?:groups|tasks|modules)\b|\bgrupos? dependentes?\b|\bdependencias? entre (?:grupos|tarefas|modulos)\b/.test(normalized)) {
    add('dependenciesBetweenGroups', 8, 'dependent-groups');
  }
  if (/\bcutover\b/.test(normalized) && /\brollback\b/.test(normalized)) {
    add('cutoverRollback', 8, 'cutover-rollback');
  }
  if (/\b(?:required order|ordered integration|in order)\b|\b(?:ordem obrigatoria|integracao ordenada)\b/.test(normalized)) {
    add('orderedIntegration', 8, 'ordered-integration');
  }
  if (/\b(?:multiple|several) sessions\b|\b(?:multiplas|varias) sessoes\b/.test(normalized)) {
    add('multipleSessions', 8, 'multiple-sessions');
  }
  if (/\b(?:create|use|run) (?:a )?workflow\b|\b(?:crie|usar|use) (?:um )?workflow\b/.test(normalized)) {
    add('explicitWorkflow', 8, 'explicit-workflow');
  }

  const numericBatch = /\b(?:[4-9]|1[0-2])\s+(?:independent\s+|related\s+)?(?:tasks?|files?|texts?|items?|tarefas?|arquivos?|textos?|itens?)\b/.test(normalized);
  const wordBatch = /\b(?:four|five|six|seven|eight|nine|ten|eleven|twelve|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)\s+(?:independent\s+|related\s+|independentes?\s+|relacionad[oa]s?\s+)?(?:tasks?|files?|texts?|items?|tarefas?|arquivos?|textos?|itens?)\b/.test(normalized);
  if (numericBatch || wordBatch || /\b4\s*[-–]\s*12\s+(?:tasks?|tarefas?)\b/.test(normalized)) {
    add('fourTo12RelatedTasks', 4, null);
  }

  return { points, triggers, details };
}

/**
 * Classifies execution mode using real execution topology. Four to twelve
 * independent/related items select batch; durable sequencing facts select workflow;
 * everything else is direct. Business nature and semantic vocabulary are ignored.
 *
 * @param {string} text - lowercased objective.
 * @param {object} _execCfg - policy executionMode section (reserved for custom config; bands/points use defaults).
 * @param {boolean} isBusiness - whether nature is 'business'.
 * @returns {{ value: string, ceremonyPoints: number, hardTriggers: string[], reason: string, evidence: object }}
 */
export function classifyExecutionMode(text, _execCfg, _isBusiness) {
  const { points, triggers, details } = computeCeremonyPoints(text);
  const allTriggers = [...triggers];
  const hardFired = allTriggers.filter((trigger) => HARD_WORKFLOW_TRIGGERS.has(trigger));

  let value;
  let reason;
  if (hardFired.length > 0) {
    value = 'workflow';
    reason = `executionMode=workflow (hard trigger(s): ${hardFired.join(', ')}; points=${points})`;
  } else if (points >= 4) {
    value = 'batch';
    reason = `executionMode=batch (4–12 related independent items; points=${points})`;
  } else {
    value = 'direct';
    reason = 'executionMode=direct (no batch count or workflow topology proven)';
  }

  return {
    value,
    ceremonyPoints: points,
    hardTriggers: hardFired,
    reason,
    evidence: { ceremonyPoints: points, hardTriggers: hardFired, pointDetails: details, allTriggers },
  };
}
