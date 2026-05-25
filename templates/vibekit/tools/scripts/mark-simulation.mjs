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
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { markSimulation, readLedger, toRepoRelative, writeLedger } from '../../runtime/hooks/ledger.mjs';
import { pathsFor } from '../../runtime/config/paths.mjs';

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
  const predFile = await writePrediction(sid, objective, coveredPaths);
  markSimulation(ledger, { objective, coveredPaths, predictionFile: predFile });
  await writeLedger(sid, ledger);
  console.log(`✅ Simulation recorded for session ${sid.slice(0, 8)} covering: ${coveredPaths.join(', ')}`);
  if (predFile) console.log(`   📄 prediction trail: ${predFile}`);
}

/** Writes a prediction file (ancestor parity) for a later predicted-vs-actual review. */
async function writePrediction(sid, objective, coveredPaths) {
  const date = new Date().toISOString().slice(0, 10);
  const slug = objective.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'prediction';
  const rel = `vibekit/memory/predictions/${date}-${sid.slice(0, 8)}-${slug}.md`;
  try {
    await mkdir(pathsFor(process.cwd()).predictions, { recursive: true });
    await writeFile(resolve(process.cwd(), rel), [
      `# Prediction — ${objective}`,
      '',
      `- **Date**: ${date}`,
      `- **Session**: ${sid.slice(0, 8)}`,
      `- **Covered paths**: ${coveredPaths.join(', ') || '—'}`,
      '',
      '## Predicted blast radius',
      '_What you expect to change + the risks (from /simulate-impact)._',
      '',
      '## Actual — fill on review',
      '_What actually changed. Was the prediction right? Lessons for next time._',
      '',
    ].join('\n'), 'utf-8');
    return rel;
  } catch {
    return null;
  }
}

main().catch((err) => {
  console.error('❌ mark-simulation failed:', err);
  process.exit(1);
});
