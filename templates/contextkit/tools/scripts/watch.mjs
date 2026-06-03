#!/usr/bin/env node
/**
 * `/watch` — tail the active session ledger.
 *
 * Default: print every modification recorded in the current session's ledger,
 * formatted one-per-line, then exit.
 *
 * `--follow` (`-f`): re-read the ledger every 500ms and print only entries
 * that appeared since the last read. Exits cleanly on SIGINT (Ctrl-C).
 *
 * Zero deps. Reuses `readMostRecentLedger` from the runtime so the active
 * session resolution stays single-sourced (rule 4).
 *
 * Refused-silently-to-false-negative posture: if the ledger cannot be read,
 * print the error and exit non-zero. Never pretend "0 entries."
 */
import { readMostRecentLedger } from '../../runtime/hooks/ledger.mjs';

const FOLLOW_INTERVAL_MS = 500;

const args = process.argv.slice(2);
const follow = args.includes('-f') || args.includes('--follow');

/**
 * Format one ledger modification for stdout.
 *
 * @param {{ path: string, tool: string, at: number }} mod
 * @returns {string}
 */
export function parseLedgerEntry(mod) {
  if (!mod || typeof mod !== 'object') return '';
  const at = typeof mod.at === 'number' ? new Date(mod.at) : new Date();
  const hh = String(at.getHours()).padStart(2, '0');
  const mm = String(at.getMinutes()).padStart(2, '0');
  const ss = String(at.getSeconds()).padStart(2, '0');
  const tool = (mod.tool || '?').toUpperCase().padEnd(5, ' ');
  const path = mod.path || '<no path>';
  return `[${hh}:${mm}:${ss}] ${tool} ${path}`;
}

async function loadEntries() {
  const result = await readMostRecentLedger();
  if (!result) return { sessionId: null, entries: [] };
  const entries = Array.isArray(result.ledger?.modifications)
    ? result.ledger.modifications
    : [];
  return { sessionId: result.sessionId, entries };
}

async function printAllOnce() {
  const { sessionId, entries } = await loadEntries();
  if (!sessionId) {
    process.stderr.write('no active session — `/log-session` to register or start a new one\n');
    process.exit(1);
  }
  process.stdout.write(`# session ${sessionId} — ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}\n`);
  for (const mod of entries) process.stdout.write(parseLedgerEntry(mod) + '\n');
}

async function follower() {
  let printedCount = 0;
  let lastSessionId = null;
  const tick = async () => {
    try {
      const { sessionId, entries } = await loadEntries();
      if (!sessionId) return;
      if (sessionId !== lastSessionId) {
        process.stdout.write(`# session ${sessionId}\n`);
        lastSessionId = sessionId;
        printedCount = 0;
      }
      for (let i = printedCount; i < entries.length; i++) {
        process.stdout.write(parseLedgerEntry(entries[i]) + '\n');
      }
      printedCount = entries.length;
    } catch (err) {
      process.stderr.write(`watch: ${err.message}\n`);
    }
  };
  await tick();
  const handle = setInterval(tick, FOLLOW_INTERVAL_MS);
  const stop = () => {
    clearInterval(handle);
    process.stdout.write('\n# watch stopped\n');
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

const isMain = (() => {
  try {
    const url = new URL(import.meta.url);
    const arg = process.argv[1] ? new URL('file://' + process.argv[1].replace(/\\/g, '/')) : null;
    return arg && url.pathname.toLowerCase() === arg.pathname.toLowerCase();
  } catch {
    return false;
  }
})();

if (isMain) {
  (follow ? follower() : printAllOnce()).catch((err) => {
    process.stderr.write(`watch: ${err.message}\n`);
    process.exit(1);
  });
}
