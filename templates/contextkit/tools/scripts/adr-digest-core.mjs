/**
 * ADR digest core — pure parsing of an ADR file into a catalog record. [ADR-0027]
 *
 * Turns a full ADR (~100–120 lines) into one catalog line (number · status ·
 * title · one-line decision) so "read the relevant ADR(s)" becomes "scan the
 * catalog, open at most one". Shared by `adr-digest.mjs` (the CLI) and
 * `context-pack.mjs` (the start-of-work bundle). No I/O — callers pass the text.
 */
import { firstParagraph, metaValue, section } from '../../runtime/hooks/md-extract.mjs';

/** `<NNNN>-<slug>.md` — the ADR file shape (`_TEMPLATE.md` is excluded by callers). */
export const ADR_FILENAME_RE = /^(\d{4})-([a-z0-9._-]+)\.md$/;

/**
 * Parses one ADR markdown string into a catalog record.
 * @returns {{ok:boolean, number:string, title:string, status:string, decision:string, slug:string}}
 */
export function parseAdr(text, filename = '') {
  const safe = String(text || '').replace(/^﻿/, '');
  const lines = safe.split('\n');
  const fm = ADR_FILENAME_RE.exec(filename) || [];
  const number = fm[1] || '';
  const rawTitle = (lines.find((l) => l.startsWith('# ')) || '').slice(2).trim();
  const title = rawTitle.replace(/^ADR-\d{4}\s*[:—-]\s*/i, '').trim();
  // Status keyword only (drop the parenthetical / HTML-comment tail).
  const status = (metaValue(lines, 'Status').split(/[\s(<]/)[0] || '').trim();
  const decision = firstParagraph(section(lines, 'decision'), 140);
  // `ok` means we extracted a title/decision — a structureless file shows the
  // `?` "open the file" marker rather than a misleadingly blank catalog line.
  const ok = Boolean(rawTitle || decision);
  return { ok, number: number || '????', title, status, decision, slug: fm[2] || '' };
}

/** One catalog line for a record, or `null` when unparseable (rule 8: a `?`, never dropped). */
export function renderCatalogLine(record) {
  if (!record) return null;
  const number = record.number || '????';
  if (!record.ok) return `- **${number}** · ? · (unparseable — open the file)`;
  const status = record.status || '?';
  const decision = record.decision ? ` — ${record.decision}` : '';
  return `- **${number}** · ${status} · ${record.title}${decision}`;
}
