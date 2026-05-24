#!/usr/bin/env node
/**
 * Closes the predicted-vs-actual loop (ancestor parity).
 *
 * `/simulate-impact` (mark-simulation.mjs) writes a prediction file per run with
 * an empty "Actual" section. This script fills that section from the session
 * ledger: the paths actually changed (`modifications[]`) compared against what
 * the simulation predicted (`simulations[].coveredPaths`). It computes the delta
 * in both directions so a later review can see where the prediction was right or
 * wrong.
 *
 * Usage:
 *   node vibekit/tools/scripts/predictions-review.mjs            # current session
 *   node vibekit/tools/scripts/predictions-review.mjs <sessionId>
 *
 * Defensive: never throws fatally; exits 0 with a message when there is nothing
 * to review. Zero third-party deps (hot-path invariant).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readLedger, readMostRecentLedger, toRepoRelative } from '../../runtime/hooks/ledger.mjs';

const ROOT = process.cwd();
const PREDICTIONS_PREFIX = 'vibekit/memory/predictions/';

/** True when a covered entry (file, or dir prefix ending in `/`) matches a path. */
function covers(coveredEntry, actualPath) {
  if (coveredEntry.endsWith('/')) return actualPath.startsWith(coveredEntry);
  return actualPath === coveredEntry;
}

/** Unique repo-relative paths this session actually changed (excludes prediction files). */
function actualChangedPaths(ledger) {
  const seen = new Set();
  for (const mod of ledger.modifications || []) {
    const rel = toRepoRelative(mod?.path);
    if (!rel || rel.startsWith(PREDICTIONS_PREFIX)) continue;
    seen.add(rel);
  }
  return [...seen];
}

const fmt = (paths) => (paths.length ? paths.map((p) => `\`${p}\``).join(', ') : '— none');

/** Builds the filled "Actual" section for one prediction vs the actual changes. */
function actualSection(covered, actual, date) {
  const predictedHit = covered.filter((c) => actual.some((a) => covers(c, a)));
  const predictedMiss = covered.filter((c) => !actual.some((a) => covers(c, a)));
  const unforeseen = actual.filter((a) => !covered.some((c) => covers(c, a)));
  return [
    `## Actual (reviewed ${date})`,
    '',
    `- **Paths actually changed this session**: ${fmt(actual)}`,
    `- **Predicted ✓ and changed**: ${fmt(predictedHit)}`,
    `- **Predicted ✗ but NOT changed**: ${fmt(predictedMiss)}`,
    `- **Changed but NOT predicted**: ${fmt(unforeseen)}`,
    '- **Risk accuracy**: _was the `/simulate-impact` risk level right? note it here_',
    '',
  ].join('\n');
}

/** Replaces the trailing "## Actual" section (stub or prior review) in place. */
function withActual(content, section) {
  return /^## Actual/m.test(content)
    ? content.replace(/^## Actual[\s\S]*$/m, section)
    : `${content.trimEnd()}\n\n${section}`;
}

async function reviewOne(simulation, actual, date) {
  const rel = simulation?.predictionFile;
  if (typeof rel !== 'string' || !rel) return { skipped: true };
  const abs = resolve(ROOT, rel);
  let content;
  try {
    content = await readFile(abs, 'utf-8');
  } catch {
    return { skipped: true, rel };
  }
  const covered = Array.isArray(simulation.coveredPaths) ? simulation.coveredPaths : [];
  await writeFile(abs, withActual(content, actualSection(covered, actual, date)), 'utf-8');
  return { reviewed: true, rel };
}

async function main() {
  const argSid = process.argv[2];
  const found = argSid ? { sessionId: argSid, ledger: await readLedger(argSid) } : await readMostRecentLedger();
  if (!found?.ledger) {
    console.log('ℹ️  No session ledger found — nothing to review.');
    return;
  }
  const simulations = (found.ledger.simulations || []).filter((s) => s?.predictionFile);
  if (simulations.length === 0) {
    console.log(`ℹ️  Session ${found.sessionId.slice(0, 8)} has no /simulate-impact predictions to review.`);
    return;
  }
  const actual = actualChangedPaths(found.ledger);
  const date = new Date().toISOString().slice(0, 10);
  let reviewed = 0;
  for (const simulation of simulations) {
    const result = await reviewOne(simulation, actual, date);
    if (result.reviewed) {
      reviewed++;
      console.log(`✅ Closed predicted-vs-actual loop: ${result.rel}`);
    }
  }
  if (reviewed === 0) console.log('ℹ️  Prediction file(s) missing — nothing written.');
  else console.log(`\n${reviewed} prediction(s) reviewed against ${actual.length} changed path(s).`);
}

main().catch((err) => {
  console.error('❌ predictions-review failed:', err?.message ?? err);
  process.exit(1);
});
