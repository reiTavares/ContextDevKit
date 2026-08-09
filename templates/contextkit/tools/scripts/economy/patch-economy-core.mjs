/**
 * patch-economy-core.mjs — Pure assessment logic for the patch-economy signal
 * (WF0020, CDK-263 ECON-10).
 *
 * WHY split from patch-economy.mjs: the CI check export + JSDoc in the
 * orchestrating file would breach the 308-line constitution ceiling (§1 +10%).
 * This file holds all pure computation (helpers + assessPatchEconomy) so both
 * files stay within budget.
 *
 * Exports consumed by patch-economy.mjs:
 *   assessPatchEconomy, LARGE_FILE_THRESHOLD_BYTES, SUGGEST_PATCH_CHANGE_RATIO
 *
 * Advisory + fail-open: no export throws on bad input.
 * Zero runtime dependencies — node:* only.
 */

// ---------------------------------------------------------------------------
// Tuning constants (exported so orchestrator can surface them in checks)
// ---------------------------------------------------------------------------

/** Files smaller than this are cheap to rewrite; no patch suggestion. */
export const LARGE_FILE_THRESHOLD_BYTES = 2048;

/**
 * changedRatio below this triggers a patch suggestion.
 * 0.30 = if < 30 % of content actually changed, prefer Edit over Write.
 */
export const SUGGEST_PATCH_CHANGE_RATIO = 0.30;

/**
 * Bytes-per-token approximation for estimatedWaste (advisory display only).
 * Conservative: ~4 bytes/token avoids overstating savings.
 */
const APPROX_BYTES_PER_TOKEN = 4;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Splits a string into a Set of trimmed, non-empty lines.
 * @param {string} text
 * @returns {Set<string>}
 * @private
 */
function lineSet(text) {
  const lines = new Set();
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim();
    if (trimmed.length > 0) lines.add(trimmed);
  }
  return lines;
}

/**
 * Computes line-set Jaccard similarity: |intersection| / |union|.
 * Returns a value in [0, 1]; 1 = identical, 0 = no shared lines.
 *
 * @param {string} textA
 * @param {string} textB
 * @returns {number}
 * @private
 */
function jaccardSimilarity(textA, textB) {
  const setA = lineSet(textA);
  const setB = lineSet(textB);

  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersectionCount = 0;
  for (const line of setA) {
    if (setB.has(line)) intersectionCount++;
  }

  const unionCount = setA.size + setB.size - intersectionCount;
  return unionCount === 0 ? 1 : intersectionCount / unionCount;
}

/**
 * Fallback similarity for short/single-line content: shared character prefix
 * length divided by max length.
 *
 * @param {string} textA
 * @param {string} textB
 * @returns {number} similarity in [0, 1]
 * @private
 */
function charPrefixSimilarity(textA, textB) {
  const maxLen = Math.max(textA.length, textB.length);
  if (maxLen === 0) return 1;
  let commonLen = 0;
  const limit = Math.min(textA.length, textB.length);
  while (commonLen < limit && textA[commonLen] === textB[commonLen]) commonLen++;
  return commonLen / maxLen;
}

/**
 * Computes the fraction of content that actually changed (0 = identical, 1 = all new).
 * Prefers Jaccard on multi-line text; falls back to char-prefix for short/binary.
 *
 * @param {string} existing
 * @param {string} next
 * @returns {number} changedRatio in [0, 1]
 * @private
 */
function computeChangedRatio(existing, next) {
  const existingLines = lineSet(existing);
  const nextLines     = lineSet(next);

  if (existingLines.size >= 2 && nextLines.size >= 2) {
    return 1 - jaccardSimilarity(existing, next);
  }
  return 1 - charPrefixSimilarity(existing, next);
}

// ---------------------------------------------------------------------------
// assessPatchEconomy
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} PatchEconomyAssessment
 * @property {boolean} suggestPatch    - True when Write on large file has low changedRatio
 * @property {string}  reason          - Human-readable explanation (empty when false)
 * @property {number}  existingBytes   - Byte length of existingContent (0 if absent)
 * @property {number}  newBytes        - Byte length of newContent (0 if absent)
 * @property {number}  changedRatio    - 0 = identical, 1 = completely different
 * @property {number}  estimatedWaste  - Approximate extra tokens vs an Edit (advisory)
 */

/**
 * Assesses whether a Write tool call on an existing file would be better served
 * by an Edit/patch operation.
 *
 * Fail-open cases (returns suggestPatch:false, no throw):
 *   - tool !== 'Write'
 *   - existingContent absent or falsy (new file creation)
 *   - existingBytes <= LARGE_FILE_THRESHOLD_BYTES (cheap rewrite)
 *   - changedRatio >= SUGGEST_PATCH_CHANGE_RATIO (large structural change)
 *   - any input is null/undefined/non-string where a string is expected
 *
 * @param {{
 *   tool?:            string,
 *   path?:            string,
 *   newContent?:      string,
 *   existingContent?: string
 * }} params
 * @returns {PatchEconomyAssessment}
 */
export function assessPatchEconomy({ tool, path: _path, newContent, existingContent } = {}) {
  const safe = (v) => (typeof v === 'string' ? v : null);

  const safeExisting = safe(existingContent);
  const safeNew      = safe(newContent);

  const existingBytes = safeExisting ? Buffer.byteLength(safeExisting, 'utf8') : 0;
  const newBytes      = safeNew      ? Buffer.byteLength(safeNew,      'utf8') : 0;

  const failOpen = {
    suggestPatch: false, reason: '',
    existingBytes, newBytes, changedRatio: 0, estimatedWaste: 0,
  };

  if (tool !== 'Write')             return failOpen;
  if (!safeExisting || existingBytes === 0)   return failOpen;
  if (existingBytes <= LARGE_FILE_THRESHOLD_BYTES) return failOpen;

  const changedRatio = computeChangedRatio(safeExisting, safeNew ?? '');

  if (changedRatio >= SUGGEST_PATCH_CHANGE_RATIO) {
    return { ...failOpen, existingBytes, newBytes, changedRatio };
  }

  const unchangedBytes = Math.round(existingBytes * (1 - changedRatio));
  const estimatedWaste = Math.round(unchangedBytes / APPROX_BYTES_PER_TOKEN);

  const reason =
    `Write rewriting ${existingBytes} B file where only ~${Math.round(changedRatio * 100)}% changed ` +
    `(changedRatio=${changedRatio.toFixed(3)}); ` +
    `prefer Edit to avoid ~${estimatedWaste} token overhead.`;

  return { suggestPatch: true, reason, existingBytes, newBytes, changedRatio, estimatedWaste };
}
