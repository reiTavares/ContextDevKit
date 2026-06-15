#!/usr/bin/env node
/**
 * Rule fossilization ledger — CDK-055 (PKG-05, ADR-0072).
 *
 * Maintains <memory>/rule-ledger.json so that deprecated/superseded rules leave
 * a traceable fossil (why retired, which ADR authorised the change).
 *
 * Posture: fail-open on all I/O paths — a corrupt/missing ledger always yields
 * three empty arrays, never throws into the caller's session.
 *
 * Schema  { version: 1, rules: [{ id, text, status, reason, supersededBy,
 *           adrs, recordedAt, deprecatedAt }] }
 * status ∈ 'active' | 'deprecated' | 'superseded'
 *
 * CLI:
 *   rule-archive.mjs record --text "..." --status deprecated --reason "..."
 *                           [--superseded-by "#NNNN"] [--adr ADR-00NN]
 *   rule-archive.mjs list [--status active|deprecated|superseded]
 *   rule-archive.mjs search <term>
 *
 * API exports: loadRules(root) · recordRule(root, opts) · searchRules(root, term)
 * Zero runtime dependencies. Pure ESM over node:*.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { writeFileAtomicSync } from '../../runtime/hooks/safe-io.mjs';
import { pathsFor } from '../../runtime/config/paths.mjs';

const LEDGER_VERSION = 1;
const VALID_STATUSES = new Set(['active', 'deprecated', 'superseded']);
const BOM = /^﻿/;

// -- Internal helpers --------------------------------------------------------

/**
 * Derives a stable 12-char hex id from normalised rule text (SHA-256 prefix).
 * Collision-resistant for ledgers up to ~1 000 rules; human-memorisable short.
 *
 * @param {string} text
 * @returns {string}
 */
function deriveId(text) {
  const norm = String(text).toLowerCase().replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(norm).digest('hex').slice(0, 12);
}

/** @param {string} root @returns {string} absolute ledger file path */
function ledgerPath(root) {
  return resolve(pathsFor(root).memory, 'rule-ledger.json');
}

/**
 * Reads + parses the ledger. Returns `{ version, rules: [] }` on any error
 * (fail-open — never throws).
 *
 * @param {string} file
 * @returns {Promise<{version:number, rules:object[]}>}
 */
async function readLedger(file) {
  const empty = { version: LEDGER_VERSION, rules: [] };
  if (!existsSync(file)) return empty;
  try {
    const parsed = JSON.parse((await readFile(file, 'utf-8')).replace(BOM, ''));
    if (!parsed || !Array.isArray(parsed.rules)) return empty;
    return { version: LEDGER_VERSION, rules: parsed.rules };
  } catch {
    return empty;
  }
}

/**
 * Atomically persists `ledger` to `file`, creating parent dirs as needed.
 *
 * @param {string} file
 * @param {{version:number, rules:object[]}} ledger
 */
function persistLedger(file, ledger) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileAtomicSync(file, JSON.stringify(ledger, null, 2) + '\n');
}

// -- Public API --------------------------------------------------------------

/**
 * Loads all rules grouped by status. Always returns `{ active, deprecated,
 * superseded }` — three arrays, never throws.
 *
 * @param {string} [root] project root (default cwd)
 * @returns {Promise<{active:object[], deprecated:object[], superseded:object[]}>}
 */
export async function loadRules(root = process.cwd()) {
  const buckets = { active: [], deprecated: [], superseded: [] };
  try {
    const ledger = await readLedger(ledgerPath(root));
    for (const rule of ledger.rules) {
      if (Array.isArray(buckets[rule.status])) buckets[rule.status].push(rule);
    }
  } catch { /* fail-open */ }
  return buckets;
}

/**
 * Records a new rule or transitions an existing one (same normalised text →
 * same id). Transition stamps `deprecatedAt` and merges `adrs`; history is
 * always preserved (no hard deletes).
 *
 * @param {string} [root] project root (default cwd)
 * @param {{ text:string, status?:string, reason?:string,
 *           supersededBy?:string|null, adrs?:string[] }} opts
 * @returns {Promise<object>} the stored record
 * @throws {TypeError}  when text is missing
 * @throws {RangeError} when status is not a valid value
 */
