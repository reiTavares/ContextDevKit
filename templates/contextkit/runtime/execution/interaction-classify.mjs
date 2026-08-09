/**
 * Cheap, side-effect-free interaction classifier for the prompt hot path.
 *
 * Text is only a prior. A real write attempt supplied through `context` is
 * authoritative and monotonically promotes the interaction to `mutation`.
 * This module performs no I/O, allocates no id, and invokes no resolver.
 */

export const INTERACTION_INTENTS = Object.freeze([
  'conversation', 'exploration', 'mutation', 'unclassified',
]);

const PT_LANGUAGE_WORDS = new Set([
  'ainda', 'algo', 'alterar', 'analisar', 'como', 'com', 'corrigir', 'da', 'de',
  'este', 'esta', 'eu', 'isso', 'nao', 'o', 'para', 'poderia', 'por', 'que',
  'sem', 'uma', 'voce',
]);

const EN_LANGUAGE_WORDS = new Set([
  'about', 'analyze', 'change', 'could', 'create', 'explain', 'for', 'how', 'i',
  'is', 'it', 'me', 'the', 'this', 'to', 'what', 'why', 'without', 'you',
]);

const EXPLICIT_READ_ONLY = [
  /\bwithout (?:changing|editing|writing|modifying)\b/,
  /\bdo not (?:change|edit|write|modify)\b/,
  /\bno changes?\b/,
  /\bread[- ]only\b/,
  /\bsem (?:alterar|editar|escrever|modificar|mudar)\b/,
  /\bnao (?:altere|edite|escreva|modifique|mude)\b/,
  /\bnenhuma alteracao\b/,
  /\bsomente leitura\b/,
];

const HYPOTHETICAL_EXPLORATION = [
  /\bhow (?:can|could|would|should) (?:i|we|one)\b/,
  /\bwhat would (?:it take|be needed|required)\b/,
  /\bcomo (?:eu |nos )?(?:poderia|poderiamos|posso|podemos|faria|fariamos)\b/,
  /\bo que seria (?:necessario|preciso)\b/,
];

const MUTATION_VERB = '(?:create|add|implement|fix|correct|refactor|remove|delete|edit|write|update|rename|build|replace|migrate|patch|wire|scaffold|generate|install|configure|adjust|change|store|persist|save|criar|crie|adicionar|adicione|implementar|implemente|corrigir|corrija|consertar|conserte|refatorar|refatore|remover|remova|deletar|apagar|apague|editar|edite|escrever|escreva|atualizar|atualize|renomear|renomeie|construir|gerar|gere|instalar|configure|configurar|ajustar|ajuste|alterar|altere|mudar|mude|armazenar|armazene|persistir|persista|salvar|salve)';

const DIRECT_MUTATION = [
  new RegExp(`(?:^|[.!?;\\n]\\s*)(?:please\\s+)?${MUTATION_VERB}\\b`),
  new RegExp(`(?:^|[.!?;\\n]\\s*)(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?${MUTATION_VERB}\\b`),
  new RegExp(`(?:^|[.!?;\\n]\\s*)(?:i\\s+)?(?:want|need)\\s+(?:you\\s+to\\s+|to\\s+)?${MUTATION_VERB}\\b`),
  new RegExp(`(?:^|[.!?;\\n]\\s*)(?:por favor,?\\s+)?${MUTATION_VERB}\\b`),
  new RegExp(`(?:^|[.!?;\\n]\\s*)(?:voce\\s+)?pode\\s+(?:por favor\\s+)?${MUTATION_VERB}\\b`),
  new RegExp(`(?:^|[.!?;\\n]\\s*)(?:eu\\s+)?(?:quero|preciso)\\s+(?:(?:que\\s+)?voce\\s+|que\\s+|de\\s+)?${MUTATION_VERB}\\b`),
];

const EXPLORATION = [
  /(?:^|[.!?;\n]\s*)(?:please\s+)?(?:analyze|analyse|investigate|compare|review|inspect|read|research|explore|evaluate|summarize|summarise|list|find|search)\b/,
  /(?:^|[.!?;\n]\s*)(?:por favor,?\s+)?(?:analise|analisar|investigue|investigar|compare|comparar|revise|revisar|inspecione|inspecionar|leia|pesquise|pesquisar|explore|explorar|avalie|avaliar|resuma|resumir|liste|listar|encontre|buscar)\b/,
  /\b(?:where is|where are|which files?|show me)\b/,
  /\b(?:onde esta|onde ficam|quais arquivos|mostre)\b/,
];

