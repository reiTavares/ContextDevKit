#!/usr/bin/env node
/**
 * `/log-session` companion — scans the just-written session narrative for
 * **rule-like phrases** that look constitutional ("we decided X", "from now on
 * Y", "we should always Z") and surfaces them as **proposal-only** candidates
 * for `/distill-sessions`. Ticket 043 (Compozy follow-through).
 *
 * Posture: **propose, never apply**. This script does not edit `CLAUDE.md`. It
 * prints one nudge line at the end of `/log-session` and exits 0 either way —
 * a session with no candidates is not an error, just quiet.
 *
 * Optimised for *low false-negatives*. Per the ticket: the cost of a wrong
 * nudge is one ignored line; the cost of a missed nudge is silent drift.
 *
 * Usage:
 *   distill-detect.mjs <path-to-session-file.md>     # nudge mode
 *   distill-detect.mjs <path> --json                 # machine-readable
 *
 * Zero-dep, pure ESM over `node:*`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Regex set, ordered roughly by signal strength. Each pattern has a `kind` so
 * `--json` output can be triaged downstream (e.g. by `/distill-sessions`).
 *
 * Keep this list tight — Tier-1 phrases only. Tier-2 phrases ("maybe we
 * should…", "consider…") produce false positives that train the user to
 * ignore the nudge.
 */
const PATTERNS = [
  { kind: 'decision', re: /\b(we|i)\s+decided\s+(that\s+|to\s+)/i },
  { kind: 'decision', re: /\bdecision:\s*\S/i },
  { kind: 'rule', re: /\bfrom now on\b/i },
  { kind: 'rule', re: /\bwe\s+(should|must|will)\s+always\b/i },
  { kind: 'rule', re: /\bwe\s+(should|must|will)\s+never\b/i },
  { kind: 'rule', re: /\balways\s+(use|prefer|require|enforce)\b/i },
  { kind: 'rule', re: /\bnever\s+(use|allow|skip|bypass)\b/i },
  { kind: 'convention', re: /\bconvention:\s*\S/i },
  { kind: 'invariant', re: /\binvariant:\s*\S/i },
  { kind: 'lesson', re: /\blesson\s+learn(ed|t)\b/i },
];

/**
 * Scans `text` (typically the body of a session log) and returns every
 * matched candidate sentence. Sentence boundaries are heuristic — `. `, `! `,
 * `? `, and newline blocks — which is fine: the user only reads the count
 * + first match.
 *
 * @param {string} text
 * @returns {Array<{ kind: string, line: number, snippet: string }>}
 */
export function detect(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const lines = text.split('\n');
  const hits = [];
  const seenLines = new Set();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim().startsWith('#')) continue; // skip headings
    if (line.trim().startsWith('>')) continue; // skip block quotes (often quoting prior decisions, not new ones)
    for (const { kind, re } of PATTERNS) {
      if (!re.test(line)) continue;
      const key = `${i}:${kind}`;
      if (seenLines.has(key)) continue;
      seenLines.add(key);
      const snippet = line.trim().slice(0, 120);
      hits.push({ kind, line: i + 1, snippet });
    }
  }
  return hits;
}

function main() {
  const file = process.argv[2];
  if (!file) { console.error('Usage: distill-detect.mjs <session-file.md> [--json]'); process.exit(1); }
  if (!existsSync(file)) { console.error(`distill-detect: file not found — ${file}`); process.exit(1); }
  const text = readFileSync(file, 'utf-8');
  const hits = detect(text);
  if (process.argv.includes('--json')) { console.log(JSON.stringify({ candidates: hits.length, hits }, null, 2)); return; }
  if (hits.length === 0) return; // quiet success
  const kinds = [...new Set(hits.map((h) => h.kind))].join(', ');
  console.log('');
  console.log(`💡 ${hits.length} rule-like phrase(s) detected (${kinds}). Consider /distill-sessions to propose them for CLAUDE.md.`);
  console.log(`   First match: ${hits[0].snippet}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
