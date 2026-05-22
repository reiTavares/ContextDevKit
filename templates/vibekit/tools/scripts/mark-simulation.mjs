#!/usr/bin/env node
/**
 * Records a `/simulate-impact` result on the current session's ledger so the
 * Level 5 PreToolUse gate authorizes edits inside the covered paths.
 *
 * Usage:
 *   node vibekit/tools/scripts/mark-simulation.mjs "<objective>" <path> [path2 ...]
 *   node vibekit/tools/scripts/mark-simulation.mjs "BYPASS: typo fix" path/to/file
 *
 * Pass directory prefixes WITH a trailing slash to cover everything inside.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { markSimulation, readLedger, toRepoRelative, writeLedger } from '../../runtime/hooks/ledger.mjs';

const LAST_TOUCHED = resolve(process.cwd(), '.claude/.sessions/.last-touched');

async function sessionId() {
  try {
    return JSON.parse(await readFile(LAST_TOUCHED, 'utf-8')).sessionId;
  } catch {
    return `local_${process.pid}`;
  }
}

async function main() {
  const [objective, ...rawPaths] = process.argv.slice(2);
  if (!objective || rawPaths.length === 0) {
    console.error('Usage: mark-simulation.mjs "<objective>" <path> [path2 ...]');
    process.exit(1);
  }
  const coveredPaths = rawPaths.map((p) => {
    const norm = toRepoRelative(p);
    // Preserve an explicit trailing slash (directory claim).
    return p.endsWith('/') && !norm.endsWith('/') ? `${norm}/` : norm;
  });

  const sid = await sessionId();
  const ledger = await readLedger(sid);
  markSimulation(ledger, { objective, coveredPaths, predictionFile: null });
  await writeLedger(sid, ledger);
  console.log(`✅ Simulation recorded for session ${sid.slice(0, 8)} covering: ${coveredPaths.join(', ')}`);
}

main().catch((err) => {
  console.error('❌ mark-simulation failed:', err);
  process.exit(1);
});
