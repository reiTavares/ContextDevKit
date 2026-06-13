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
 * ZERO runtime deps (immutable rule #1): only node:fs/promises + node:path.
 * BOM-safe reads, matching the sibling installer modules (tools/install/fs.mjs).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

export const START_MARKER = '<!-- ContextDevKit:start -->';
export const END_MARKER = '<!-- ContextDevKit:end -->';

/** Reads a file, stripping a leading UTF-8 BOM (Windows-safe). */
async function readBom(path) {
  return (await readFile(path, 'utf-8')).replace(/^﻿/, '');
}

/**
 * Builds the full marked block (markers + body) as a string. The body is
 * sandwiched on its own line(s) between the markers; a trailing newline in the
 * body is normalised away so re-injecting the same body is byte-stable.
 * @param {string} body
 * @returns {string}
 */
function renderBlock(body) {
  const inner = String(body).replace(/\r\n/g, '\n').replace(/^\n+/, '').replace(/\n+$/, '');
  return `${START_MARKER}\n${inner}\n${END_MARKER}`;
}

/**
 * Locates the kit-owned span in `text`. Returns the character offsets of the
 * region to replace (from the start marker through the end marker, inclusive),
 * or `null` when there is no complete, well-formed block.
 * @param {string} text
 * @returns {{ from: number, to: number } | null}
 */
function locateBlock(text) {
  const start = text.indexOf(START_MARKER);
  if (start === -1) return null;
  const end = text.indexOf(END_MARKER, start + START_MARKER.length);
  if (end === -1) return null; // start without end → not a valid block.
  return { from: start, to: end + END_MARKER.length };
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
 * @returns {Promise<{ created: boolean, updated: boolean, appended: boolean }>}
 */
export async function injectMarkedBlock({ filePath, body }) {
  const block = renderBlock(body);

  if (!existsSync(filePath)) {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${block}\n`, 'utf-8');
    return { created: true, updated: false, appended: false };
  }

  const current = await readBom(filePath);
  const span = locateBlock(current);

  if (span) {
    const before = current.slice(0, span.from);
    const after = current.slice(span.to);
    const next = `${before}${block}${after}`;
    if (next === current) return { created: false, updated: false, appended: false };
    await writeFile(filePath, next, 'utf-8');
    return { created: false, updated: true, appended: false };
  }

  // No valid block — append, keeping the user's content intact above.
  const base = current.replace(/\s+$/, '');
  const next = base === '' ? `${block}\n` : `${base}\n\n${block}\n`;
  await writeFile(filePath, next, 'utf-8');
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
 * @returns {string | null} remaining content (no stray blank lines), or null
 */
export function stripMarkedBlock(text) {
  const src = typeof text === 'string' ? text.replace(/^﻿/, '') : '';
  const span = locateBlock(src);
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
 * @returns {Promise<{ removed: boolean, empty: boolean, content: string | null }>}
 */
export async function stripMarkedBlockFile(filePath) {
  if (!existsSync(filePath)) return { removed: false, empty: false, content: null };
  const current = await readBom(filePath);
  const remaining = stripMarkedBlock(current);
  if (remaining === null) {
    return { removed: true, empty: true, content: null };
  }
  const next = `${remaining}\n`;
  if (next !== current) await writeFile(filePath, next, 'utf-8');
  return { removed: locateBlock(current) !== null, empty: false, content: remaining };
}
