#!/usr/bin/env node
/**
 * quality-gates.mjs (Level >= minLevel) — multi-language pre-push quality gate.
 *
 * Detects the project stack (10 languages + generic) and runs the appropriate
 * lint / format / typecheck / build / test, scoped to the monorepo packages the
 * push actually touches. A zero-dependency port of nolrm/contextkit's bash
 * `pre-push` (ADR-0062): `node:*` + `node:child_process` only, no bash-isms.
 *
 * Called BY the pre-push wrapper AFTER its conflict pre-check, and is also
 * standalone-runnable (reads the git pre-push stdin: `local-ref local-sha
 * remote-ref remote-sha`, exits 0/1).
 *
 * Warn-first contract (reconciles "on-by-level" with rule 2 "hooks never break
 * work"): below `minLevel` or `enabled:false` → silent exit 0. At
 * `minLevel <= level < strictLevel` → run gates, print failures, but EXIT 0
 * (warn). At `level >= strictLevel` → a failing gate EXITS 1 (block). A missing
 * tool is reported SKIPPED, never counted as a failure (rule 8: never a
 * false-negative). A gate key in `disabled[]` is skipped silently.
 *
 * This file owns the ORCHESTRATION (config, level thresholds, push-range, summary);
 * the stack detection + per-language gate matrix live in `quality-gate-runners.mjs`
 * (split for the line budget — the runners take a shared accumulator, no closure tie).
 */
import { readFileSync } from 'node:fs';
import { loadConfigSync } from '../config/load.mjs';
import { detectProjectType, makeAccumulator, runNodeGates, runOtherGates } from './quality-gate-runners.mjs';

const ROOT = process.cwd();

/** Read the push range from git's pre-push stdin (best effort). */
function readPushRange() {
  let local = '';
  let remote = '';
  try {
    const raw = readFileSync(0, 'utf-8').trim();
    if (raw) {
      const parts = raw.split('\n')[0].split(/\s+/);
      [, local, , remote] = parts;
    }
  } catch {
    /* no stdin — standalone run */
  }
  return { local: local || '', remote: remote || '' };
}

function main() {
  const cfg = loadConfigSync(ROOT);
  const level = Number(cfg.level) || 1;
  const gate = cfg.qualityGate || {};
  if (gate.enabled === false) process.exit(0);
  const minLevel = Number.isFinite(gate.minLevel) ? gate.minLevel : 3;
  const strictLevel = Number.isFinite(gate.strictLevel) ? gate.strictLevel : 4;
  if (level < minLevel) process.exit(0); // below entry → silent

  const sha = readPushRange();
  const type = detectProjectType();
  console.error('');
  console.error(`Quality Gates (${type}) — ${level >= strictLevel ? 'block' : 'warn'} mode`);

  if (type === 'generic') {
    console.error('  No framework detected — no automatic checks to run.');
    process.exit(0);
  }

  const acc = makeAccumulator(Array.isArray(gate.disabled) ? gate.disabled : []);
  if (type === 'node') runNodeGates(acc, sha);
  else runOtherGates(type, acc);

  const { passed, skipped, failures } = acc.state;
  console.error(`  ${passed} passed, ${skipped} skipped, ${failures.length} failed`);
  if (failures.length === 0) process.exit(0);

  console.error('');
  for (const f of failures) console.error(`  ✗ ${f}`);
  if (level >= strictLevel) {
    console.error('\n  ❌ Quality Gates FAILED — push blocked.');
    console.error('     Bypass (audited): CONTEXT_SKIP_QGATES=1 git push ...');
    process.exit(1);
  }
  console.error('\n  ⚠️  Quality Gates failed (warn mode — push allowed). Fix before raising the level.');
  process.exit(0);
}

if (process.env.CONTEXT_SKIP_QGATES === '1') process.exit(0);
try {
  main();
} catch (err) {
  process.stderr.write(`[quality-gates] ${err?.message ?? err}\n`);
  process.exit(0); // rule 2: never break a real push on our own bug
}
