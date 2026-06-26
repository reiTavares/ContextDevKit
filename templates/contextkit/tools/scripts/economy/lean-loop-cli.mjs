#!/usr/bin/env node
/**
 * lean-loop-cli.mjs — runnable surface for the lean-loop seam (WF0020 ECON-08,
 * instrumented under OP-0001 / WF-0039 / ADR-0117).
 *
 * WHY a separate file: lean-loop.mjs sits at the 308-line constitution ceiling,
 * so its CLI lives here. lean-loop.mjs stays a pure library (and `leanLoopSeam`
 * keeps `phase2GlobalDefault:false` — this CLI is NOT the activation it warns
 * against; it only lets a human/agent inspect the delegation decision and emits
 * `lean-loop fired` for the invocation).
 *
 * Usage: node lean-loop-cli.mjs [--controller <name>] [--touch <a,b,c>]
 *
 * Zero runtime dependencies — node:* and sibling economy modules only.
 * @module economy/lean-loop-cli
 */
import { shouldDelegate, leanLoopSeam } from './lean-loop.mjs';
import { emitEconomy } from './telemetry-emit.mjs';

/**
 * Builds the lean-loop summary for the given controller context and emits the
 * `lean-loop fired` telemetry row. Pure-ish: the only side effect is the emit.
 *
 * @param {{ controller?: string, touchSet?: string[] }} context
 * @param {string} root - project root for the ledger
 * @param {{ now?: number }} [opts={}]
 * @returns {{ seam: object, delegation: object }}
 */
export function runLeanLoop(context, root, opts = {}) {
  const delegation = shouldDelegate(context ?? {});
  const seam = leanLoopSeam();
  emitEconomy(root, 'lean-loop', { category: 'advisory', action: 'fired', measurement: 'none' }, { now: opts.now });
  return { seam, delegation };
}

function parseArgs(argv) {
  const out = { controller: undefined, touchSet: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--controller') out.controller = argv[++i];
    else if (argv[i] === '--touch') out.touchSet = String(argv[++i] ?? '').split(',').filter(Boolean);
  }
  return out;
}

if (process.argv[1]?.endsWith('lean-loop-cli.mjs')) {
  const args = parseArgs(process.argv.slice(2));
  const result = runLeanLoop(args, process.cwd(), { now: Date.now() });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
