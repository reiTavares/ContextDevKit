/**
 * intent-language.mjs — language-aware deterministic intent classification
 * (WF-0069, OP-0008, ADR-0131). Zero runtime dependencies, no LLM, no clock,
 * no randomness — the same input always yields the same output (immutable rule 1).
 *
 * Two pure functions:
 *   detectLanguage(text)          → { lang, confidence, script }
 *   classifyIntentLangAware(text) → { language, intent, mutationVerb, readOnly,
 *                                     confidence, routeToAI, reasons }
 *
 * Design (ADR-0131 §Decision + Binding condition):
 *   - Offline language *detection* via Unicode-script ranges + frozen pt/en
 *     stopword tables. Translation of other languages is NEVER done here — it is
 *     delegated to the model via the hook's ‹CONTEXTKIT-LANG› directive (next-turn).
 *   - Intent runs BOTH pt+en tables regardless of the detected language (mixed
 *     prompts / English identifiers in pt prose). The language verdict only decides
 *     whether the caller emits the AI directive (`routeToAI`) — it must NOT narrow
 *     which verb tables run (ADR-0131 binding condition, supersedes the earlier
 *     SPEC 'unknown' phrasing).
 *   - A mutation verb (create/fix/refactor/…) forces `code` intent, overriding the
 *     no-code bias — mirroring looksLikeNewTask > isPureConversation
 *     (execution-contract-hook.mjs). On genuine ambiguity the verdict is `no-code`
 *     (inverting the legacy `feature` fallthrough), porting the domain classifier's
 *     explicitReadOnly:-100 concept WITHOUT activating that default-OFF path.
 *   - The authoritative write-attempt override (a real Edit/Write forcing code
 *     intent, F-A) lives in the gate/hook, NOT in this text-only module.
 *
 * @module runtime/execution/intent-language
 */

/** Non-Latin Unicode script ranges → language hint (high-confidence when dominant). */
const SCRIPT_RANGES = Object.freeze([
  { script: 'cyrillic', lang: 'ru', re: /[Ѐ-ӿ]/g },
  { script: 'han', lang: 'zh', re: /[一-鿿]/g },
  { script: 'kana', lang: 'ja', re: /[぀-ヿ]/g },
  { script: 'hangul', lang: 'ko', re: /[가-힯]/g },
  { script: 'arabic', lang: 'ar', re: /[؀-ۿ]/g },
  { script: 'greek', lang: 'el', re: /[Ͱ-Ͽ]/g },
  { script: 'hebrew', lang: 'he', re: /[֐-׿]/g },
]);

/**
 * Frozen pt function-word stopwords (single tokens; multi-word phrases live in the
 * intent tables). Every entry is chosen to be pt-DISTINCTIVE — it must NOT also be a
 * common English word (e.g. we deliberately exclude 'no'/'do'/'a'/'as' which collide
 * with en), so a stopword hit is real pt-vs-en evidence, not noise.
 */
const PT_STOPWORDS = Object.freeze([
  'que', 'não', 'nao', 'para', 'com', 'uma', 'dos', 'das', 'como', 'mais', 'você',
  'voce', 'está', 'esta', 'são', 'sao', 'isso', 'aqui', 'então', 'entao', 'porque',
  'qual', 'quais', 'sobre', 'pelo', 'pela', 'este', 'essa', 'esse', 'meu', 'minha',
  'fazer', 'tem', 'ser', 'seu', 'sua', 'ele', 'ela', 'nós', 'nos', 'foi',
  // Common pt function words (pt-distinctive — none collide with en stopwords).
  'de', 'da', 'em', 'na', 'nas', 'os', 'ao', 'aos', 'o', 'e', 'ou', 'se', 'um',
  'nesta', 'neste', 'pra', 'até', 'ate', 'também', 'tambem', 'muito', 'quando',
]);

/**
 * Frozen en function-word stopwords (single tokens). Each is en-DISTINCTIVE — it must
 * NOT also be a common pt word (e.g. 'do'/'no'/'o'/'e'/'a' are pt words and are
 * excluded here), so counts discriminate pt from en instead of cancelling out.
 */
const EN_STOPWORDS = Object.freeze([
  'the', 'is', 'are', 'and', 'you', 'this', 'that', 'how', 'what', 'why', 'please',
  'can', 'could', 'with', 'for', 'should', 'would', 'does', 'about', 'it', 'be',
  'was', 'were', 'they', 'them', 'here', 'there', 'have', 'has', 'will', 'from',
  // Common en function words (en-distinctive — none collide with pt stopwords).
  'of', 'to', 'in', 'on', 'at', 'by', 'an', 'i', 'we', 'if', 'but', 'not', 'my',
  'me', 'so', 'its', 'when', 'which', 'these', 'those', 'their', 'our',
]);

/** Mutation verbs (en + pt) — presence forces `code` intent, overriding the bias. */
const MUTATION_VERBS = Object.freeze([
  // en
  'create', 'add ', 'implement', 'fix ', 'refactor', 'remove', 'delete', 'edit',
  'write ', 'update', 'rename', 'build', 'replace', 'migrate', 'patch', 'wire ',
  'scaffold', 'generate', 'install', 'configure', 'set up', 'rewrite', 'append',
  // pt
  'criar', 'crie', 'cria ', 'adicionar', 'adicione', 'implementar', 'implemente',
  'corrigir', 'corrija', 'consertar', 'conserte', 'refatorar', 'refatore',
  'remover', 'remova', 'deletar', 'apagar', 'apague', 'editar', 'edite',
  'escrever', 'escreva', 'atualizar', 'atualize', 'renomear', 'renomeie',
  'construir', 'gerar', 'gere', 'instalar', 'configurar', 'ajustar', 'ajuste',
]);

