#!/usr/bin/env node
/**
 * CDK-054 self-test — memory-score.mjs (PKG-05 BM25 lexical retrieval).
 *
 * Proves five invariants that distinguish BM25 from naive substring ranking:
 *   (1) TF advantage — more occurrences of the query term outrank a single hit.
 *   (2) Non-negative IDF — a term in ALL docs still yields idf > 0, score > 0.
 *   (3) Determinism — identical inputs → identical order; ties break by id ASC.
 *   (4) Empty query — all scores 0 in stable id-sorted order.
 *   (5) Default opts — k1 = 1.5, b = 0.75 as documented; both params live.
 * Zero deps, no fs writes. Run: `node tools/selfcheck-pkg05-054.mjs` (exit 0 = PASS).
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = resolve(__dirname, '../templates/contextkit/tools/scripts/memory-score.mjs');

let buildCorpusStats, bm25, scoreDocs, tokenize;
try {
  const mod = await import(pathToFileURL(MODULE_PATH).href);
  ({ buildCorpusStats, bm25, scoreDocs, tokenize } = mod);
} catch (err) {
  console.error(`FATAL: cannot import memory-score.mjs: ${err?.message ?? err}`);
  process.exit(1);
}

let failures = 0;
const ok = (msg) => console.log(`  ok  ${msg}`);
const bad = (msg) => { console.error(`  FAIL ${msg}`); failures += 1; };
/** Assert truthy; `detail` shown only on failure. */
function assert(label, cond, detail = '') { cond ? ok(label) : bad(`${label}${detail ? ' — ' + detail : ''}`); }

// Section 0 — export surface.
console.log('\nSection 0: export surface');
assert('buildCorpusStats exported as function', typeof buildCorpusStats === 'function');
assert('bm25 exported as function', typeof bm25 === 'function');
assert('scoreDocs exported as function', typeof scoreDocs === 'function');
assert('tokenize exported as function', typeof tokenize === 'function');

// Section 1 — TF advantage. doc-rich mentions "budget" 6×, doc-sparse 1×,
// doc-noise 0× (it sets corpus avgdl). Richer TF must win — naive boolean ties.
console.log('\nSection 1: TF advantage (BM25 outranks naive boolean)');
const corpusTF = [
  { id: 'doc-rich', tokens: tokenize('budget budget budget budget budget budget gate enforcement limit exceeded') },
  { id: 'doc-sparse', tokens: tokenize('budget gate enforcement limit exceeded threshold policy control') },
  { id: 'doc-noise', tokens: tokenize('session log context retrieval objective ADR decisions glossary hook runtime') },
];
const resultsTF = scoreDocs(tokenize('budget'), corpusTF);
assert('1a doc-rich ranks #1 (higher TF wins)', resultsTF[0]?.id === 'doc-rich', `got id=${resultsTF[0]?.id}`);
assert('1b doc-sparse ranks #2', resultsTF[1]?.id === 'doc-sparse', `got id=${resultsTF[1]?.id}`);
assert('1c doc-noise scores 0', resultsTF[2]?.score === 0, `got score=${resultsTF[2]?.score}`);
assert('1d score(doc-rich) > score(doc-sparse)', (resultsTF[0]?.score ?? 0) > (resultsTF[1]?.score ?? 0),
  `rich=${resultsTF[0]?.score?.toFixed(4)}, sparse=${resultsTF[1]?.score?.toFixed(4)}`);

// Section 2 — non-negative IDF for a term present in every document.
console.log('\nSection 2: non-negative IDF for universal term');
const corpusUniversal = [
  { id: 'u1', tokens: ['common', 'alpha', 'beta'] },
  { id: 'u2', tokens: ['common', 'gamma', 'delta'] },
  { id: 'u3', tokens: ['common', 'epsilon', 'zeta'] },
];
const statsUniversal = buildCorpusStats(corpusUniversal);
const scoreUniversal = bm25(['common'], corpusUniversal[0].tokens, statsUniversal);
assert('2a IDF is non-negative (no negative score for universal term)', scoreUniversal >= 0, `score=${scoreUniversal}`);
assert('2b Score > 0 even when term appears in every doc', scoreUniversal > 0, `score=${scoreUniversal}`);
assert('2c df[common] === N', statsUniversal.df.get('common') === statsUniversal.N,
  `df=${statsUniversal.df.get('common')}, N=${statsUniversal.N}`);

// Section 3 — determinism & tie-break by id ASC (identical content → tied scores).
console.log('\nSection 3: determinism & tie-breaking by id ASC');
const docsTie = [
  { id: 'zz-later', tokens: tokenize('context boot memory') },
  { id: 'aa-first', tokens: tokenize('context boot memory') },
  { id: 'mm-middle', tokens: tokenize('context boot memory') },
];
const run1 = scoreDocs(tokenize('context'), docsTie);
const run2 = scoreDocs(tokenize('context'), [...docsTie].reverse());
const ids1 = run1.map((r) => r.id).join(',');
assert('3a same output regardless of insertion order (run1 vs run2)', ids1 === run2.map((r) => r.id).join(','), ids1);
assert('3b tie-break: aa-first before mm-middle',
  run1.findIndex((r) => r.id === 'aa-first') < run1.findIndex((r) => r.id === 'mm-middle'), ids1);
