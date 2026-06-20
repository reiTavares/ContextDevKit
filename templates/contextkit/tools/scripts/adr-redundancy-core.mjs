/**
 * ADR Redundancy detection passes — pure functions (BIZ-0001 / WF-0037, B4-T1).
 *
 * Extracted from `adr-redundancy.mjs` at the SRP seam: detection algorithms
 * vs orchestration + CLI. Each detection pass is independent and testable in
 * isolation.
 *
 * Zero runtime dependencies — `node:*` only. No I/O — callers supply rows.
 */

// ---------------------------------------------------------------------------
// Internal scoring helpers
// ---------------------------------------------------------------------------

/** Tokenise a string into a Set of lowercase words. */
export function tokenize(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean),
  );
}

/**
 * Jaccard similarity between two token sets.
 *
 * @param {Set<string>} setA
 * @param {Set<string>} setB
 * @returns {number} value in [0, 1].
 */
export function jaccard(setA, setB) {
  if (!setA.size && !setB.size) return 1;
  if (!setA.size || !setB.size) return 0;
  let intersect = 0;
  for (const token of setA) {
    if (setB.has(token)) intersect += 1;
  }
  return intersect / (setA.size + setB.size - intersect);
}

/** Normalise a slug for similarity comparison (strip numbers, collapse separators). */
export function normalizeSlug(slug) {
  return String(slug || '')
    .toLowerCase()
    .replace(/\d+/g, '')
    .replace(/[-_]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// Detection passes — each takes unified rows and returns finding descriptors
// ---------------------------------------------------------------------------

/**
 * Pass 1 — exact id duplicates across all rows.
 *
 * @param {object[]} allRows - unified legacy + new row list.
 * @returns {object[]} finding descriptors.
 */
export function detectIdDuplicates(allRows) {
  const byId = new Map();
  for (const row of allRows) {
    const key = row.id ?? '(no-id)';
    if (!byId.has(key)) byId.set(key, []);
    byId.get(key).push(row);
  }
  const findings = [];
  for (const [id, rows] of byId) {
    if (rows.length > 1) {
      findings.push({
        kind: 'exact-id-duplicate',
        id,
        paths: rows.map((r) => r.path || r.absolutePath || '?'),
        message: `ADR id "${id}" appears in ${rows.length} files.`,
      });
    }
  }
  return findings;
}

/**
 * Pass 2 — slug similarity (identical normalised slug or one-is-prefix).
 *
 * @param {object[]} allRows
 * @returns {object[]} finding descriptors.
 */
export function detectSlugSimilarity(allRows) {
  const findings = [];
  for (let i = 0; i < allRows.length; i += 1) {
    const slugA = normalizeSlug(allRows[i].slug || allRows[i].id || '');
    if (!slugA) continue;
    for (let j = i + 1; j < allRows.length; j += 1) {
      const slugB = normalizeSlug(allRows[j].slug || allRows[j].id || '');
      if (!slugB) continue;
      if (
        slugA === slugB ||
        (slugA.length > 4 && (slugB.startsWith(slugA) || slugA.startsWith(slugB)))
      ) {
        findings.push({
          kind: 'slug-similarity',
          idA: allRows[i].id,
          idB: allRows[j].id,
          slugA,
          slugB,
          message: `"${allRows[i].id}" and "${allRows[j].id}" have similar slugs.`,
        });
      }
    }
  }
  return findings;
}

/**
 * Pass 3 — title token overlap (Jaccard ≥ threshold).
 *
 * @param {object[]} allRows
 * @param {number}   threshold - Jaccard cutoff (default 0.6).
 * @returns {object[]} finding descriptors.
 */
export function detectTitleOverlap(allRows, threshold = 0.6) {
  const findings = [];
  const withTitles = allRows.filter((r) => r.title);
  for (let i = 0; i < withTitles.length; i += 1) {
    const tokA = tokenize(withTitles[i].title);
    if (tokA.size < 2) continue;
    for (let j = i + 1; j < withTitles.length; j += 1) {
      const tokB = tokenize(withTitles[j].title);
      if (tokB.size < 2) continue;
      const score = jaccard(tokA, tokB);
      if (score >= threshold) {
        findings.push({
          kind: 'title-overlap',
          idA: withTitles[i].id,
          idB: withTitles[j].id,
          titleA: withTitles[i].title,
          titleB: withTitles[j].title,
          jaccardScore: Math.round(score * 100) / 100,
          message: `"${withTitles[i].id}" and "${withTitles[j].id}" have similar titles (Jaccard ${Math.round(score * 100)}%).`,
        });
      }
    }
  }
  return findings;
}

/**
 * Pass 4 — valueIntent + context + kind triple overlap (new-format rows only).
 * Flags pairs sharing `primaryContext.type::primaryContext.id::decisionKind::valueIntents.primary`.
 *
 * @param {object[]} newRows - new-format registry rows.
 * @returns {object[]} finding descriptors.
 */
export function detectValueIntentOverlap(newRows) {
  const findings = [];
  const keyed = newRows.map((r) => {
    const pc = r.primaryContext && typeof r.primaryContext === 'object' ? r.primaryContext : {};
    const vi = r.valueIntents && typeof r.valueIntents === 'object' ? r.valueIntents : {};
    return {
      row: r,
      key: [pc.type ?? '', pc.id ?? '', r.decisionKind ?? '', vi.primary ?? ''].join('::'),
    };
  });

  for (let i = 0; i < keyed.length; i += 1) {
    if (!keyed[i].key || keyed[i].key === '::::') continue;
    for (let j = i + 1; j < keyed.length; j += 1) {
      if (keyed[i].key === keyed[j].key) {
        findings.push({
          kind: 'value-intent-overlap',
          idA: keyed[i].row.id,
          idB: keyed[j].row.id,
          triple: keyed[i].key,
          message: `"${keyed[i].row.id}" and "${keyed[j].row.id}" share the same context+kind+intent triple.`,
        });
      }
    }
  }
  return findings;
}