/** Read-only / question signals (en + pt) — no mutation verb + these ⇒ `no-code`. */
const READONLY_SIGNALS = Object.freeze([
  // en
  'what is', 'what are', 'what does', 'how does', 'how do', 'why does', 'why is',
  'explain', 'investigate', 'analyze', 'analyse', 'understand', 'show me', 'list ',
  'read ', 'tell me', 'describe', 'can you explain', 'where is', 'which ',
  'is there', 'are there', 'do you', 'does it', 'review', 'summarize', 'summarise',
  // pt
  'o que é', 'o que sao', 'o que são', 'como funciona', 'por que', 'porque',
  'explique', 'explica', 'explicar', 'investigar', 'analisar', 'entender', 'mostre',
  'mostrar', 'listar', 'liste', 'qual é', 'quais são', 'quais sao', 'me diga',
  'descreva', 'onde está', 'onde esta', 'existe', 'tem como', 'dúvida', 'duvida',
  'pergunta',
]);

const PT_SET = new Set(PT_STOPWORDS);
const EN_SET = new Set(EN_STOPWORDS);
const ACCENT_RE = /[áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ]/;

/**
 * Counts word tokens (Unicode-letter runs) in a string.
 * @param {string} text
 * @returns {number}
 */
function tokenCount(text) {
  const m = String(text ?? '').match(/[\p{L}]+/gu);
  return m ? m.length : 0;
}

/**
 * Detects the language of a prompt, offline and deterministically. Non-Latin
 * scripts resolve by Unicode range; Latin script disambiguates pt vs en by
 * stopword frequency (accent presence is a strong pt tie-breaker).
 *
 * @param {string} text prompt text
 * @returns {{ lang: string, confidence: number, script: string }}
 *   lang is an ISO-ish code ('pt','en','ru',…) or 'unknown'; confidence ∈ [0,1].
 */
export function detectLanguage(text) {
  const raw = typeof text === 'string' ? text : '';
  // 1. Non-Latin script dominance wins outright.
  for (const { script, lang, re } of SCRIPT_RANGES) {
    const hits = (raw.match(re) || []).length;
    if (hits >= 2) {
      return { lang, confidence: Number(Math.min(1, 0.6 + hits / 20).toFixed(2)), script };
    }
  }
  // 2. Latin script: pt vs en via stopword counts.
  const tokens = raw.toLowerCase().match(/[\p{L}]+/gu) || [];
  if (tokens.length === 0) return { lang: 'unknown', confidence: 0, script: 'none' };
  let pt = 0;
  let en = 0;
  for (const tok of tokens) {
    if (PT_SET.has(tok)) pt += 1;
    if (EN_SET.has(tok)) en += 1;
  }
  if (ACCENT_RE.test(raw)) pt += 1; // accents are a strong pt signal
  if (pt === 0 && en === 0) return { lang: 'unknown', confidence: 0.2, script: 'latin' };
  const lang = pt > en ? 'pt' : en > pt ? 'en' : ACCENT_RE.test(raw) ? 'pt' : 'en';
  const dom = Math.max(pt, en);
  const total = pt + en;
  let confidence = Number(Math.min(1, dom / Math.max(total, 1)).toFixed(2));
  if (dom < 2) confidence = Math.min(confidence, 0.4); // thin evidence ⇒ low confidence
  return { lang, confidence, script: 'latin' };
}

/**
 * Classifies intent (code vs no-code) in a language-aware way. Runs BOTH pt+en
 * intent tables regardless of the detected language (ADR-0131 binding condition);
 * the language verdict only sets `routeToAI` (whether the caller should emit the
 * next-turn ‹CONTEXTKIT-LANG› directive). Bias-to-no-code applies ONLY on genuine
 * ambiguity — a mutation verb always forces `code`.
 *
 * @param {string} text prompt text
 * @param {{ confidenceThreshold?: number, shortWords?: number }} [opts]
 * @returns {{ language: object, intent: 'code'|'no-code', mutationVerb: boolean,
 *   readOnly: boolean, confidence: number, routeToAI: boolean, reasons: string[] }}
 */
export function classifyIntentLangAware(text, opts = {}) {
  const raw = typeof text === 'string' ? text : '';
  const lower = raw.toLowerCase();
  const language = detectLanguage(raw);
  const reasons = [];

  const mutationVerb = MUTATION_VERBS.some((v) => lower.includes(v));
  const readOnly = READONLY_SIGNALS.some((s) => lower.includes(s)) || /\?\s*$/.test(raw.trim());
  const short = tokenCount(raw) < (opts.shortWords ?? 4);

  let intent;
  if (mutationVerb) {
    intent = 'code';
    reasons.push('intent=code (mutation verb present — overrides no-code bias)');
  } else if (readOnly) {
    intent = 'no-code';
    reasons.push('intent=no-code (read-only/question signal; no mutation verb)');
  } else if (short) {
    intent = 'no-code';
    reasons.push('intent=no-code (short/ambiguous prompt; bias-to-no-code default)');
  } else {
    intent = 'no-code';
    reasons.push('intent=no-code (no mutation verb; ambiguity defaults to no-code)');
  }

  const threshold = opts.confidenceThreshold ?? 0.5;
  const known = language.lang === 'pt' || language.lang === 'en';
  const routeToAI = !known || language.confidence < threshold;
  if (routeToAI) {
    reasons.push(`routeToAI=true (lang='${language.lang}' confidence=${language.confidence}; emit ‹CONTEXTKIT-LANG›)`);
  }

  return { language, intent, mutationVerb, readOnly, confidence: language.confidence, routeToAI, reasons };
}
