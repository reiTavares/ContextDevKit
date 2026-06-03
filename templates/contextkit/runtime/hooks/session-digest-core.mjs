/**
 * Session-log digest core — pure, zero-dep structural extraction. [ADR-0027]
 *
 * Parses a ContextDevKit session log into a compact record so callers reason over a
 * ~6-line digest instead of the 75–188 raw lines. SINGLE SOURCE (rule 4): used by
 * BOTH the boot hook (`boot-context-readers.digestLatestSession`) and the
 * `session-digest.mjs` / `context-pack.mjs` scripts.
 *
 * No I/O and no path construction here — callers pass the file text + name; this
 * module only parses and renders. Every function is defensive: a malformed log
 * yields `{ ok: false }` so the caller can fall back to the raw view (rule 8 —
 * a digest miss is a visible fallback, never a silent drop).
 */

import { bullets, firstParagraph, metaValue, section } from './md-extract.mjs';

/** `<YYYY-MM-DD>-<NN>-<slug>.md` — same shape the reindex/boot readers use. */
export const SESSION_FILENAME_RE = /^(\d{4}-\d{2}-\d{2})-(\d{2,})-([a-z0-9._-]+)\.md$/;
const ADR_RE = /ADR-(\d{4})/g;

/** Drops a redundant `Session <N> —` prefix the title often repeats. */
function cleanTitle(title, number) {
  if (number == null) return title.trim();
  return title.replace(new RegExp(`^session\\s*${number}\\s*[—:\\-]\\s*`, 'i'), '').trim();
}

/** Works / Pending / Mixed verdict from the `Final state` section (honest ''). */
function deriveVerdict(finalLines) {
  const text = finalLines.join('\n');
  const works = /\bworks?\b/i.test(text) || text.includes('✅');
  const pending = /\bpending\b|\bnot done\b|\bawait/i.test(text) || text.includes('⚠️');
  if (works && pending) return 'Mixed';
  if (works) return 'Works';
  if (pending) return 'Pending';
  return '';
}

/**
 * Parses one session-log markdown string into a compact record.
 * @param {string} text     the file contents
 * @param {string} filename the `<date>-<NN>-<slug>.md` name (for fallbacks)
 * @returns {{ok:boolean, number:?number, date:string, branch:string, title:string,
 *   request:string, done:string, decisions:string[], adrs:string[], verdict:string, slug:string}}
 */
export function parseSessionLog(text, filename = '') {
  const safe = String(text || '').replace(/^﻿/, '');
  const lines = safe.split('\n');
  const fm = SESSION_FILENAME_RE.exec(filename) || [];
  const number = Number.parseInt(metaValue(lines, 'Session number') || fm[2] || '', 10) || null;
  const rawTitle = (lines.find((l) => l.startsWith('# ')) || '').slice(2).trim();
  const title = cleanTitle(rawTitle, number);
  const date = (metaValue(lines, 'Date') || fm[1] || '').trim();
  const branch = metaValue(lines, 'Branch');
  const request = firstParagraph(section(lines, 'request'));
  const done = firstParagraph(section(lines, 'done'));
  const decisions = bullets(section(lines, 'decision')).slice(0, 4);
  const adrs = [...new Set(safe.match(ADR_RE) || [])].sort();
  const verdict = deriveVerdict(section(lines, 'final'));
  // `ok` means we extracted usable STRUCTURE (not just a number from the filename),
  // so a structureless log degrades to the raw boot view rather than a bare header.
  const ok = Boolean(title || request || done || decisions.length || verdict);
  return { ok, number, date, branch, title, request, done, decisions, adrs, verdict, slug: fm[3] || '' };
}

/** Multi-line (~6) digest block for one session, or `null` if unparseable. */
export function renderDigest(record) {
  if (!record || !record.ok) return null;
  const head = `**Session ${record.number ?? '??'}${record.title ? ` — ${record.title}` : ''}**` +
    `${record.date ? `  (${record.date}${record.branch ? ` · \`${record.branch}\`` : ''})` : ''}`;
  const out = [head];
  if (record.request) out.push(`- Request: ${record.request}`);
  if (record.done) out.push(`- Done: ${record.done}`);
  if (record.decisions.length) out.push(`- Decisions: ${record.decisions.join('; ')}`);
  if (record.adrs.length) out.push(`- ADRs: ${record.adrs.join(', ')}`);
  out.push(`- Final: ${record.verdict || '—'}`);
  return out.join('\n');
}

/** One-line index form for a list of sessions. */
export function renderDigestLine(record) {
  if (!record || !record.ok) return null;
  const adrs = record.adrs.length ? ` [${record.adrs.join(', ')}]` : '';
  const verdict = record.verdict ? ` _${record.verdict}_` : '';
  return `- **${record.number ?? '??'}** ${record.date} — ${record.title || record.slug}${verdict}${adrs}`;
}
