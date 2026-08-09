/**
 * EACP-08 Repeated-Read + Project-Map Effectiveness Analyzer — SPEC §D
 *
 * Advisory-only module. Consumes NORMALIZED tool-call METADATA events (tool
 * name + path, never transcript message content — the extractor lives in
 * token-report.mjs) and reports:
 *   - observed repeated-read facts (which files were re-opened, how often)
 *   - project-map ROI framing (broad searches before vs. files opened after)
 *
 * Design invariants:
 *   - METADATA-ONLY: this module never reads transcript message content
 *     (ADR-0081 §metadata-only). Input is `{ tool, path?, ts? }` event objects.
 *   - PRIVACY (ADR-0081): all file paths MUST be redacted via redactPath before
 *     being stored in any output field. Raw paths never appear in the report.
 *   - DETERMINISTIC: no Date.now() / Math.random() calls. Same input → same
 *     output. When ts fields are present they drive ordering; otherwise original
 *     order is preserved — tie-breaking by original index keeps stable sort.
 *   - SKIPPED-NOT-PASSED (constitution §8): when tool-call metadata is absent
 *     or empty, callers receive skipped() — we never fabricate observations.
 *   - ADVISORY: output carries a human-readable note field; callers MUST NOT
 *     bill or penalize based on this report alone.
 *
 * Cohesion note (280-line budget): all concerns (guard, sort, count, format)
 * are tightly coupled to the single "effectiveness" computation; splitting would
 * require passing state that is pure intermediate work with no external consumer.
 */

import { redactPath, resolvePrivacyConfig, skipped } from './privacy.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Schema version for consumers to detect structural changes in the return value.
 * Bump the minor version when fields are added; bump the major when removed or
 * renamed. Callers should guard on this string before destructuring the result.
 *
 * @type {string}
 */
export const MAP_EFFECTIVENESS_SCHEMA_VERSION = 'eacp-map-effectiveness/1';

/**
 * The set of normalized tool-kind strings this module understands.
 * Anything outside this set is silently ignored during event classification.
 *
 * @type {Readonly<string[]>}
 */
export const TOOL_KINDS = Object.freeze(['read', 'search', 'map']);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when every element of `events` has a finite numeric `ts` field.
 * Used to decide whether a timestamp-based sort is safe — a single missing ts
 * causes us to fall back to original order so partial data is never silently
 * mis-ordered.
 *
 * @param {Array<{ts?: unknown}>} events
 * @returns {boolean}
 */
function allHaveFiniteTs(events) {
  return events.every(ev => typeof ev.ts === 'number' && Number.isFinite(ev.ts));
}

/**
 * Returns a stable copy of `events` sorted by ts ascending.
 * Tie-breaking by original index preserves insertion order for same-ts events,
 * which is the only deterministic tie-break when timestamps collide.
 *
 * @param {Array<object>} events - Raw events that ALL have a finite ts.
 * @returns {Array<object>} Sorted copy (original array is NOT mutated).
 */
function sortByTs(events) {
  return events
    .map((ev, originalIndex) => ({ ev, originalIndex }))
    .sort((a, b) => a.ev.ts - b.ev.ts || a.originalIndex - b.originalIndex)
    .map(({ ev }) => ev);
}

/**
 * Builds a `{ [redactedPath]: count }` map over read events that carry a
 * string `path`. Events without a path contribute to totalReads but are not
 * keyed in this map — callers should account for that gap.
 *
 * @param {Array<{tool: string, path?: string}>} readEvents
 * @param {ReturnType<import('./privacy.mjs').resolvePrivacyConfig>} resolved
 * @returns {Record<string, number>}
 */
