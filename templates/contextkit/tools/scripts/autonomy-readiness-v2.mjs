#!/usr/bin/env node
/**
 * autonomy-readiness-v2.mjs — I/O orchestration + CLI for CDK-077.
 *
 * Composes three pre-existing signals into a broadened autonomy-readiness verdict:
 *   1. v1 marker       — reads `contextkit/memory/autonomy/readiness.json` (read-only,
 *                        never re-runs autonomy-readiness.mjs).
 *   2. engineering scorecard — calls engineeringScorecard() from CDK-076 fail-open.
 *   3. capability-compliance — reused from the scorecard's dimension (no re-derivation).
 *
 * This module DOES NOT replace autonomy-readiness.mjs (v1). It COMPOSES it.
 * Advisory + read-only + UNREGISTERED + fail-open. Zero writes. Always exits 0.
 *
 * §8 Safety contract: ready defaults to false. A missing or unreadable v1 marker
 * or scorecard error marks that signal `present:false` and keeps ready:false.
 * Graceful degradation = false-negative, never false-positive (unproven stays unproven).
 *
 * Usage: node autonomy-readiness-v2.mjs [--json]
 * CDK-077 / ADR-0072. ≤ 308 lines.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { pathsFor } from '../../runtime/config/paths.mjs';
import { assessReadiness } from './autonomy-readiness-v2-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Dynamic import helper
// ---------------------------------------------------------------------------

/**
 * Resolves a sibling path relative to this file's directory and returns a
 * file URL href safe for dynamic import(). Uses pathToFileURL — never a
 * hand-rolled `file:///` regex (rule 4).
 *
 * @param {string} rel relative path from this file's directory
 * @returns {string} file URL href
 */
function siblingUrl(rel) {
  return pathToFileURL(resolve(__dirname, rel)).href;
}

// ---------------------------------------------------------------------------
// v1 marker reader
// ---------------------------------------------------------------------------

/**
 * Reads the v1 readiness marker from disk, fail-open.
 * The marker file is written by autonomy-readiness.mjs (v1) to
 * `<root>/contextkit/memory/autonomy/readiness.json` — read-only here,
 * never re-run v1, never write it.
 *
 * Shape on success: `{ coverageGreen:boolean, attributionPresent:boolean, ts:string, detail:object }`
 * Returns `null` if the file is absent, unreadable, or unparseable.
 *
 * @param {string} root project root
 * @returns {{ coverageGreen: boolean, attributionPresent: boolean, ts: string, detail: object }|null}
 */
function readV1Marker(root) {
  const markerPath = resolve(pathsFor(root).memory, 'autonomy', 'readiness.json');
  try {
    const raw = readFileSync(markerPath, 'utf-8');
    const parsed = JSON.parse(raw);
    // Validate minimal required shape — both booleans must be present.
    if (typeof parsed.coverageGreen !== 'boolean' || typeof parsed.attributionPresent !== 'boolean') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Scorecard gatherer
// ---------------------------------------------------------------------------

/**
 * Calls engineeringScorecard() from CDK-076 fail-open.
 * Returns null on any error so the scorecard signals are marked present:false.
 *
 * @param {string} root project root
 * @returns {Promise<import('./engineering-scorecard.mjs').engineeringScorecard|null>}
 */
async function gatherScorecard(root) {
  try {
    const { engineeringScorecard } = await import(siblingUrl('./engineering-scorecard.mjs'));
    return await engineeringScorecard(root);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds the composite autonomy-readiness-v2 report for the given project root.
 *
 * Reads the v1 marker (fail-open) and gathers the engineering scorecard
 * (fail-open), then delegates the verdict to the pure assessReadiness() core.
 * Never writes to disk. Never re-runs v1. Always resolves (never throws).
 *
 * @param {string} [root] project root (defaults to process.cwd())
 * @returns {Promise<{
 *   schemaVersion: number,
 *   ready: boolean,
 *   signals: import('./autonomy-readiness-v2-core.mjs').Signal[],
 *   v1: object|null,
 *   scorecard: { score: number|null, band: string|null }|null,
 *   confidence: string,
 *   sources: { present: string[], skipped: string[] }
 * }>}
 */
export async function autonomyReadinessV2(root = process.cwd()) {
  const sourcesPresent = [];
  const sourcesSkipped = [];

  // Read v1 marker (fail-open — absent → null → signals marked present:false).
  const v1Marker = readV1Marker(root);
  if (v1Marker !== null) {
    sourcesPresent.push('v1-marker');
  } else {
    sourcesSkipped.push('v1-marker');
  }

  // Gather scorecard fail-open.
  const scorecardFull = await gatherScorecard(root);
  if (scorecardFull !== null) {
    sourcesPresent.push('scorecard');
  } else {
    sourcesSkipped.push('scorecard');
  }

  // Build the inputs shape the pure core expects.
  const coreInputs = {
    v1: v1Marker,
    scorecard: scorecardFull
      ? { overall: scorecardFull.overall, dimensions: scorecardFull.dimensions }
      : null,
  };

  const { ready, signals, confidence } = assessReadiness(coreInputs);

  return {
    schemaVersion: SCHEMA_VERSION,
    ready,
    signals,
    v1: v1Marker,
    scorecard: scorecardFull
      ? { score: scorecardFull.overall.score, band: scorecardFull.overall.band }
      : null,
    confidence,
    sources: { present: sourcesPresent, skipped: sourcesSkipped },
  };
}

// ---------------------------------------------------------------------------
// CLI — advisory, always exits 0
// ---------------------------------------------------------------------------

/**
 * Determines if this module is the direct CLI entrypoint.
 * Prevents CLI execution when imported as a library.
 *
 * @returns {boolean}
 */
function isMain() {
  if (!process.argv[1]) return false;
  try {
    return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
  } catch { return false; }
}

if (isMain()) {
  const jsonFlag = process.argv.slice(2).includes('--json');
  const root = process.cwd();

  autonomyReadinessV2(root)
    .then((report) => {
      if (jsonFlag) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log('\n[autonomy-readiness-v2] CDK-077 — Composite Autonomy Readiness\n');
        const readyLabel = report.ready ? 'READY' : 'NOT READY';
        console.log(`  Verdict    : ${readyLabel}  (confidence: ${report.confidence})`);
        console.log('');
        for (const sig of report.signals) {
          const stateStr = sig.present
            ? (sig.pass ? 'PASS' : 'FAIL')
            : 'MISSING';
          console.log(`  ${sig.key.padEnd(28)} ${stateStr.padEnd(8)} ${sig.detail}`);
        }
        console.log('');
        console.log(`  v1 marker  : ${report.v1 !== null ? 'present' : 'absent (skipped)'}`);
        const scStr = report.scorecard !== null
          ? `score ${report.scorecard.score ?? 'n/a'} (${report.scorecard.band ?? 'n/a'})`
          : 'unavailable (skipped)';
        console.log(`  scorecard  : ${scStr}`);
        console.log(`  Sources present : ${report.sources.present.join(', ') || 'none'}`);
        console.log(`  Sources skipped : ${report.sources.skipped.join(', ') || 'none'}`);
        console.log('');
        if (!report.ready) {
          const missing = report.signals.filter((s) => !s.present || !s.pass).map((s) => s.key);
          console.log(`  Blocking signals: ${missing.join(', ')}`);
        }
        console.log();
      }
      process.exit(0);
    })
    .catch((err) => {
      // Fail-open: log to stderr, exit 0 (advisory tool, never breaks real work).
      process.stderr.write(`[autonomy-readiness-v2] unexpected error: ${err?.message ?? err}\n`);
      process.exit(0);
    });
}
