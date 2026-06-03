#!/usr/bin/env node
/**
 * Releases path claims for the current session (Level >= 3).
 *
 * With a path arg: removes just that claim. With no arg: removes ALL claims
 * for this session (deletes the workspace file). Then regenerates WORKSPACE.md.
 *
 * Usage:  node contextkit/tools/scripts/release.mjs [path]
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sanitizeSid } from '../../runtime/hooks/ledger.mjs';
import { writeFileAtomic } from '../../runtime/hooks/safe-io.mjs';

const ROOT = process.cwd();
const WS_DIR = resolve(ROOT, '.claude/.workspace');
const LAST_TOUCHED = resolve(ROOT, '.claude/.sessions/.last-touched');

async function sessionId() {
  try {
    return JSON.parse(await readFile(LAST_TOUCHED, 'utf-8')).sessionId;
  } catch {
    return `local_${process.pid}`;
  }
}

async function main() {
  const target = process.argv[2]?.replaceAll('\\', '/');
  const sid = sanitizeSid(await sessionId());
  const file = resolve(WS_DIR, `${sid}.json`);

  if (!existsSync(file)) {
    console.log('ℹ️  No active claims for this session.');
    return;
  }

  if (!target) {
    await rm(file, { force: true });
    console.log(`✅ Released ALL claims for session ${sid.slice(0, 8)}.`);
  } else {
    const claimRecord = JSON.parse(await readFile(file, 'utf-8'));
    const before = (claimRecord.claims || []).length;
    claimRecord.claims = (claimRecord.claims || []).filter((c) => c.path !== target);
    await writeFileAtomic(file, JSON.stringify(claimRecord, null, 2));
    console.log(before === claimRecord.claims.length ? `ℹ️  No claim matched "${target}".` : `✅ Released claim "${target}".`);
  }

  try {
    execFileSync('node', ['contextkit/tools/scripts/workspace-sync.mjs'], { cwd: ROOT, stdio: 'ignore' });
  } catch {
    /* best effort */
  }
}

main().catch((err) => {
  console.error('❌ release failed:', err);
  process.exit(1);
});
