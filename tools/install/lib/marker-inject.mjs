/**
 * marker-inject.mjs — marker-based idempotent block injection (F4 / ADR-0067).
 *
 * WHY: this is the enabler for the F8 bridge files. Several generated artifacts
 * (READMEs, AGENTS bridges, host-config docs) carry a ContextDevKit-owned region
 * that must be re-written on every install WITHOUT touching the user's own prose
 * around it. A naive "overwrite the whole file" clobbers user edits; a naive
 * "append every time" duplicates. So we delimit OUR region with HTML comment
 * markers and rewrite only what lives between them.
 *
 * MARKER CONTRACT:
 *   <!-- ContextDevKit:start -->
 *   ...kit-owned body (regenerated freely)...
 *   <!-- ContextDevKit:end -->
 * Everything ABOVE the start marker and BELOW the end marker is user-owned and is
 * preserved verbatim. The markers themselves are HTML comments so they're inert
 * in Markdown (the dominant bridge-file format) yet trivially greppable.
 *
 * DETERMINISM ON MALFORMED INPUT (immutable rule #2 — never corrupt the file):
 *   - no markers              → append a fresh block (blank-line separated).
 *   - exactly one start+end   → replace the span between the FIRST start and the
 *                               FIRST end that follows it.
 *   - start without end       → treated as NO valid block → append fresh.
 *   - duplicate start markers  → only the first start..first-end span is treated
 *                               as the block; later stray markers are left as
 *                               user content (we never delete what we can't prove
 *                               is ours).
 * Nothing here throws on malformed input.
 *
 * ZERO runtime dependencies (immutable rule #1). BOM-safe reads and atomic
 * writes reuse the sibling installer helpers.
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { atomicWriteIfChanged } from '../fs.mjs';

export const START_MARKER = '<!-- ContextDevKit:start -->';
export const END_MARKER = '<!-- ContextDevKit:end -->';

/**
 * Read a UTF-8 file while stripping one leading BOM.
 * @param {string} path absolute file path
 * @returns {Promise<string>} BOM-free text
 */
async function readBom(path) {
  return (await readFile(path, 'utf-8')).replace(/^﻿/, '');
}

/**
 * Builds the full marked block (markers + body) as a string. The body is
 * sandwiched on its own line(s) between the markers; a trailing newline in the
 * body is normalised away so re-injecting the same body is byte-stable.
 * @param {string} body
 * @param {{startMarker:string,endMarker:string}} markers validated marker pair
 * @returns {string}
 */
function renderBlock(body, markers) {
  const inner = String(body).replace(/\r\n/g, '\n').replace(/^\n+/, '').replace(/\n+$/, '');
  return `${markers.startMarker}\n${inner}\n${markers.endMarker}`;
}

/**
 * Locates the kit-owned span in `text`. Returns the character offsets of the
 * region to replace (from the start marker through the end marker, inclusive),
 * or `null` when there is no complete, well-formed block.
 * @param {string} text
 * @param {{startMarker:string,endMarker:string}} markers validated marker pair
 * @returns {{ from: number, to: number } | null}
 */
function locateBlock(text, markers) {
  const start = text.indexOf(markers.startMarker);
  if (start === -1) return null;
  const end = text.indexOf(markers.endMarker, start + markers.startMarker.length);
  if (end === -1) return null; // start without end → not a valid block.
  return { from: start, to: end + markers.endMarker.length };
}

/**
 * Validate caller-owned marker names without permitting ambiguous boundaries.
 * @param {{startMarker?:string,endMarker?:string}} [options] requested marker pair
 * @returns {{startMarker:string,endMarker:string}} validated marker pair
 * @throws {TypeError} when marker definitions are empty, multiline, or equal
 */
function resolveMarkers({ startMarker = START_MARKER, endMarker = END_MARKER } = {}) {
  if (typeof startMarker !== 'string' || typeof endMarker !== 'string'
    || startMarker.length === 0 || endMarker.length === 0
    || startMarker === endMarker || /[\r\n]/.test(startMarker) || /[\r\n]/.test(endMarker)) {
    throw new TypeError('marker-inject: markers must be distinct non-empty single-line strings');
  }
  return { startMarker, endMarker };
}

