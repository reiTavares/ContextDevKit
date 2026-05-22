#!/usr/bin/env node
/**
 * Releases path claims for the current session (Level >= 3).
 *
 * With a path arg: removes just that claim. With no arg: removes ALL claims
 * for this session (deletes the workspace file). Then regenerates WORKSPACE.md.
 *
 * Usage:  node vibekit/tools/scripts/release.mjs [path]
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

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
  const sid = await sessionId();
  const file = resolve(WS_DIR, `${sid}.json`);

  if (!existsSync(file)) {
    console.log('ℹ️  No active claims for this session.');
    return;
  }

  if (!target) {
    await rm(file, { force: true });
    console.log(`✅ Released ALL claims for session ${sid.slice(0, 8)}.`);
  } else {
    const data = JSON.parse(await readFile(file, 'utf-8'));
    const before = (data.claims || []).length;
    data.claims = (data.claims || []).filter((c) => c.path !== target);
    await writeFile(file, JSON.stringify(data, null, 2), 'utf-8');
    console.log(before === data.claims.length ? `ℹ️  No claim matched "${target}".` : `✅ Released claim "${target}".`);
  }

  try {
    execFileSync('node', ['vibekit/tools/scripts/workspace-sync.mjs'], { cwd: ROOT, stdio: 'ignore' });
  } catch {
    /* best effort */
  }
}

main().catch((err) => {
  console.error('❌ release failed:', err);
  process.exit(1);
});