function buildPerFileReadCount(readEvents, resolved) {
  const counts = Object.create(null);
  for (const ev of readEvents) {
    if (typeof ev.path !== 'string') continue;
    const key = redactPath(ev.path, resolved);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * Extracts entries with count ≥ 2, sorted DESC by count then ASC by path.
 * Limited to the top 5 entries to keep the observedFacts list actionable.
 *
 * @param {Record<string, number>} perFileReadCount
 * @returns {Array<{path: string, count: number}>}
 */
function extractRepeatedReads(perFileReadCount) {
  return Object.entries(perFileReadCount)
    .filter(([, count]) => count >= 2)
    .sort(([pathA, countA], [pathB, countB]) =>
      countB - countA || pathA.localeCompare(pathB)
    )
    .slice(0, 5)
    .map(([path, count]) => ({ path, count }));
}

/**
 * Builds the human-readable observed-facts array.
 * Every string starts with "Observed:" for directly counted facts, separating
 * them from any downstream estimates. No estimates or inferences are emitted here.
 *
 * @param {object} params
 * @param {number} params.totalReads
 * @param {number} params.distinctFiles
 * @param {Array<{path: string, count: number}>} params.repeatedReads
 * @param {boolean} params.mapConsulted
 * @param {number} params.broadSearchesBeforeMap
 * @param {number} params.filesOpenedAfterMap
 * @param {number} params.searchCount
 * @returns {string[]}
 */
function buildObservedFacts({
  totalReads,
  distinctFiles,
  repeatedReads,
  mapConsulted,
  broadSearchesBeforeMap,
  filesOpenedAfterMap,
  searchCount,
}) {
  const facts = [`Observed: ${totalReads} read(s) across ${distinctFiles} file(s)`];

  for (const { path, count } of repeatedReads) {
    facts.push(`Observed: file ${path} read ${count}×`);
  }

  if (mapConsulted) {
    facts.push(
      `Observed: ${broadSearchesBeforeMap} broad search(es) before project-map; ` +
      `${filesOpenedAfterMap} file(s) opened after`
    );
  } else {
    facts.push(
      `Observed: project-map not consulted; ${searchCount} broad search(es) ran without it`
    );
  }

  return facts;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Computes observed repeated-read and project-map effectiveness facts from
 * normalized tool-call metadata events.
 *
 * The function is PURE and DETERMINISTIC: given the same `toolEvents` array
 * (and the same privacy config) it always returns the identical object. It
 * never calls Date.now(), Math.random(), or any I/O function.
 *
 * When `toolEvents` is empty or not an array, the function returns the skipped()
 * marker (constitution §8 — skipped, not passed). All paths in the return value
 * are redacted per ADR-0081.
 *
 * @param {Array<{tool: 'read'|'search'|'map', path?: string, ts?: number}>} toolEvents
 *   Normalized tool-call metadata events. Only events whose `tool` field is in
 *   TOOL_KINDS are classified; others are ignored. The input array is never
 *   mutated.
 * @param {{ privacy?: ReturnType<import('./privacy.mjs').resolvePrivacyConfig> }} [opts]
 *   Optional options bag. `opts.privacy`, when provided, must already be a
 *   resolved config object (from resolvePrivacyConfig); otherwise defaults are
 *   used. No other options are currently read.
 * @returns {{
 *   schemaVersion: string,
 *   totalReads: number,
 *   distinctFiles: number,
 *   perFileReadCount: Record<string, number>,
 *   repeatedReads: Array<{path: string, count: number}>,
 *   searchCount: number,
 *   mapConsulted: boolean,
 *   mapBeforeExploration: boolean,
 *   broadSearchesBeforeMap: number,
 *   filesOpenedAfterMap: number,
 *   fullMapVsFocused: null,
 *   rangedReadCount: null,
 *   bytesReturnedAvailable: false,
 *   readAfterUnchangedCount: null,
 *   estimatedReadSaving: { confidence: 'unknown', reason: string },
 *   roiDirection: { confidence: 'unknown', reason: string },
 *   confidence: 'derived',
 *   observedFacts: string[],
 *   note: string,
 * } | Readonly<{status: 'skipped', reason: string}>}
 */
export function readFacts(toolEvents, opts) {
  // Guard: skipped marker when metadata is absent — NEVER fabricate observations.
  if (!Array.isArray(toolEvents) || toolEvents.length === 0) {
    return skipped('no tool-call metadata observed — map-effectiveness unavailable');
  }

  // Privacy config: accept a pre-resolved object from caller or fall back to
  // defaults. This avoids re-reading project config on every call when the
  // parent already resolved it once for the whole session report.
  const resolved = opts?.privacy ?? resolvePrivacyConfig(null);

  // Ordering (deterministic): only sort by ts when EVERY event has a finite ts.
  // A single missing ts means we cannot trust partial ordering, so we fall back
  // to the original array order to avoid silently reordering events.
  const ordered = allHaveFiniteTs(toolEvents)
    ? sortByTs(toolEvents)
    : [...toolEvents];

  // Locate the first project-map consultation in the ordered stream.
  const firstMapIndex = ordered.findIndex(ev => ev.tool === 'map');
  const mapConsulted = firstMapIndex >= 0;

  // Classify events by kind using their position in the ordered array.
  const reads = ordered.filter(ev => ev.tool === 'read');
  const searches = ordered.filter(ev => ev.tool === 'search');

  // Repeated-read analysis: count per redacted path, extract those seen ≥ 2×.
  const perFileReadCount = buildPerFileReadCount(reads, resolved);
  const repeatedReads = extractRepeatedReads(perFileReadCount);
  const distinctFiles = Object.keys(perFileReadCount).length;
  const totalReads = reads.length;
  const searchCount = searches.length;

  // Map-ROI framing: how many broad searches ran BEFORE the map was consulted,
  // and how many files were opened AFTER. When no map event was observed, the
  // "before" count equals the total (all searches lacked map context) and the
  // "after" count is 0 (there was no "after" milestone to measure from).
  const broadSearchesBeforeMap = mapConsulted
    ? ordered.filter((ev, idx) => ev.tool === 'search' && idx < firstMapIndex).length
    : searchCount;

  const filesOpenedAfterMap = mapConsulted
    ? ordered.filter((ev, idx) => ev.tool === 'read' && idx > firstMapIndex).length
    : 0;

  const observedFacts = buildObservedFacts({
    totalReads,
    distinctFiles,
    repeatedReads,
    mapConsulted,
    broadSearchesBeforeMap,
    filesOpenedAfterMap,
    searchCount,
  });

  // mapBeforeExploration: true when at least one search occurred before the first
  // project-map consultation. Derived directly from broadSearchesBeforeMap.
  const mapBeforeExploration = mapConsulted && broadSearchesBeforeMap === 0;

  return {
    schemaVersion: MAP_EFFECTIVENESS_SCHEMA_VERSION,
    totalReads,
    distinctFiles,
    // Full per-file read-count map (redacted paths). Callers needing the complete
    // breakdown (not just the top-5 repeatedReads) may consume this directly.
    perFileReadCount,
    repeatedReads,
    searchCount,
    mapConsulted,
    // true when project-map was consulted BEFORE any broad searches — the ideal
    // "map first, then explore" pattern. false when searches preceded the map or
    // the map was not consulted at all.
    mapBeforeExploration,
    broadSearchesBeforeMap,
    filesOpenedAfterMap,
    // Fields unavailable in current event schema — null = recognized but unsupported,
    // never fabricated (constitution §8). 'unknown' confidence = no counterfactual.
    fullMapVsFocused: null,          // events carry no focused/full-map distinction
    rangedReadCount: null,           // events carry no ranged-read flag
    bytesReturnedAvailable: false,   // events carry no byte-count field
    readAfterUnchangedCount: null,   // no file-system change-tracking in metadata
    estimatedReadSaving: {
      confidence: 'unknown',
      reason: 'no counterfactual baseline — cannot assert tokens saved by map usage',
    },
    roiDirection: {
      confidence: 'unknown',
      reason: 'no benchmark — ROI direction unconfirmed; use observed facts only',
    },
    // 'derived': counts are directly observed from metadata; the map-ROI
    // framing is a computed ratio, not a model inference. This is a stronger
    // signal than 'inferred' but weaker than 'measured' (which would require
    // ground-truth session outcomes).
    confidence: 'derived',
    observedFacts,
    note: 'Observed facts from tool-call metadata; advisory, not billed.',
  };
}
