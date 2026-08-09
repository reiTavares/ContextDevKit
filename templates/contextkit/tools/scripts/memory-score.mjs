#!/usr/bin/env node
/**
 * Zero-dependency BM25 lexical retrieval scoring (CDK-054, PKG-05).
 *
 * WHY: the substring-hit scoring in memory-retrieve.mjs treats every match
 * equally — a doc mentioning "budget" once scores the same as one that
 * discusses it in depth. BM25 introduces term-frequency saturation (k1)
 * and length normalisation (b) so that exhaustive coverage of a term beats
 * a single incidental mention, while very long documents are not
 * unfairly rewarded.
 *
 * This module is purely functional — no I/O, no global state.
 * It can be imported by memory-retrieve.mjs or any other consumer without
 * pulling in runtime dependencies.
 *
 * IDF variant used (non-negative, Robertson & Zaragoza 2009):
 *   idf(t) = ln(1 + (N − df(t) + 0.5) / (df(t) + 0.5))
 *
 * Default BM25 hyper-parameters (OKAPI BM25 empirical sweet-spot):
 *   k1 = 1.5  — term-frequency saturation; higher = more TF weight
 *   b  = 0.75 — length normalisation strength; 0 = off, 1 = full
 *
 * @module memory-score
 */

// ---------------------------------------------------------------------------
// Inline tokenizer — identical to tokenize() in memory-retrieve.mjs so this
// module stays zero-dependency even when imported in isolation. Consumers that
// already have the token array should pass it directly; this is only for the
// convenience overload in scoreDocs when building corpus stats.
// ---------------------------------------------------------------------------

/**
 * Tokenizes a string into lowercase content tokens (≥ 3 chars).
 * Mirrors the tokenize() function in memory-retrieve.mjs.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  return String(text || '').toLowerCase().match(/[a-z0-9][a-z0-9._/-]{2,}/g) || [];
}

// ---------------------------------------------------------------------------
// Corpus statistics
// ---------------------------------------------------------------------------

/**
 * Computes per-corpus statistics needed by BM25 from a flat array of
 * pre-tokenised documents.
 *
 * @param {Array<{id: string, tokens: string[]}>} docs
 * @returns {{ df: Map<string,number>, avgdl: number, N: number }}
 *   df     — document frequency: how many docs contain each term (at least once)
 *   avgdl  — average document length in tokens across the corpus
 *   N      — total number of documents
 */
export function buildCorpusStats(docs) {
  if (!Array.isArray(docs) || docs.length === 0) {
    return { df: new Map(), avgdl: 0, N: 0 };
  }

  const df = new Map();
  let totalLength = 0;

  for (const doc of docs) {
    const tokens = Array.isArray(doc.tokens) ? doc.tokens : [];
    totalLength += tokens.length;
    // Count each term at most once per document (document frequency, not TF).
    for (const term of new Set(tokens)) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  return {
    df,
    avgdl: totalLength / docs.length,
    N: docs.length,
  };
}

// ---------------------------------------------------------------------------
// BM25 scoring
// ---------------------------------------------------------------------------

/**
 * Computes the BM25 relevance score between a query and a single document.
 *
 * Formula (per query term t):
 *   idf(t) = ln(1 + (N − df(t) + 0.5) / (df(t) + 0.5))
 *   tf_norm = tf(t,d) * (k1 + 1) / (tf(t,d) + k1 * (1 − b + b * |d| / avgdl))
 *   score   = Σ  idf(t) * tf_norm(t, d)
 *
 * This uses the non-negative IDF variant: when a term appears in every
 * document, the numerator becomes 0.5 and the denominator is (N + 0.5),
 * yielding a small positive value rather than 0 or negative.
 *
 * @param {string[]} queryTokens  — pre-tokenised query terms
 * @param {string[]} docTokens    — pre-tokenised document terms
 * @param {{ df: Map<string,number>, avgdl: number, N: number }} corpusStats
 * @param {{ k1?: number, b?: number }} [opts]
 *   k1 — term-frequency saturation constant (default 1.5).
 *        Higher values give more weight to repeated occurrences of a term.
 *   b  — document length normalisation factor (default 0.75).
 *        0 = no normalisation, 1 = full normalisation against avgdl.
 * @returns {number}
 */
export function bm25(queryTokens, docTokens, corpusStats, opts = {}) {
  const k1 = opts.k1 ?? 1.5;
  const b = opts.b ?? 0.75;
  const { df, avgdl, N } = corpusStats;

  if (!Array.isArray(queryTokens) || queryTokens.length === 0) return 0;
  if (!Array.isArray(docTokens) || docTokens.length === 0) return 0;
  if (N === 0) return 0;

  // Build a term-frequency map for this document (O(|doc|), computed once).
  const tf = new Map();
  for (const term of docTokens) {
    tf.set(term, (tf.get(term) ?? 0) + 1);
  }

  const docLen = docTokens.length;
  const lenNorm = 1 - b + b * (docLen / (avgdl || 1));

  let score = 0;
  for (const term of queryTokens) {
    const termTf = tf.get(term) ?? 0;
    if (termTf === 0) continue; // Term not in document — contributes nothing.

    const termDf = df.get(term) ?? 0;
    // Non-negative IDF (Robertson & Zaragoza 2009).
    // When df = N the ratio becomes 0.5/(N+0.5), small-positive, never zero.
    const idf = Math.log(1 + (N - termDf + 0.5) / (termDf + 0.5));

    const tfNorm = (termTf * (k1 + 1)) / (termTf + k1 * lenNorm);

    score += idf * tfNorm;
  }

  return score;
}

// ---------------------------------------------------------------------------
// Convenience scorer over a corpus
// ---------------------------------------------------------------------------

/**
 * Scores every document in `docs` against `queryTokens` using BM25 and
 * returns the results sorted by score descending, ties broken by `id`
 * ascending (lexicographic) for determinism.
 *
 * Corpus statistics are built internally from `docs`, so this function is
 * the single call-site for callers that do not cache stats across queries.
 *
 * @param {string[]} queryTokens  — pre-tokenised query terms
 * @param {Array<{id: string, tokens: string[]}>} docs
 * @param {{ k1?: number, b?: number }} [opts]  — forwarded to bm25()
 * @returns {Array<{id: string, score: number}>}  — sorted DESC by score, ASC by id on ties
 */
export function scoreDocs(queryTokens, docs, opts = {}) {
  if (!Array.isArray(docs) || docs.length === 0) return [];

  const corpusStats = buildCorpusStats(docs);

  const scored = docs.map((doc) => ({
    id: doc.id,
    score: bm25(queryTokens, Array.isArray(doc.tokens) ? doc.tokens : [], corpusStats, opts),
  }));

  // Primary sort: score DESC. Tie-break: id ASC (lexicographic) for determinism.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return scored;
}
