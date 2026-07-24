#!/usr/bin/env node
/**
 * WF-0095 self-check (OP-0008, reuses ADR-0131) — bilingual classifier signals.
 *
 * WF-0069 made the *intent* classifier language-aware; WF-0095 extends the same
 * pattern to the rest of the fleet: deterministic pt-BR keyword coverage in the
 * signal tables + an accent-preserving tokenizer. This suite guards that work so a
 * pt user's request classifies the SAME as its English twin, and proves the change
 * stayed additive (no English verdict moved).
 *
 * Asserts (exit-gate Definition of Done):
 *   A. Tokenizer preserves accented tokens (`correção` → one token, not `corre`+`o`)
 *      and is byte-identical to the prior behaviour for ASCII-only input.
 *   B. STOPWORDS strip pt function words but NEVER an English content word.
 *   C. pt/en TIER parity via complexity-rubric (loaded from the TEMPLATE source,
 *      not the installed mirror at process.cwd()).
 *   D. pt/en WORK parity via classifyWork (nature + operationKind + valueIntent).
 *   E. Additive proof — a frozen English golden set keeps its exact prior verdict.
 *   F. Determinism — identical input → identical output.
 *
 * Standalone runnable: node tools/selfcheck-wf0095-bilingual-signals.mjs
 * Exit 0 = all pass, 1 = any failure. Zero deps — node:* + templates source.
 */
import { resolve, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dirname, '..');
const src = (rel) => pathToFileURL(resolve(KIT, 'templates/contextkit', rel)).href;
const srcPath = (rel) => resolve(KIT, 'templates/contextkit', rel);

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.error(`  ✗ ${m}`); failures += 1; };

let tokenize, STOPWORDS, classify, classifyWork, rubric;
try {
  ({ tokenize, STOPWORDS } = await import(src('runtime/execution/work-classify-signals.mjs')));
  ({ classify } = await import(src('tools/scripts/complexity-rubric.mjs')));
  ({ classifyWork } = await import(src('runtime/execution/work-classifier.mjs')));
  // Load the TEMPLATE rubric explicitly — loadRubric(cwd) would read the installed
  // mirror, which the source edits do not touch (see WF-0095 smoke-test note).
  rubric = JSON.parse(readFileSync(srcPath('policy/complexity-rubric.json'), 'utf-8').replace(/^﻿/, ''));
  ok('signal modules + template rubric import cleanly');
} catch (err) {
  console.error(`FATAL: import failed: ${err?.message ?? err}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// A. Tokenizer preserves accents
// ---------------------------------------------------------------------------
console.log('\n(A) tokenizer preserves accented tokens\n');
{
  for (const [word, sentence] of [
    ['correção', 'correção do bug'],
    ['migração', 'fazer a migração de dados'],
    ['análise', 'análise semântica'],
    ['refatoração', 'refatoração do módulo'],
  ]) {
    const toks = tokenize(sentence);
    toks.has(word)
      ? ok(`'${word}' survives as one token`)
      : bad(`'${word}' shattered: ${[...toks].join(',')}`);
  }
  // ASCII-only tokenization is unchanged (superset character class).
  const ascii = [...tokenize('add new endpoint validation')].sort().join(',');
  ascii === 'endpoint,validation'
    ? ok('ASCII-only tokenization unchanged')
    : bad(`ASCII tokenization drifted: ${ascii}`);
}

// ---------------------------------------------------------------------------
// B. STOPWORDS discipline
// ---------------------------------------------------------------------------
console.log('\n(B) STOPWORDS strip pt noise, never English content words\n');
{
  const ptNoise = ['que', 'para', 'como', 'você', 'então'];
  ptNoise.every((w) => STOPWORDS.has(w))
    ? ok('pt function words present in STOPWORDS')
    : bad('a pt function word is missing from STOPWORDS');
  // These English content words must NOT be stopworded (they carry meaning).
  const enContent = ['migrate', 'schema', 'refactor', 'endpoint', 'incident'];
  enContent.every((w) => !STOPWORDS.has(w))
    ? ok('no English content word was stopworded')
    : bad('an English content word leaked into STOPWORDS');
}

// ---------------------------------------------------------------------------
// C + D. pt/en parity through the real classifiers
// ---------------------------------------------------------------------------
console.log('\n(C+D) pt/en tier + work parity\n');
const PAIRS = [
  ['fix the login bug causing an outage', 'corrigir o bug de login causando uma queda'],
  ['add a new export report endpoint', 'adicionar um novo endpoint de relatório de exportação'],
  ['migrate the auth schema, breaking change', 'migrar o esquema de autenticação, quebra de compatibilidade'],
  ['investigate the root cause of the regression', 'investigar a causa raiz da regressão'],
  ['refactor and improve performance', 'refatorar e melhorar o desempenho'],
];
const tierOf = (t) => classify(t, rubric).tier;
const workOf = (t) => {
  const out = classifyWork(t);
  const w = out?.signals?.work ?? out ?? {};
  return `${w.nature}/${w.operationKind ?? w.kind}/${w.valueIntent}`;
};
for (const [en, pt] of PAIRS) {
  const tEn = tierOf(en); const tPt = tierOf(pt);
  const wEn = workOf(en); const wPt = workOf(pt);
  tEn === tPt
    ? ok(`tier parity [${tEn}] — "${pt.slice(0, 32)}…"`)
    : bad(`tier mismatch en=${tEn} pt=${tPt} — "${pt}"`);
  wEn === wPt
    ? ok(`work parity [${wEn}]`)
    : bad(`work mismatch en=${wEn} pt=${wPt} — "${pt}"`);
}

// ---------------------------------------------------------------------------
// E. Additive proof — English verdicts frozen
// ---------------------------------------------------------------------------
console.log('\n(E) additive: English verdicts unchanged\n');
{
  const FROZEN = [
    ['typo in the readme', 'trivial'],
    ['add a new report endpoint', 'feature'],
    ['migrate the database schema', 'architectural'],
  ];
  let allOk = true;
  for (const [txt, want] of FROZEN) {
    const got = tierOf(txt);
    if (got !== want) { allOk = false; bad(`'${txt}' expected ${want}, got ${got}`); }
  }
  if (allOk) ok('frozen English tier verdicts preserved');
}

// ---------------------------------------------------------------------------
// F. Determinism
// ---------------------------------------------------------------------------
console.log('\n(F) determinism\n');
{
  const probe = 'migrar o esquema de autenticação, quebra de compatibilidade';
  const a = JSON.stringify(classifyWork(probe));
  const b = JSON.stringify(classifyWork(probe));
  a === b ? ok('classifyWork is deterministic') : bad('classifyWork non-deterministic');
}

console.log('');
if (failures > 0) {
  console.error(`WF-0095 bilingual-signals: ${failures} failure(s).`);
  process.exit(1);
}
console.log('WF-0095 bilingual-signals: all checks passed.');