const CONVERSATION = [
  /^(?:hi|hello|hey|thanks|thank you|bom dia|boa tarde|boa noite|oi|ola)\b/,
  /(?:^|[.!?;\n]\s*)(?:explain|describe|tell me)\b/,
  /(?:^|[.!?;\n]\s*)(?:explique|descreva|me diga)\b/,
  /\b(?:what is|what are|what does|why is|why does|how does)\b/,
  /\b(?:o que e|o que sao|por que|como funciona|qual e)\b/,
];

/**
 * Normalize text for deterministic accent-insensitive matching.
 * @param {unknown} prompt raw prompt value
 * @returns {string} normalized prompt
 */
function normalizeText(prompt) {
  return String(prompt ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detect enough language to localize the single clarification question.
 * This is deliberately small: language prediction never changes governance.
 *
 * @param {string} prompt
 * @returns {'pt'|'en'|'unknown'}
 */
export function detectInteractionLanguage(prompt) {
  const normalized = normalizeText(prompt);
  const words = normalized.match(/[a-z]+/g) ?? [];
  let pt = 0;
  let en = 0;
  for (const word of words) {
    if (PT_LANGUAGE_WORDS.has(word)) pt += 1;
    if (EN_LANGUAGE_WORDS.has(word)) en += 1;
  }
  if (pt === en) return 'unknown';
  return pt > en ? 'pt' : 'en';
}

/**
 * Return the one allowed clarification, unless this revision already asked it.
 * @param {string} prompt raw prompt
 * @param {{ clarificationAsked?: boolean }} context revision context
 * @returns {string|null} localized clarification
 */
function clarificationFor(prompt, context) {
  if (context?.clarificationAsked === true) return null;
  return detectInteractionLanguage(prompt) === 'pt'
    ? 'Você quer que eu altere algo?'
    : 'Do you want me to change anything?';
}

/**
 * Build the stable public result shape.
 * @param {string} intent canonical interaction intent
 * @param {number} confidence deterministic confidence
 * @param {string[]} reasonCodes explainable reason codes
 * @param {string|null} clarification optional single clarification
 * @returns {{ intent: string, confidence: number, reasonCodes: string[], clarification: string|null }}
 */
function verdict(intent, confidence, reasonCodes, clarification = null) {
  return { intent, confidence, reasonCodes, clarification };
}

/**
 * Classify one interaction without touching disk or resolving governed work.
 *
 * @param {string} prompt current user prompt
 * @param {{ writeAttempt?: boolean, mutationAttempt?: boolean,
 *   priorIntent?: string, clarificationAsked?: boolean }} [context]
 * @returns {{ intent: 'conversation'|'exploration'|'mutation'|'unclassified',
 *   confidence: number, reasonCodes: string[], clarification: string|null }}
 */
export function classifyInteraction(prompt, context = {}) {
  try {
    if (context?.priorIntent === 'mutation') {
      return verdict('mutation', 1, ['mutation-monotonic-prior']);
    }
    if (context?.writeAttempt === true || context?.mutationAttempt === true) {
      return verdict('mutation', 1, ['mutation-authoritative-attempt']);
    }

    const normalized = normalizeText(prompt);
    if (!normalized) {
      return verdict('unclassified', 0, ['prompt-empty'], clarificationFor(prompt, context));
    }

    if (EXPLICIT_READ_ONLY.some((pattern) => pattern.test(normalized))) {
      return verdict('exploration', 0.99, ['exploration-explicit-read-only']);
    }
    if (HYPOTHETICAL_EXPLORATION.some((pattern) => pattern.test(normalized))) {
      return verdict('exploration', 0.96, ['exploration-hypothetical']);
    }
    if (/^(?:please\s+|por favor,?\s+)?(?:adjust|change|update|fix|ajuste|altere|mude|atualize|corrija)\s+(?:this|that|it|isso|isto|aquilo)\.?$/.test(normalized)) {
      return verdict(
        'unclassified',
        0.35,
        ['mutation-target-missing'],
        clarificationFor(prompt, context),
      );
    }
    if (DIRECT_MUTATION.some((pattern) => pattern.test(normalized))) {
      return verdict('mutation', 0.95, ['mutation-explicit-request']);
    }
    if (EXPLORATION.some((pattern) => pattern.test(normalized))) {
      return verdict('exploration', 0.9, ['exploration-read-only-action']);
    }
    if (CONVERSATION.some((pattern) => pattern.test(normalized)) || /\?$/.test(normalized)) {
      return verdict('conversation', 0.85, ['conversation-question-or-explanation']);
    }

    return verdict(
      'unclassified',
      0.3,
      ['interaction-insufficient-evidence'],
      clarificationFor(prompt, context),
    );
  } catch {
    return verdict(
      'unclassified',
      0,
      ['interaction-classifier-degraded'],
      null,
    );
  }
}
