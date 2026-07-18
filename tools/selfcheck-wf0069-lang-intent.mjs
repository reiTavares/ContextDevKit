#!/usr/bin/env node
/**
 * WF-0069 self-check (OP-0008, ADR-0131 + ADR-0133) — language-aware intent
 * classification golden set + the hard acceptance criteria that gate the workflow.
 *
 * Asserts (exit-gate Definition of Done):
 *   A. detectLanguage — pt/en/ru/other detection, deterministic, fail-open.
 *   B. classifyIntentLangAware GOLDEN SET:
 *        pt/en/ru QUESTIONS  ⇒ intent 'no-code'
 *        pt/en/ru CODE requests ⇒ intent 'code' (mutation verb overrides bias)
 *        routeToAI true for ru (non pt/en), false for confident pt/en.
 *   C. Mutation-verb override beats the no-code bias (ADR-0131 binding).
 *   D. BOTH pt+en tables run regardless of detected language (mixed prompt).
 *   E. request-classify #7 fix: a MINTED taskId (/^task-/) does NOT force
 *        primaryType 'workflow'; a real workflow ref still does. Conversation
 *        branch is REACHABLE under a no-code prior (Finding #1/#7).
 *   F. F-A (HARD ACCEPTANCE): the completion-gate no-code escape clears obligations
 *        when no write occurred, but a real Edit/Write for the SAME taskId (F-B
 *        binding) REVOKES the escape — obligations stand.
 *   G. Determinism (identical input → identical output) + fail-open (malformed).
 *   H. Domain-axis guard: a regulated domain is NEVER inverted by the no-code escape.
 *
 * Standalone runnable: node tools/selfcheck-wf0069-lang-intent.mjs
 * Exit 0 = all pass, 1 = any failure. Zero deps — node:* + templates source.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dirname, '..');
const src = (rel) => pathToFileURL(resolve(KIT, 'templates/contextkit', rel)).href;

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.error(`  ✗ ${m}`); failures += 1; };

let detectLanguage, classifyIntentLangAware, classifyRequest, augmentWithLangAwareNoCode;
try {
  ({ detectLanguage, classifyIntentLangAware } = await import(src('runtime/execution/intent-language.mjs')));
  ({ classifyRequest } = await import(src('runtime/execution/request-classify.mjs')));
  ({ augmentWithLangAwareNoCode } = await import(src('runtime/hooks/completion-gate.mjs')));
  ok('intent-language + request-classify + completion-gate import cleanly');
} catch (err) {
  console.error(`FATAL: import failed: ${err?.message ?? err}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// A. detectLanguage
// ---------------------------------------------------------------------------
console.log('\n(A) detectLanguage — offline detection\n');
{
  const pt = detectLanguage('Como funciona o classificador de intenção nesta ferramenta?');
  pt.lang === 'pt' ? ok(`pt detected (confidence=${pt.confidence})`) : bad(`expected pt, got ${pt.lang}`);
  const en = detectLanguage('How does the intent classifier work in this tool?');
  en.lang === 'en' ? ok(`en detected (confidence=${en.confidence})`) : bad(`expected en, got ${en.lang}`);
  const ru = detectLanguage('Как работает классификатор намерений в этом инструменте?');
  ru.lang === 'ru' ? ok(`ru detected via Cyrillic (confidence=${ru.confidence})`) : bad(`expected ru, got ${ru.lang}`);
  const empty = detectLanguage('');
  empty.lang === 'unknown' && empty.confidence === 0 ? ok('empty → unknown/0 (fail-open)') : bad(`empty wrong: ${JSON.stringify(empty)}`);
  const nonstr = detectLanguage(null);
  nonstr && nonstr.lang === 'unknown' ? ok('null input → unknown (no throw)') : bad('null input did not degrade safely');
}

// ---------------------------------------------------------------------------
// B. Golden set — questions vs code requests, all three languages
// ---------------------------------------------------------------------------
console.log('\n(B) Golden set — pt/en/ru questions ⇒ no-code; code requests ⇒ code\n');
const QUESTIONS = {
  pt: 'O que faz o hook de completion gate?',
  en: 'What does the completion gate hook do?',
  ru: 'Что делает этот хук?',
};
// pt/en carry embedded verb tables (deterministic ⇒ code). ru has NO embedded verb
// table by design (ADR-0131: don't embed every language) — a ru code request stays a
// safe no-code PRIOR in the hook and is routed to the model via ‹CONTEXTKIT-LANG› for
// the actual code/no-code decision. So the deterministic assertion for ru is
// routeToAI, NOT intent=code (that resolution lives in the AI layer, not the hook).
const CODE = {
  pt: 'Implementar um novo módulo de detecção de idioma no hook',
  en: 'Implement a new language detection module in the hook',
};
for (const [lang, text] of Object.entries(QUESTIONS)) {
  const r = classifyIntentLangAware(text);
  r.intent === 'no-code'
    ? ok(`${lang} question ⇒ no-code`)
    : bad(`${lang} question ⇒ expected no-code, got ${r.intent} (${r.reasons?.[0]})`);
}
for (const [lang, text] of Object.entries(CODE)) {
  const r = classifyIntentLangAware(text);
  r.intent === 'code'
    ? ok(`${lang} code request ⇒ code (mutationVerb=${r.mutationVerb})`)
    : bad(`${lang} code request ⇒ expected code, got ${r.intent} (${r.reasons?.[0]})`);
}
// ru code request: safe no-code prior in the hook + routed to the model (ADR-0131).
{
  const ruCode = classifyIntentLangAware('Добавить новый модуль в этот проект');
  ruCode.routeToAI === true && ruCode.intent === 'no-code'
    ? ok('ru code request ⇒ no-code PRIOR + routeToAI (AI layer resolves; ADR-0131)')
    : bad(`ru code routing wrong: intent=${ruCode.intent} routeToAI=${ruCode.routeToAI}`);
}

// routeToAI: ru routes to AI; confident pt/en do not.
{
  const ru = classifyIntentLangAware(QUESTIONS.ru);
  ru.routeToAI === true ? ok('ru ⇒ routeToAI true (emit ‹CONTEXTKIT-LANG›)') : bad('ru should routeToAI');
  const pt = classifyIntentLangAware('O que faz o hook de completion gate nesta ferramenta de verdade?');
  pt.routeToAI === false ? ok('confident pt ⇒ routeToAI false') : bad(`confident pt should not routeToAI (conf=${pt.confidence})`);
}

// ---------------------------------------------------------------------------
// C. Mutation-verb override beats the no-code bias
// ---------------------------------------------------------------------------
console.log('\n(C) Mutation-verb override (ADR-0131 binding)\n');
{
  // A question-shaped prompt that ALSO carries a mutation verb ⇒ code wins.
  const r = classifyIntentLangAware('Você pode criar um novo endpoint para isso?');
  r.intent === 'code' && r.mutationVerb === true
    ? ok('question-shaped + mutation verb "criar" ⇒ code (override)')
    : bad(`mutation override failed: intent=${r.intent} verb=${r.mutationVerb}`);
  const en = classifyIntentLangAware('Can you add a logout button?');
  en.intent === 'code' ? ok('en "add" overrides question bias ⇒ code') : bad(`en add override failed: ${en.intent}`);
}

// ---------------------------------------------------------------------------
// D. BOTH pt+en tables run regardless of detected language (mixed prompt)
// ---------------------------------------------------------------------------
console.log('\n(D) Mixed-language: both pt+en tables run regardless of detected lang\n');
{
  // Detected pt, but the mutation verb is the English "refactor".
  const r = classifyIntentLangAware('Preciso refactor este arquivo agora');
  r.intent === 'code'
    ? ok('pt prose + en verb "refactor" ⇒ code (en table ran under pt detection)')
    : bad(`mixed-language verb missed: intent=${r.intent}`);
}

// ---------------------------------------------------------------------------
// E. request-classify #7 — minted taskId does NOT force 'workflow'; branch reachable
// ---------------------------------------------------------------------------
console.log('\n(E) Finding #7 — minted taskId no longer shunts to workflow; conversation reachable\n');
{
  const noCodeSignals = { tier: 'feature', domain: 'general', intent: classifyIntentLangAware('O que faz este hook?') };
  const minted = classifyRequest(noCodeSignals, { taskId: 'task-abc12345-1', requestText: 'O que faz este hook?' });
  minted.primaryType !== 'workflow'
    ? ok(`minted taskId 'task-...' ⇒ primaryType='${minted.primaryType}' (NOT workflow)`)
    : bad(`minted taskId still forced workflow: ${minted.primaryType}`);
  minted.primaryType === 'conversation'
    ? ok('no-code prior + question ⇒ conversation branch REACHABLE (Finding #1/#7)')
    : bad(`expected conversation, got ${minted.primaryType} — branch still dead?`);

  const realWf = classifyRequest({ tier: 'feature', domain: 'general' }, { workflowId: 'WF-0069', taskId: 'task-x-1', requestText: 'continue' });
  realWf.primaryType === 'workflow'
    ? ok("real workflowId ⇒ primaryType='workflow' (preserved)")
    : bad(`real workflow ref lost: ${realWf.primaryType}`);

  const externalTask = classifyRequest({ tier: 'feature', domain: 'general' }, { taskId: 'CDK-070', requestText: 'work on this' });
  externalTask.primaryType === 'workflow'
    ? ok("external (non-minted) taskId 'CDK-070' ⇒ workflow (preserved)")
    : bad(`external task ref lost: ${externalTask.primaryType}`);
}

// ---------------------------------------------------------------------------
// F. F-A HARD ACCEPTANCE — no-code escape cleared without a write; REVOKED by a write
// ---------------------------------------------------------------------------
console.log('\n(F) F-A — a recorded active-path write revokes the no-code escape\n');
{
  const noCodeContract = { signals: { domain: 'general', intent: { intent: 'no-code', mutationVerb: false, language: { lang: 'pt' } } } };
  const withObligations = () => ({ reasonCodes: ['completion-evidence-missing'], remediation: ['Run /tests'], detail: { missing: ['tests'] }, decision: 'warn' });

  // No write for the task ⇒ escape applied, obligations cleared.
  const r1 = withObligations();
  const out1 = augmentWithLangAwareNoCode(r1, noCodeContract, { modifications: [] }, 'task-1');
  out1.applied === true && r1.reasonCodes.length === 0 && r1.decision === 'allow'
    ? ok('no-code + no write ⇒ escape applied, obligations cleared, allow')
    : bad(`escape not applied: applied=${out1.applied} codes=${r1.reasonCodes.length} decision=${r1.decision}`);

  // A real Edit for the SAME task ⇒ escape REVOKED, obligations stand (F-A).
  const r2 = withObligations();
  const ledgerWrote = { modifications: [{ path: 'src/x.mjs', tool: 'Edit', taskId: 'task-1' }] };
  const out2 = augmentWithLangAwareNoCode(r2, noCodeContract, ledgerWrote, 'task-1');
  out2.wrote === true && out2.applied === false && r2.reasonCodes.length === 1
    ? ok('no-code + real Edit for task ⇒ escape REVOKED, obligations stand (F-A)')
    : bad(`F-A hole: wrote=${out2.wrote} applied=${out2.applied} codes=${r2.reasonCodes.length}`);

  // F-B binding: a write for a DIFFERENT task must NOT revoke this task's escape.
  const r3 = withObligations();
  const ledgerOther = { modifications: [{ path: 'src/y.mjs', tool: 'Write', taskId: 'task-OTHER' }] };
  const out3 = augmentWithLangAwareNoCode(r3, noCodeContract, ledgerOther, 'task-1');
  out3.applied === true && r3.reasonCodes.length === 0
    ? ok('F-B: write bound to a DIFFERENT taskId does not revoke this task (one binding)')
    : bad(`F-B binding wrong: applied=${out3.applied} codes=${r3.reasonCodes.length}`);
}

// ---------------------------------------------------------------------------
// G. Determinism + fail-open
// ---------------------------------------------------------------------------
console.log('\n(G) Determinism + fail-open\n');
{
  const a = JSON.stringify(classifyIntentLangAware('O que faz este hook de verdade agora?'));
  const b = JSON.stringify(classifyIntentLangAware('O que faz este hook de verdade agora?'));
  a === b ? ok('identical input ⇒ identical output (deterministic)') : bad('non-deterministic output');
  let threw = false;
  try { classifyIntentLangAware(undefined); classifyIntentLangAware(42); } catch { threw = true; }
  !threw ? ok('malformed input ⇒ no throw (fail-open)') : bad('classifyIntentLangAware threw on bad input');
}

// ---------------------------------------------------------------------------
// H. Domain-axis guard — regulated domain is NEVER inverted
// ---------------------------------------------------------------------------
console.log('\n(H) Domain-axis guard — regulated domain keeps obligations\n');
{
  const lgpdContract = { signals: { domain: 'lgpd', intent: { intent: 'no-code', mutationVerb: false, language: { lang: 'pt' } } } };
  const r = { reasonCodes: ['completion-evidence-missing'], remediation: ['x'], detail: { missing: ['tests'] }, decision: 'warn' };
  const out = augmentWithLangAwareNoCode(r, lgpdContract, { modifications: [] }, 'task-1');
  out.applied === false && r.reasonCodes.length === 1
    ? ok('lgpd domain + no-code ⇒ escape NOT applied (never invert on domain axis)')
    : bad(`domain axis violated: applied=${out.applied} codes=${r.reasonCodes.length}`);
}

// ---------------------------------------------------------------------------
console.log(
  failures === 0
    ? '\n  PASS — WF-0069 language-aware intent self-check: all checks passed.\n'
    : `\n  FAIL — WF-0069 language-aware intent self-check: ${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