export async function recordRule(root = process.cwd(), {
  text,
  status = 'active',
  reason = '',
  supersededBy = null,
  adrs = [],
} = {}) {
  if (!text || typeof text !== 'string') throw new TypeError('recordRule: text is required');
  if (!VALID_STATUSES.has(status)) throw new RangeError(`recordRule: invalid status "${status}"`);

  const file = ledgerPath(root);
  const ledger = await readLedger(file);
  const id = deriveId(text);
  const now = new Date().toISOString();
  const retiring = status === 'deprecated' || status === 'superseded';

  const existing = ledger.rules.find((r) => r.id === id);
  if (existing) {
    existing.status = status;
    if (reason) existing.reason = reason;
    if (supersededBy != null) existing.supersededBy = supersededBy;
    if (adrs.length > 0) existing.adrs = [...new Set([...existing.adrs, ...adrs])];
    if (retiring) existing.deprecatedAt = now;
    persistLedger(file, ledger);
    return existing;
  }

  const record = {
    id,
    text: text.trim(),
    status,
    reason: reason || '',
    supersededBy: supersededBy ?? null,
    adrs: Array.isArray(adrs) ? [...adrs] : [],
    recordedAt: now,
    deprecatedAt: retiring ? now : null,
  };
  ledger.rules.push(record);
  persistLedger(file, ledger);
  return record;
}

/**
 * Searches all rules (any status) for `term` in text or reason
 * (case-insensitive substring). Empty term → []. Never throws.
 *
 * @param {string} [root] project root (default cwd)
 * @param {string} term
 * @returns {Promise<object[]>}
 */
export async function searchRules(root = process.cwd(), term = '') {
  try {
    if (typeof term !== 'string' || term.trim().length === 0) return [];
    const ledger = await readLedger(ledgerPath(root));
    const lower = term.toLowerCase();
    return ledger.rules.filter(
      (r) => r.text.toLowerCase().includes(lower) ||
             (r.reason && r.reason.toLowerCase().includes(lower)),
    );
  } catch {
    return [];
  }
}

// -- CLI ---------------------------------------------------------------------

/**
 * Minimal flag parser: `--key value` pairs (repeated flags → array) plus
 * positional tokens in `result._`.
 *
 * @param {string[]} argv
 * @returns {Record<string,string|string[]> & {_:string[]}}
 */
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i];
    if (!tok.startsWith('--')) { out._.push(tok); continue; }
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = key in out
        ? (Array.isArray(out[key]) ? [...out[key], next] : [out[key], next])
        : next;
      i += 1;
    } else {
      out[key] = 'true';
    }
  }
  return out;
}

async function main() {
  const [sub, ...rest] = process.argv.slice(2);
  if (!sub) {
    console.error(
      'Usage:\n' +
      '  rule-archive.mjs record --text "..." --status deprecated --reason "..." [--superseded-by "#NNNN"] [--adr ADR-00NN]\n' +
      '  rule-archive.mjs list [--status active|deprecated|superseded]\n' +
      '  rule-archive.mjs search <term>',
    );
    process.exit(1);
  }

  const root = process.cwd();
  const f = parseArgs(rest);

  if (sub === 'record') {
    if (!f.text) { console.error('rule-archive record: --text is required'); process.exit(1); }
    const adrs = f.adr ? (Array.isArray(f.adr) ? f.adr : [f.adr]) : [];
    try {
      const s = await recordRule(root, {
        text: f.text, status: f.status || 'active',
        reason: f.reason || '', supersededBy: f['superseded-by'] || null, adrs,
      });
      console.log(`rule-archive: recorded rule ${s.id} (${s.status})`);
    } catch (err) {
      console.error(`rule-archive record failed: ${err?.message ?? err}`);
      process.exit(1);
    }
    return;
  }

  if (sub === 'list') {
    const groups = await loadRules(root);
    const all = [...groups.active, ...groups.deprecated, ...groups.superseded];
    const display = f.status ? all.filter((r) => r.status === f.status) : all;
    if (display.length === 0) { console.log('rule-archive: no rules found.'); return; }
    for (const r of display) {
      console.log(`[${r.status}] ${r.id}  ${r.text.slice(0, 80)}`);
      if (r.reason) console.log(`         reason: ${r.reason}`);
      if (r.supersededBy) console.log(`         superseded-by: ${r.supersededBy}`);
      if (r.adrs?.length) console.log(`         adrs: ${r.adrs.join(', ')}`);
    }
    return;
  }

  if (sub === 'search') {
    const term = f._.join(' ');
    if (!term) { console.error('rule-archive search: provide a search term'); process.exit(1); }
    const matches = await searchRules(root, term);
    if (matches.length === 0) { console.log('rule-archive: no matches.'); return; }
    for (const r of matches) console.log(`[${r.status}] ${r.id}  ${r.text.slice(0, 80)}`);
    return;
  }

  console.error(`rule-archive: unknown subcommand "${sub}"`);
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('rule-archive unexpected error:', err?.message ?? err);
    process.exit(0); // fail-open: never kill a hook chain
  });
}