/**
 * Inserts or updates the ContextDevKit-owned block in `filePath`.
 *
 * WHAT: idempotently writes a marker-delimited region containing `body`.
 * WHEN: whenever a generated/bridge file must carry a regenerated region while
 *       preserving the user's surrounding content.
 *
 * - NEW file            → created containing just the marked block (+ trailing \n).
 * - EXISTING with block → only the span between the markers is replaced; content
 *                         above and below is preserved verbatim.
 * - EXISTING, no block  → the block is appended at the end, separated by a blank
 *                         line from existing content.
 *
 * Idempotent: re-running with the same `body` yields a byte-identical file.
 *
 * @param {object} opts
 * @param {string} opts.filePath  absolute path to the target file
 * @param {string} opts.body      kit-owned content to place between the markers
 * @param {string} [opts.startMarker] dedicated start marker
 * @param {string} [opts.endMarker] dedicated end marker
 * @returns {Promise<{ created: boolean, updated: boolean, appended: boolean }>}
 */
export async function injectMarkedBlock({ filePath, body, startMarker, endMarker }) {
  const markers = resolveMarkers({ startMarker, endMarker });
  const block = renderBlock(body, markers);

  if (!existsSync(filePath)) {
    await atomicWriteIfChanged(filePath, `${block}\n`);
    return { created: true, updated: false, appended: false };
  }

  const current = await readBom(filePath);
  const span = locateBlock(current, markers);

  if (span) {
    const before = current.slice(0, span.from);
    const after = current.slice(span.to);
    const next = `${before}${block}${after}`;
    if (next === current) return { created: false, updated: false, appended: false };
    await atomicWriteIfChanged(filePath, next);
    return { created: false, updated: true, appended: false };
  }

  // No valid block — append without normalizing even one owner-authored byte.
  // Add only the separator needed after the existing payload.
  const separator = current.endsWith('\n\n') ? '' : current.endsWith('\n') ? '\n' : '\n\n';
  const next = current === '' ? `${block}\n` : `${current}${separator}${block}\n`;
  await atomicWriteIfChanged(filePath, next);
  return { created: false, updated: false, appended: true };
}

/**
 * Removes the ContextDevKit-owned block from `text` (the uninstall path), mirroring
 * the `stripCodexHooks` convention: returns the remaining USER content, or `null`
 * when nothing user-owned is left. Stray surrounding blank lines are collapsed so
 * the file doesn't accrete whitespace across install/uninstall cycles. Defensive:
 * with no valid block it returns the input trimmed (or null if empty).
 *
 * @param {string} text  current file content (caller is responsible for BOM strip
 *                        if reading raw; `stripMarkedBlockFile` handles it)
 * @param {{startMarker?:string,endMarker?:string}} [options] dedicated marker pair
 * @returns {string | null} remaining content (no stray blank lines), or null
 */
export function stripMarkedBlock(text, options = {}) {
  const markers = resolveMarkers(options);
  const src = typeof text === 'string' ? text.replace(/^﻿/, '') : '';
  const span = locateBlock(src, markers);
  let rest;
  if (!span) {
    rest = src;
  } else {
    const before = src.slice(0, span.from);
    const after = src.slice(span.to);
    rest = `${before}${after}`;
  }
  // Collapse the seam (and any 3+ blank-line runs) and trim leading/trailing space.
  rest = rest.replace(/\n{3,}/g, '\n\n').replace(/^\s+/, '').replace(/\s+$/, '');
  return rest === '' ? null : rest;
}

/**
 * File-level uninstall helper: reads `filePath` (BOM-safe), strips the block, and
 * either rewrites the remaining user content or reports that the file is now empty.
 * Never throws on a missing file — returns `{ removed: false }`.
 *
 * @param {string} filePath absolute path
 * @param {{startMarker?:string,endMarker?:string}} [options] dedicated marker pair
 * @returns {Promise<{ removed: boolean, empty: boolean, content: string | null }>}
 */
export async function stripMarkedBlockFile(filePath, options = {}) {
  if (!existsSync(filePath)) return { removed: false, empty: false, content: null };
  const current = await readBom(filePath);
  const remaining = stripMarkedBlock(current, options);
  if (remaining === null) {
    return { removed: true, empty: true, content: null };
  }
  const next = `${remaining}\n`;
  if (next !== current) await atomicWriteIfChanged(filePath, next);
  return { removed: locateBlock(current, resolveMarkers(options)) !== null, empty: false, content: remaining };
}
