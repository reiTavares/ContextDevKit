#!/usr/bin/env node
/**
 * Session digest — compact, deterministic view of recent session logs. [ADR-0027]
 *
 * Replaces "read the last N raw session files" (75–188 lines each) with a ~6-line
 * structured digest per session, so token-heavy commands (`/distill-sessions`,
 * `/retro`, `/tune-agents`) reason over digests and open a full log only on demand.
 * Read-only, zero third-party deps. Parsing is single-sourced in
 * `runtime/hooks/session-digest-core.mjs` (also used by the boot hook — rule 4).
 *
 * Usage:
 *   node vibekit/tools/scripts/session-digest.mjs            # last 10 (human)
 *   node vibekit/tools/scripts/session-digest.mjs --last 5
 *   node vibekit/tools/scripts/session-digest.mjs --id 2026-06-03-36-foo.md
 *   node vibekit/tools/scripts/session-digest.mjs --json     # machine-readable
 */
import { readFile, readdir } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import {
  SESSION_FILENAME_RE,
  parseSessionLog,
  renderDigest,
} from '../../runtime/hooks/session-digest-core.mjs';

const ROOT = process.cwd();
const P = pathsFor(ROOT);
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const readSafe = (abs) => readFile(abs, 'utf-8').catch(() => null);

/** Session files under the sessions dir, newest (by number, then date) first. */
async function listSessions() {
  let files = [];
  try {
    files = await readdir(P.sessions);
  } catch {
    return [];
  }
  return files
    .map((f) => ({ f, m: SESSION_FILENAME_RE.exec(f) }))
    .filter((e) => e.m)
    .map((e) => ({ filename: e.f, number: Number.parseInt(e.m[2], 10), date: e.m[1] }))
    .sort((a, b) => b.number - a.number || b.date.localeCompare(a.date));
}

/** Parse one session file into a record (null when unreadable). */
async function recordFor(filename) {
  const text = await readSafe(resolve(P.sessions, filename));
  if (text === null) return null;
  return parseSessionLog(text, filename);
}

async function main() {
  const id = opt('--id');
  let records;
  if (id) {
    const rec = await recordFor(basename(id));
    records = rec ? [rec] : [];
  } else {
    const last = Math.max(1, Number.parseInt(opt('--last') || '10', 10) || 10);
    const picked = (await listSessions()).slice(0, last);
    records = (await Promise.all(picked.map((e) => recordFor(e.filename)))).filter(Boolean);
  }

  if (flag('--json')) {
    process.stdout.write(JSON.stringify({ count: records.length, sessions: records }, null, 2) + '\n');
    return;
  }

  if (records.length === 0) {
    console.log('No session logs found (vibekit/memory/sessions/). Register one with /log-session.');
    return;
  }
  console.log(`\n🧬  Session digest — ${records.length} session(s), newest first\n`);
  const blocks = records.map((r) => renderDigest(r) || '_(unparseable session — open the full log)_');
  console.log(blocks.join('\n\n'));
  console.log('\nOpen a full log only if a digest flags something to inspect.');
}

main().catch((err) => {
  console.error('❌ session-digest failed:', err?.message ?? err);
  process.exit(1);
});
