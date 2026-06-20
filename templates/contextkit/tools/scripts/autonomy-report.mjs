#!/usr/bin/env node
/**
 * autonomy-report.mjs — CLI for the Session Autonomy Receipt (spec §28).
 *
 * Reads stored canonical receipts from the flat session ledger and renders or
 * verifies them. Extends the existing CLI convention (standalone script, like
 * token-report.mjs) — it does NOT duplicate token-report. Read-only: it never
 * regenerates a receipt (finalization owns generation); it only displays/verifies
 * what was stored, preserving historical pricing snapshots (#21).
 *
 * Usage:
 *   node autonomy-report.mjs --session <id>        render one receipt
 *   node autonomy-report.mjs --session <id> --json raw JSON
 *   node autonomy-report.mjs --session <id> --verify  integrity verdict
 *   node autonomy-report.mjs --latest              most recent receipt
 *   node autonomy-report.mjs --all                 list every receipt
 *   node autonomy-report.mjs --mode <m>            filter --all by consumption mode
 *
 * Zero deps; node:* only. Fail-soft: missing data prints a clear message, exit 0.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { renderTerminal } from './economics/session-autonomy/receipt-render.mjs';
import { verifyReceipt } from './economics/session-autonomy/receipt-integrity.mjs';

const RECEIPT_SUFFIX = '.autonomy-receipt.json';

/** Parses argv into a flat options object. */
function parseArgs(argv) {
  const opts = { session: null, latest: false, all: false, json: false, verify: false, mode: null, dir: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--session') opts.session = argv[++i] ?? null;
    else if (arg === '--latest') opts.latest = true;
    else if (arg === '--all') opts.all = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--verify') opts.verify = true;
    else if (arg === '--mode') opts.mode = argv[++i] ?? null;
    else if (arg === '--dir') opts.dir = argv[++i] ?? null;
  }
  return opts;
}

/** Resolves the flat sessions directory (override via --dir). */
function sessionsDir(opts) {
  return opts.dir ?? join(process.cwd(), '.claude', '.sessions');
}

/** Strips a UTF-8 BOM so JSON.parse never chokes. */
function readJson(filePath) {
  const text = readFileSync(filePath, 'utf8');
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

/** Lists receipt files (newest mtime first) in the sessions dir. */
function listReceipts(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(RECEIPT_SUFFIX))
    .map((name) => ({ name, path: join(dir, name), mtime: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}

/** Loads one receipt by session id; returns null when absent/unreadable. */
function loadReceipt(dir, sessionId) {
  const filePath = join(dir, sessionId + RECEIPT_SUFFIX);
  try { return readJson(filePath); } catch { return null; }
}

function printOne(receipt, opts) {
  if (opts.json) { console.log(JSON.stringify(receipt, null, 2)); return; }
  if (opts.verify) {
    const verdict = verifyReceipt(receipt);
    console.log(`Integrity: ${verdict.status} (hashOk=${verdict.hashOk}, signatureOk=${verdict.signatureOk})`);
    if (verdict.reason) console.log(`  reason: ${verdict.reason}`);
    return;
  }
  console.log(renderTerminal(receipt, {}));
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dir = sessionsDir(opts);

  if (opts.all) {
    const all = listReceipts(dir)
      .map((entry) => { try { return readJson(entry.path); } catch { return null; } })
      .filter(Boolean)
      .filter((r) => !opts.mode || r?.consumption?.mode === opts.mode);
    if (all.length === 0) { console.log('No autonomy receipts found.'); return; }
    if (opts.json) { console.log(JSON.stringify(all, null, 2)); return; }
    for (const receipt of all) {
      console.log(`- ${receipt.sessionId} · ${receipt.consumption?.mode} · ${receipt.claimType} · ${receipt.confidence?.level}`);
    }
    return;
  }

  let receipt = null;
  if (opts.latest) {
    const newest = listReceipts(dir)[0];
    receipt = newest ? (() => { try { return readJson(newest.path); } catch { return null; } })() : null;
  } else if (opts.session) {
    receipt = loadReceipt(dir, opts.session);
  } else {
    console.log('Specify --session <id>, --latest, or --all. See --help in the docs.');
    return;
  }

  if (!receipt) { console.log('No matching autonomy receipt found.'); return; }
  printOne(receipt, opts);
}

main();
