#!/usr/bin/env node
/**
 * Graph field sanitization pipeline (SR1, WF-0073/BIZ-0004) — the injection
 * firewall for ADR-0138.
 *
 * The deterministic code graph surfaces only structural fields (ids, paths,
 * counts) and is injection-safe by construction. The moment a node carries FREE
 * TEXT — a doc/NOTE/WHY summary, an LLM label, a media caption — that property is
 * gone, and it matters more here than in a viewer because `GRAPH_DERIVED` is
 * blocking-capable and the graph feeds agent context. Every free-text field MUST
 * clear this pipeline ON INGEST (store-clean), belt-and-suspenders re-applied on
 * surface:
 *
 *   1. strip control chars + ANSI escape sequences;
 *   2. neutralize chat-template sentinels (im_start/im_end, [INST], <<SYS>>,
 *      </s>, <system>, and Anthropic-style Human:/Assistant: turn markers) via a
 *      zero-width space so file/LLM text cannot hijack the host's template;
 *   3. HTML-escape (the dashboard skill renders HTML — load-bearing there);
 *   4. hard length cap (256) — bounds DoS + payload size;
 *   5. `untrusted_source` framing (sha256-stamped) for content that will be
 *      shown to a model as data, not instructions.
 *
 * Pure, deterministic, zero non-`node:` imports. Structural fields never pass
 * through here (they are safe); a gate block reason is built from ids + metrics,
 * NEVER from a sanitized-but-still-attacker-controlled string.
 */
import { createHash } from 'node:crypto';

/** Max length of any surfaced free-text field. */
export const FIELD_CAP = 256;

const ZWSP = '​';

/** Chat-template / turn sentinels neutralized by a zero-width-space insertion. */
const SENTINELS = [
  '<|im_start|>', '<|im_end|>', '<|system|>', '<|user|>', '<|assistant|>',
  '[INST]', '[/INST]', '<<SYS>>', '<</SYS>>', '</s>', '<s>',
  '<system>', '</system>', '\n\nHuman:', '\n\nAssistant:',
];

/**
 * Strips ASCII/Unicode control characters and ANSI escape sequences. Keeps
 * ordinary whitespace (space, tab, newline) so multi-line text stays readable.
 * @param {string} text
 * @returns {string}
 */
function stripControl(text) {
  // Remove ANSI CSI/OSC sequences first, then remaining control chars except \t\n\r.
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const code = text.charCodeAt(i);
    if (ch === '') {
      // Skip an ANSI escape: ESC [ ... letter, or ESC ] ... BEL/ESC\.
      let j = i + 1;
      if (text[j] === '[') { j++; while (j < text.length && !/[A-Za-z]/.test(text[j])) j++; i = j; continue; }
      if (text[j] === ']') { j++; while (j < text.length && text[j] !== '') j++; i = j; continue; }
      continue;
    }
    if (code < 0x20 && ch !== '\t' && ch !== '\n' && ch !== '\r') continue;
    if (code === 0x7f) continue;
    out += ch;
  }
  return out;
}

/** Inserts a zero-width space into each chat-template sentinel so it is inert. */
function neutralizeSentinels(text) {
  let out = text;
  for (const s of SENTINELS) {
    if (!out.includes(s)) continue;
    // Insert ZWSP after the first character so the literal token no longer matches.
    const defanged = s[0] + ZWSP + s.slice(1);
    out = out.split(s).join(defanged);
  }
  return out;
}

/** HTML-escapes the five significant characters (dashboard renders HTML). */
function htmlEscape(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Sanitizes one free-text field: strip control/ANSI -> neutralize sentinels ->
 * HTML-escape -> hard-cap at FIELD_CAP. Deterministic; never throws (coerces a
 * non-string to ''). This is the ON-INGEST transform every free-text node/edge
 * field must pass through before entering the graph.
 *
 * @param {unknown} value the raw field
 * @returns {string} the safe field
 */
export function sanitizeField(value) {
  if (typeof value !== 'string') return '';
  let out = stripControl(value);
  out = neutralizeSentinels(out);
  out = htmlEscape(out);
  if (out.length > FIELD_CAP) out = out.slice(0, FIELD_CAP);
  return out;
}

/**
 * Frames untrusted content as an explicit, sha256-stamped data block for a model
 * — "this is data, not instructions". The body is sanitized first. The sha256 is
 * over the ORIGINAL bytes (provenance), the shown body is the safe form.
 *
 * @param {unknown} value raw untrusted content
 * @param {string} [originLabel] a structural origin hint (path/id), itself sanitized
 * @returns {string} a delimited untrusted-source block
 */
export function frameUntrusted(value, originLabel = '') {
  const raw = typeof value === 'string' ? value : '';
  const sha = createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 16);
  const origin = sanitizeField(originLabel);
  const body = sanitizeField(raw);
  return `<untrusted_source sha256="${sha}"${origin ? ` origin="${origin}"` : ''}>\n${body}\n</untrusted_source>`;
}

/**
 * Sanitizes every free-text field of a node in place-safe manner (returns a new
 * object). Structural fields (id, kind, relation, evidenceClass, resolution,
 * sourceFile, sourceLocation, confidenceScore) pass through UNCHANGED — only
 * free-text fields (label, context, summary) are sanitized.
 *
 * @param {object} node
 * @returns {object} a node with sanitized free-text fields
 */
export function sanitizeNode(node) {
  if (!node || typeof node !== 'object') return node;
  const FREE_TEXT = new Set(['label', 'context', 'summary', 'title', 'caption']);
  const out = {};
  for (const [key, val] of Object.entries(node)) {
    out[key] = FREE_TEXT.has(key) && typeof val === 'string' ? sanitizeField(val) : val;
  }
  return out;
}

if (process.argv[1] && process.argv[1].split(/[\\/]/).pop() === 'graph-sanitize.mjs') {
  const sample = process.argv.slice(2).join(' ');
  process.stdout.write(JSON.stringify({ input: sample, sanitized: sanitizeField(sample) }, null, 2) + '\n');
}
