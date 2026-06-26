#!/usr/bin/env node
/**
 * Stop hook (ADR-0119) — end-of-execution `done/` lifecycle.
 *
 * When a session ends, files every CONCLUDED workflow into its `done/` archive
 * (`<owner>/done/` when owned, else `memory/workflows/done/`). Running it at the
 * Stop boundary — not synchronously inside `workflow advance` — keeps a concluded
 * workflow's path stable for the rest of the command/session that concluded it.
 *
 * Immutable rules honoured: zero third-party deps (the sweep is pure `node:*`);
 * the hook NEVER blocks real work (exits 0 on any error) and stays silent unless
 * it actually filed something.
 */
import { applySweep, planSweep } from '../../tools/scripts/workflow-done-sweep.mjs';

async function main() {
  // Stop hooks receive a JSON payload on stdin; this sweep is global and needs
  // none of it, so we deliberately don't read stdin.
  const filed = applySweep(planSweep(process.cwd()));
  if (filed.length) {
    process.stderr.write(`🧹 done-sweep: filed ${filed.length} concluded workflow(s) into done/.\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`[done-sweep] ${err?.message ?? err}\n`);
  process.exit(0);
});
