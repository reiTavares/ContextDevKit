#!/usr/bin/env node
/**
 * task-compiler.mjs — read/compile-only Task Compiler ladder CLI (WF0021 Phase-1,
 * instrumented under OP-0001 / WF-0039 / ADR-0117).
 *
 * WHY this exists: tc-packet/tc-route/tc-dispatch/tc-accept ship as pure Phase-1
 * libraries with no runnable surface, so they emit no telemetry and the agent
 * cannot exercise them. This CLI gives the four stages ONE honest, runnable
 * entry point — compile a work-packet for a symbol, then route, plan (dry-run),
 * and evaluate acceptance over that packet — emitting `<stage> fired` for each
 * stage it actually invokes.
 *
 * Honesty + scope: read/compile-only. planDispatch runs with `execute:false`
 * (no spawn, no source mutation), so this never crosses the Task Compiler
 * measurement-gate / kill-criterion (ADR-0087..0090) and is NOT wired into any
 * hook — it fires only when a human/agent runs it. `fired` means "the stage was
 * invoked" (attempted), never "its recommendation was adopted".
 *
 * Zero runtime dependencies — node:* and sibling economy modules only.
 * @module economy/task-compiler
 */
import { compilePacket } from './tc-packet.mjs';
import { resolveExecution } from './tc-route.mjs';
import { planDispatch } from './tc-dispatch.mjs';
import { evaluateAcceptance } from './tc-accept.mjs';
import { emitEconomy } from './telemetry-emit.mjs';

const FIRED = { category: 'advisory', action: 'fired', measurement: 'none' };

/**
 * Runs the route → dispatch → accept stages over an already-compiled work-packet,
 * emitting one `fired` telemetry row per stage invoked. Each stage is wrapped so
 * a stage that throws on validation still records an honest "attempted" — and the
 * later stages still run.
 *
 * @param {object} packet - an ADR-0083 work-packet (schemaVersion=cdk-work-packet/*)
 * @param {{ root: string, now?: number, emit?: typeof emitEconomy }} opts
 * @returns {{ route: object|null, plan: object|null, accept: object|null }}
 */
export function compileLadderFrom(packet, { root, now, emit = emitEconomy } = {}) {
  let route = null;
  try { route = resolveExecution(packet, {}); } catch { /* attempted */ }
  emit(root, 'tc-route', FIRED, { now });

  let plan = null;
  try { plan = planDispatch(packet, { execute: false, root }); } catch { /* attempted */ }
  emit(root, 'tc-dispatch', FIRED, { now });

  let accept = null;
  try { accept = evaluateAcceptance(packet?.acceptanceCriteria ?? [], {}); } catch { /* attempted */ }
  emit(root, 'tc-accept', FIRED, { now });

  return { route, plan, accept };
}

/**
 * Compiles a work-packet for `symbol`, then runs the downstream ladder when the
 * packet compiled (a skipped packet has nothing to route). Emits `tc-packet
 * fired` for the compile attempt regardless of outcome (it ran).
 *
 * @param {{ objective?: string, symbol: string, root: string }} input
 * @param {{ now?: number }} [opts={}]
 * @returns {{ packet: object, route?: object|null, plan?: object|null, accept?: object|null }}
 */
export function runTaskCompiler({ objective, symbol, root }, opts = {}) {
  const now = opts.now;
  const packet = compilePacket({ objective, symbol, root }, { now });
  emitEconomy(root, 'tc-packet', FIRED, { now });
  if (packet && packet.status !== 'skipped') {
    return { packet, ...compileLadderFrom(packet, { root, now }) };
  }
  return { packet };
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { objective: '', symbol: '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--symbol') out.symbol = argv[++i] ?? '';
    else if (argv[i] === '--objective') out.objective = argv[++i] ?? '';
    else if (!out.symbol) out.symbol = argv[i];
  }
  return out;
}

function main() {
  const { objective, symbol } = parseArgs(process.argv.slice(2));
  if (!symbol) {
    process.stderr.write('Usage: task-compiler.mjs --symbol <name> [--objective "..."]\n');
    process.exit(1);
  }
  const result = runTaskCompiler({ objective, symbol, root: process.cwd() }, { now: Date.now() });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (process.argv[1]?.endsWith('task-compiler.mjs')) main();
