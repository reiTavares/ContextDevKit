/**
 * receipt-store.mjs — Session Autonomy Receipt: atomic, hot-path-safe storage.
 *
 * Persists receipt artifacts BESIDE the flat session ledger
 * (`.claude/.sessions/<sessionId>.json`) and upserts the `## Session autonomy`
 * section into the session markdown (spec §23–27). Constitution §4 (fail fast at
 * the boundary) + invariant "hooks never break real work": every write is atomic
 * (tmp + rename) and NEVER throws on the hot path — failures return a result
 * object with `ok:false` and a reason (#19: refuse, don't false-pass).
 *
 * Zero deps (node:fs/node:path only), deterministic — no timestamps generated here.
 */

import { writeFileSync, renameSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Marker heading for the upsert-able session section (spec §23). */
const SECTION_HEADING = '## Session autonomy';

/**
 * Resolves the three sidecar artifact paths for a session's receipt.
 * @param {string} sessionsDir flat ledger dir (e.g. `.claude/.sessions`)
 * @param {string} sessionId
 * @returns {{json: string, md: string, signature: string}}
 */
export function receiptPaths(sessionsDir, sessionId) {
  const base = `${sessionId}.autonomy-receipt`;
  return {
    json: join(sessionsDir, `${base}.json`),
    md: join(sessionsDir, `${base}.md`),
    signature: join(sessionsDir, `${base}.signature.json`),
  };
}

/**
 * Atomic write: serialize to a tmp file in the same dir, then rename over the
 * target. Never throws — returns a boolean.
 * @param {string} targetPath
 * @param {string} content
 * @returns {boolean} true on success
 */
function atomicWrite(targetPath, content) {
  try {
    const tmpPath = `${targetPath}.tmp`;
    writeFileSync(tmpPath, content, 'utf8');
    renameSync(tmpPath, targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stores the receipt JSON (+ optional signature sidecar) and markdown, per flags.
 * Atomic, hot-path-safe. Creates the sessions dir if missing.
 * @param {object} params
 * @param {string} params.sessionsDir
 * @param {string} params.sessionId
 * @param {object} params.receipt the assembled receipt object
 * @param {string} [params.markdown] rendered markdown (when storeMarkdown)
 * @param {object} [params.signature] signature payload (when present)
 * @param {boolean} [params.storeJson=true]
 * @param {boolean} [params.storeMarkdown=true]
 * @returns {{ok: boolean, written: string[], reason?: string}}
 */
export function storeReceipt({
  sessionsDir, sessionId, receipt, markdown, signature,
  storeJson = true, storeMarkdown = true,
}) {
  const written = [];
  if (!sessionsDir || !sessionId) {
    return { ok: false, written, reason: 'missing sessionsDir or sessionId' };
  }
  try {
    if (!existsSync(sessionsDir)) mkdirSync(sessionsDir, { recursive: true });
  } catch {
    return { ok: false, written, reason: 'cannot create sessions dir' };
  }

  const paths = receiptPaths(sessionsDir, sessionId);

  if (storeJson) {
    if (!receipt || typeof receipt !== 'object') {
      return { ok: false, written, reason: 'receipt object missing' };
    }
    if (!atomicWrite(paths.json, `${JSON.stringify(receipt, null, 2)}\n`)) {
      return { ok: false, written, reason: 'json write failed' };
    }
    written.push(paths.json);
    if (signature && typeof signature === 'object') {
      if (atomicWrite(paths.signature, `${JSON.stringify(signature, null, 2)}\n`)) {
        written.push(paths.signature);
      }
    }
  }

  if (storeMarkdown && typeof markdown === 'string') {
    if (atomicWrite(paths.md, markdown.endsWith('\n') ? markdown : `${markdown}\n`)) {
      written.push(paths.md);
    } else {
      return { ok: false, written, reason: 'markdown write failed' };
    }
  }

  return { ok: true, written };
}

/**
 * Finds the [start, end) line bounds of an existing `## Session autonomy` section
 * — from its heading up to (but excluding) the next `## ` heading or EOF.
 * @param {string[]} lines
 * @returns {{start: number, end: number}|null} null when the section is absent
 */
function findSectionBounds(lines) {
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === SECTION_HEADING) { start = i; break; }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i]) && lines[i].trim() !== SECTION_HEADING) { end = i; break; }
  }
  return { start, end };
}

/**
 * Upserts the `## Session autonomy` section into a session markdown file:
 * REPLACES an existing one in place (up to the next `## ` or EOF), or APPENDS if
 * absent — NEVER duplicates (spec §23). Skips gracefully if the file is missing.
 * @param {string} sessionMarkdownPath
 * @param {string} sectionText the full section (starting with the heading)
 * @returns {{ok: boolean, action: 'inserted'|'replaced'|'skipped'}}
 */
export function upsertSessionAutonomySection(sessionMarkdownPath, sectionText) {
  if (!sessionMarkdownPath || !existsSync(sessionMarkdownPath)) {
    return { ok: true, action: 'skipped' };
  }
  let original;
  try {
    original = readFileSync(sessionMarkdownPath, 'utf8');
  } catch {
    return { ok: false, action: 'skipped' };
  }

  const sectionLines = String(sectionText).replace(/\n+$/, '').split('\n');
  const lines = original.split('\n');
  const bounds = findSectionBounds(lines);

  let nextLines;
  let action;
  if (bounds) {
    nextLines = [...lines.slice(0, bounds.start), ...sectionLines];
    const tail = lines.slice(bounds.end);
    if (tail.length > 0) nextLines.push('', ...tail);
    action = 'replaced';
  } else {
    const trimmed = original.replace(/\n+$/, '');
    nextLines = trimmed.length > 0
      ? [...trimmed.split('\n'), '', ...sectionLines]
      : [...sectionLines];
    action = 'inserted';
  }

  const output = `${nextLines.join('\n').replace(/\n+$/, '')}\n`;
  if (!atomicWrite(sessionMarkdownPath, output)) {
    return { ok: false, action: 'skipped' };
  }
  return { ok: true, action };
}
