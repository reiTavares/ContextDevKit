#!/usr/bin/env node
/**
 * Reserves one or more paths for the current session (Level >= 3).
 *
 * Writes/updates `.claude/.workspace/<sid>.json`, then regenerates
 * `vibekit/memory/WORKSPACE.md`. The current session id is read from the
 * `.last-touched` pointer the hooks maintain.
 *
 * Usage:  node vibekit/tools/scripts/claim.mjs <path> [path2 ...]
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sanitizeSid } from '../../runtime/hooks/ledger.mjs';
import { writeFileAtomic } from '../../runtime/hooks/safe-io.mjs';

const ROOT = process.cwd();
const WS_DIR = resolve(ROOT, '.claude/.workspace');
const LAST_TOUCHED = resolve(ROOT, '.claude/.sessions/.last-touched');

// execFileSync (argv array, no shell) — consistent with the other git callers.
function gitOut(args, fallback) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || fallback;
  } catch {
    return fallback;
  }
}

async function sessionId() {
  try {
    return JSON.parse(await readFile(LAST_TOUCHED, 'utf-8')).sessionId;
  } catch {
    return `local_${process.pid}`;
  }
}

async function main() {
  const paths = process.argv.slice(2).map((p) => p.replaceAll('\\', '/'));
  if (paths.length === 0) {
    console.error('Usage: claim.mjs <path> [path2 ...]');
    process.exit(1);
  }
  const sid = sanitizeSid(await sessionId());
  await mkdir(WS_DIR, { recursive: true });
  const file = resolve(WS_DIR, `${sid}.json`);

  let data = { sessionId: sid, branch: gitOut(['symbolic-ref', '--short', 'HEAD'], 'detached'), user: gitOut(['config', 'user.name'], 'unknown'), startedAt: Date.now(), lastHeartbeat: Date.now(), claims: [] };
  if (existsSync(file)) {
    try {
      data = { ...data, ...JSON.parse(await readFile(file, 'utf-8')) };
    } catch {
      /* recreate */
    }
  }
  data.lastHeartbeat = Date.now();
  const existing = new Set((data.claims || []).map((c) => c.path));
  for (const p of paths) {
    if (!existing.has(p)) data.claims.push({ path: p, claimedAt: Date.now() });
  }
  await writeFileAtomic(file, JSON.stringify(data, null, 2));

  try {
    execFileSync('node', ['vibekit/tools/scripts/workspace-sync.mjs'], { cwd: ROOT, stdio: 'ignore' });
  } catch {
    /* best effort */
  }
  console.log(`✅ Claimed ${paths.length} path(s) for session ${sid.slice(0, 8)}: ${paths.join(', ')}`);
}

main().catch((err) => {
  console.error('❌ claim failed:', err);
  process.exit(1);
});
