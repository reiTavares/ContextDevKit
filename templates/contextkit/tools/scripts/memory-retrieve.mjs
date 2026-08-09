#!/usr/bin/env node
/**
 * Deterministic memory retriever (ADR-0044 D5) — fills the seam the discarded
 * `distill-memory.mjs` left, WITHOUT its risk ("memory inflation disguised as
 * memory"). Given an objective string, it SELECTS the memory already extracted
 * by the digest layer — it never generates, never stubs a placeholder:
 *   - glossary rows whose term / identifier / note matches an objective token;
 *   - recent ADRs scored by title overlap (catalog lines from `adr-digest-core`);
 *   - the latest session one-liner (`session-digest-core`);
 *   - the focused project-map subgraph for any path-like token (`subgraphFor`).
 *
 * Output is capped at {@link CAP} lines and idempotent: same objective + same
 * repo state ⇒ byte-identical output (sources are read in a fixed order, no clock,
 * no randomness). Boot injection is gated elsewhere on a config flag AND a size
 * check — silent growth is the named failure mode this script must not become.
 *
 * Usage:
 *   node contextkit/tools/scripts/memory-retrieve.mjs --objective "fix the budget gate"
 *   node contextkit/tools/scripts/memory-retrieve.mjs --objective "..." --json
 */
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { ADR_FILENAME_RE, parseAdr, renderCatalogLine } from './adr-digest-core.mjs';
import { SESSION_FILENAME_RE, parseSessionLog, renderDigestLine } from '../../runtime/hooks/session-digest-core.mjs';
import { subgraphFor } from './project-map-insights.mjs';

/** Hard line cap on the rendered retrieval (ADR-0044 — bounded, never inflating). */
export const CAP = 40;

const readSafe = (abs) => readFile(abs, 'utf-8').catch(() => null);

/** Objective → the set of lowercase content tokens (≥ 3 chars) used for matching. */
export function tokenize(objective) {
  const words = String(objective || '').toLowerCase().match(/[a-z0-9][a-z0-9._/-]{2,}/g) || [];
  return [...new Set(words)];
}

/** True when any token appears as a substring of the (lowercased) text. */
const hits = (text, tokens) => {
  const low = String(text).toLowerCase();
  return tokens.some((t) => low.includes(t));
};

/** Glossary table rows (term · identifier) matching the objective, capped. */
async function glossaryHits(glossaryPath, tokens, cap = 6) {
  const text = await readSafe(glossaryPath);
  if (!text) return [];
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    const [, term, code] = cells;
    if (!term || term === 'Domain term (UI / business)' || /^-+$/.test(term)) continue;
    if (hits(line, tokens)) out.push(`- **${term}** → \`${code || ''}\``);
    if (out.length >= cap) break;
  }
  return out;
}

/** Recent ADRs scored by objective-title overlap; the top `cap` catalog lines. */
async function adrHits(decisionsDir, tokens, cap = 4) {
  let files = [];
  try {
    files = await readdir(decisionsDir);
  } catch {
    return [];
  }
  const scored = [];
  for (const name of files.filter((f) => ADR_FILENAME_RE.test(f) && f !== '_TEMPLATE.md')) {
    const text = await readSafe(resolve(decisionsDir, name));
    if (text === null) continue;
    const record = parseAdr(text, name);
    const score = tokens.filter((t) => String(record.title || '').toLowerCase().includes(t)).length;
    if (score > 0) scored.push({ score, name, line: renderCatalogLine(record) });
  }
  // Deterministic: higher score first, then newest filename first.
  scored.sort((a, b) => b.score - a.score || b.name.localeCompare(a.name));
  return scored.slice(0, cap).map((s) => s.line);
}

/** The latest session as a single digest line, or null. */
async function sessionLine(sessionsDir) {
  let files = [];
  try {
    files = await readdir(sessionsDir);
  } catch {
    return null;
  }
  const names = files.filter((f) => SESSION_FILENAME_RE.test(f)).sort();
  if (!names.length) return null;
  const text = await readSafe(resolve(sessionsDir, names[names.length - 1]));
  return text ? renderDigestLine(parseSessionLog(text, names[names.length - 1])) : null;
}

/** Focused project-map subgraph for the first path-like token, or null. */
async function mapSubgraph(projectMapDir, tokens) {
  const text = await readSafe(resolve(projectMapDir, 'manifest.json'));
  if (!text) return null;
  let modules;
  try {
    modules = JSON.parse(text).modules;
  } catch {
    return null;
  }
  if (!Array.isArray(modules)) return null;
  for (const token of tokens.filter((t) => t.includes('/'))) {
    const sub = subgraphFor(modules, token);
    if (sub) return `\`${sub.module}/\` → ${sub.deps.map((d) => `${d}/`).join(', ') || '—'} · imported by ${sub.importers.map((d) => `${d}/`).join(', ') || '—'}`;
  }
  return null;
}

/**
 * Retrieves the objective-relevant memory already extracted by the digest layer.
 *
 * @param {string} root
 * @param {string} objective
 * @returns {Promise<{ objective, tokens, glossary, adrs, session, subgraph }>}
 */
export async function retrieveMemory(root, objective) {
  const P = pathsFor(root);
  const tokens = tokenize(objective);
  const [glossary, adrs, session, subgraph] = await Promise.all([
    glossaryHits(P.glossary, tokens),
    adrHits(P.decisions, tokens),
    sessionLine(P.sessions),
    mapSubgraph(P.projectMap, tokens),
  ]);
  return { objective: String(objective || ''), tokens, glossary, adrs, session, subgraph };
}

/**
 * Renders the retrieval to a bounded markdown block (≤ {@link CAP} lines). Empty
 * sections are dropped — never a placeholder. Hard-truncates at the cap with a
 * single honest note so the budget can never silently overflow.
 *
 * @param {{ glossary, adrs, session, subgraph }} retrieval
 * @returns {string}
 */
export function renderRetrieval(retrieval) {
  const lines = ['## 🧠 Relevant memory (retrieved, not generated)'];
  if (retrieval.session) lines.push('', '**Last session:**', retrieval.session);
  if (retrieval.glossary.length) lines.push('', '**Glossary:**', ...retrieval.glossary);
  if (retrieval.adrs.length) lines.push('', '**Decisions:**', ...retrieval.adrs);
  if (retrieval.subgraph) lines.push('', '**Module graph:**', retrieval.subgraph);
  if (lines.length === 1) lines.push('', '_No memory matched the objective._');
  if (lines.length > CAP) return [...lines.slice(0, CAP - 1), `_… +${lines.length - (CAP - 1)} more lines truncated (ADR-0044 cap ${CAP})._`].join('\n');
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const objective = args[args.indexOf('--objective') + 1] || '';
  const retrieval = await retrieveMemory(process.cwd(), objective);
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify(retrieval, null, 2) + '\n');
    return;
  }
  console.log(renderRetrieval(retrieval));
}

// CLI only when executed directly — this module is also imported by context-pack.mjs.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('❌ memory-retrieve failed:', err?.message ?? err);
    process.exit(1);
  });
}