assert('3c tie-break: mm-middle before zz-later',
  run1.findIndex((r) => r.id === 'mm-middle') < run1.findIndex((r) => r.id === 'zz-later'), ids1);
assert('3d tied docs have identical scores', run1[0].score === run1[1].score && run1[1].score === run1[2].score,
  run1.map((r) => r.score.toFixed(6)).join(', '));

// Section 4 — empty query → all scores 0, stable id-sorted order.
console.log('\nSection 4: empty query → all scores 0, stable id-sorted order');
const docsForEmpty = [
  { id: 'e-banana', tokens: tokenize('context memory session') },
  { id: 'e-apple', tokens: tokenize('context memory session') },
  { id: 'e-cherry', tokens: tokenize('context memory session') },
];
const emptyResult = scoreDocs([], docsForEmpty);
assert('4a result length equals corpus size', emptyResult.length === docsForEmpty.length, `got ${emptyResult.length}`);
assert('4b all scores are 0 for empty query', emptyResult.every((r) => r.score === 0));
const expectedEmptyIds = [...docsForEmpty].sort((a, b) => (a.id < b.id ? -1 : 1)).map((d) => d.id).join(',');
assert('4c stable order by id ASC when all scores 0', emptyResult.map((r) => r.id).join(',') === expectedEmptyIds);
assert('4d bm25() with empty queryTokens returns 0',
  bm25([], docsForEmpty[0].tokens, buildCorpusStats(docsForEmpty)) === 0);

// Section 5 — default opts (k1=1.5, b=0.75) and that both params are live.
// docsOpts lengths 4 and 10 → avgdl 7, so b is non-degenerate.
console.log('\nSection 5: default k1/b values match JSDoc (k1=1.5, b=0.75)');
const docsOpts = [
  { id: 'o1', tokens: tokenize('token budget gate enforcement') },
  { id: 'o2', tokens: tokenize('budget budget token retrieval context session objective log memory hook') },
];
const statsOpts = buildCorpusStats(docsOpts);
const queryOpts = tokenize('budget token');
assert('5a bm25() no opts === explicit k1=1.5,b=0.75',
  bm25(queryOpts, docsOpts[0].tokens, statsOpts) === bm25(queryOpts, docsOpts[0].tokens, statsOpts, { k1: 1.5, b: 0.75 }));
assert('5b k1=0.5 differs from k1=1.5 (param is live)',
  bm25(queryOpts, docsOpts[1].tokens, statsOpts, { k1: 0.5, b: 0.75 }) !== bm25(queryOpts, docsOpts[1].tokens, statsOpts));
assert('5c b=0.0 vs b=1.0 differ when doc length ≠ avgdl',
  bm25(queryOpts, docsOpts[0].tokens, statsOpts, { k1: 1.5, b: 0.0 }) !== bm25(queryOpts, docsOpts[0].tokens, statsOpts, { k1: 1.5, b: 1.0 }));

// Section 6 — edge cases (fail-open, no throws).
console.log('\nSection 6: edge cases (fail-open, no throws)');
try { assert('6a empty corpus → []', scoreDocs(tokenize('budget'), []).length === 0); }
catch (err) { bad(`6a empty corpus threw: ${err?.message ?? err}`); }
try {
  const s = buildCorpusStats([]);
  assert('6b buildCorpusStats([]) → N=0', s.N === 0);
  assert('6c buildCorpusStats([]) → avgdl=0', s.avgdl === 0);
} catch (err) { bad(`6b/6c buildCorpusStats([]) threw: ${err?.message ?? err}`); }
try {
  assert('6d bm25 with empty docTokens → 0',
    bm25(['hello'], [], buildCorpusStats([{ id: 'x', tokens: ['hello'] }])) === 0);
} catch (err) { bad(`6d bm25(emptyDoc) threw: ${err?.message ?? err}`); }
try { assert('6e bm25(null, null) → 0 (no throw)', bm25(null, null, { df: new Map(), avgdl: 0, N: 0 }) === 0); }
catch (err) { bad(`6e bm25(null,null) threw: ${err?.message ?? err}`); }
try { assert('6f buildCorpusStats(null) → N=0 (no throw)', buildCorpusStats(null).N === 0); }
catch (err) { bad(`6f buildCorpusStats(null) threw: ${err?.message ?? err}`); }

console.log(failures === 0
  ? '\nPASS — selfcheck-pkg05-054 all checks green.\n'
  : `\nFAIL — ${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
