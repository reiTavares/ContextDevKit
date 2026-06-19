/**
 * work-classify-signals.mjs — pure scoring primitives for the A2 methodology
 * classifiers (BIZ-0001 / WF-0036, governed by ADR-0102).
 *
 * These are the deterministic building blocks the engine (`work-classifier.mjs`)
 * composes. They know NOTHING about the policy file layout, the enums, or the
 * `signals.work` output shape — they only score a lowercased text against a
 * category table and resolve ties stably (design §4). No `Math.random`, no time,
 * no floats beyond integer sums → identical input always yields identical output.
 *
 * Zero runtime dependencies — plain functions over `node:*`-free data.
 */

/**
 * Scores one category's signal list against an already-lowercased text.
 * `score = Σ weight` over every signal whose `s` is a substring of `text`
 * (the same `text.includes(s)` rule as `complexity-rubric.mjs.hasAny`).
 *
 * @param {string} text - the lowercased request text.
 * @param {Array<{s: string, w: number}>} signals - the category's signal rows.
 * @returns {{ score: number, matched: string[], topWeight: number }}
 *   total score, the matched substrings (in policy order), and the single
 *   highest matched weight (used by the tie-break).
 */
export function scoreCategory(text, signals) {
  let score = 0;
  let topWeight = 0;
  const matched = [];
  if (!Array.isArray(signals)) return { score, matched, topWeight };
  for (const row of signals) {
    if (!row || typeof row.s !== 'string') continue;
    const needle = row.s.toLowerCase();
    if (!needle || !text.includes(needle)) continue;
    const weight = Number.isFinite(row.w) ? row.w : 0;
    score += weight;
    if (weight > topWeight) topWeight = weight;
    matched.push(row.s);
  }
  return { score, matched, topWeight };
}

/**
 * Scores every category in a `{ name → signals[] }` table.
 *
 * @param {string} text - lowercased request text.
 * @param {Record<string, Array<{s: string, w: number}>>} table - category map.
 * @returns {Array<{ name: string, score: number, matched: string[], topWeight: number }>}
 *   one entry per category, in the table's insertion (JSON key) order.
 */
export function scoreTable(text, table) {
  const entries = [];
  for (const [name, signals] of Object.entries(table || {})) {
    const scored = scoreCategory(text, signals);
    entries.push({ name, ...scored });
  }
  return entries;
}

/**
 * Picks the winning category with the deterministic tie-break of design §4:
 *   a. higher total score wins;
 *   b. on equal score, the higher single matched weight wins (a strong specific
 *      hit beats many weak ones);
 *   c. still tied → the declared `precedence` order if given, else the table's
 *      JSON key order (stable — `scoreTable` preserves insertion order).
 * When no category scores above zero, returns `null` so the caller can apply its
 * own default (refuse-to-default / refuse-to-null per the constitution §8).
 *
 * @param {Array<{ name: string, score: number, topWeight: number }>} scored -
 *   the output of `scoreTable`.
 * @param {string[]} [precedence] - optional explicit precedence order for step c.
 * @returns {{ winner: object, tieBreak: string|null } | null}
 *   the winning entry plus which tie-break rule decided it, or `null` on no match.
 */
export function pickWinner(scored, precedence = []) {
  const positive = scored.filter((entry) => entry.score > 0);
  if (positive.length === 0) return null;

  const maxScore = Math.max(...positive.map((entry) => entry.score));
  let contenders = positive.filter((entry) => entry.score === maxScore);
  if (contenders.length === 1) return { winner: contenders[0], tieBreak: null };

  const maxTopWeight = Math.max(...contenders.map((entry) => entry.topWeight));
  const byWeight = contenders.filter((entry) => entry.topWeight === maxTopWeight);
  if (byWeight.length === 1) return { winner: byWeight[0], tieBreak: 'topWeight' };
  contenders = byWeight;

  if (Array.isArray(precedence) && precedence.length > 0) {
    for (const name of precedence) {
      const hit = contenders.find((entry) => entry.name === name);
      if (hit) return { winner: hit, tieBreak: 'precedence' };
    }
  }
  // Fall back to the first contender in stable (insertion) order.
  return { winner: contenders[0], tieBreak: 'keyOrder' };
}

/**
 * Selects secondary categories whose score is within `margin` of the winner and
 * at least 1 (design §4.6 — mirrors `valueIntents.secondary`). Deduped, capped at
 * `cap`, ordered by score desc then stable key order.
 *
 * @param {Array<{ name: string, score: number }>} scored - `scoreTable` output.
 * @param {string} winnerName - the already-chosen primary, excluded from results.
 * @param {number} margin - max score gap from the winner to qualify.
 * @param {number} [cap] - maximum secondaries to return (default 2).
 * @returns {string[]} secondary category names.
 */
export function pickSecondary(scored, winnerName, margin, cap = 2) {
  const winner = scored.find((entry) => entry.name === winnerName);
  const winnerScore = winner ? winner.score : 0;
  const ranked = scored
    .map((entry, index) => ({ ...entry, index }))
    .filter(
      (entry) =>
        entry.name !== winnerName &&
        entry.score >= 1 &&
        winnerScore - entry.score <= margin,
    )
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked.slice(0, Math.max(0, cap)).map((entry) => entry.name);
}

/**
 * Frozen stopword list for the matcher's token-overlap (design §8.2). Kept small
 * and deterministic — NOT embeddings. Exported here so the matcher (A2-T2) and
 * any future tokenizer share ONE source.
 * @type {ReadonlySet<string>}
 */
export const STOPWORDS = Object.freeze(
  new Set([
    'the', 'a', 'an', 'to', 'of', 'and', 'or', 'in', 'on', 'for', 'with',
    'at', 'by', 'from', 'as', 'is', 'are', 'be', 'this', 'that', 'it',
    'add', 'fix', 'new', 'every', 'all',
  ]),
);

/**
 * Tokenizes free text into a deterministic lowercased word set, stopwords
 * stripped (matcher token-overlap helper, design §8.2).
 *
 * @param {string} text - free text (objective, title, slug).
 * @returns {Set<string>} the unique non-stopword tokens (length ≥ 2).
 */
export function tokenize(text) {
  const tokens = String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
  return new Set(tokens);
}
