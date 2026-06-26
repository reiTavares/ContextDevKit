#!/usr/bin/env node
/**
 * Advisory intake collision gate (ADR-0119).
 *
 * Before intake assigns a BIZ / OP / WF / ADR number, this prints the
 * FLEET-reconciled next number for each kind — the max+1 across every sibling git
 * worktree on this machine, not just the local working copy. When a local-only
 * allocation would differ from the fleet-reconciled one (a parallel session
 * already holds a higher number), it WARNS and names the reconciled number.
 *
 * It is deliberately ADVISORY: it never blocks, always exits 0. It is the "gate
 * that does not trap" — it triggers the reconcile (this script) rather than
 * halting work, and it spends zero model tokens (pure deterministic scan).
 *
 * Usage:
 *   node contextkit/tools/scripts/intake-collision-gate.mjs            # table
 *   node contextkit/tools/scripts/intake-collision-gate.mjs --json     # machine
 *
 * Pure `node:*`, zero runtime dependencies; defensive (a non-git tree degrades to
 * a local-only view).
 */
import { localVsFleet } from './registry/ids.mjs';
import { listWorktrees } from './registry/fleet.mjs';

const ROOT = process.cwd();

/** Builds the reconciled report: per-kind rows + the fleet that was considered. */
export function buildReport(root = ROOT) {
  const rows = localVsFleet(root);
  const worktrees = listWorktrees(root).map((tree) => ({ path: tree.path, branch: tree.branch }));
  return { rows, worktrees, diverged: rows.some((row) => row.diverges) };
}

/** Renders the human-readable report. Returns the lines (also used by tests). */
export function renderReport(report) {
  const lines = [];
  lines.push('🔢 Intake collision gate — fleet-reconciled next numbers');
  lines.push('────────────────────────────────────────────────────────');
  lines.push('  kind   local-next   fleet-next   status');
  for (const row of report.rows) {
    const status = row.diverges ? '⚠ use fleet' : 'ok';
    lines.push(
      `  ${row.kind.padEnd(5)}  ${row.local.padEnd(11)}  ${row.fleet.padEnd(11)}  ${status}`,
    );
  }
  lines.push('');
  lines.push(`  fleet: ${report.worktrees.length} worktree(s) considered.`);
  if (report.diverged) {
    const which = report.rows.filter((row) => row.diverges).map((row) => `${row.kind}→${row.fleet}`);
    lines.push('');
    lines.push(`  ⚠ A parallel worktree holds a higher number. Allocate: ${which.join(', ')}`);
    lines.push('    (advisory — nothing is blocked; use the fleet-next value at intake.)');
  } else {
    lines.push('  ✅ No divergence — the local next number is fleet-safe.');
  }
  return lines;
}

function main() {
  const report = buildReport(ROOT);
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderReport(report).join('\n')}\n`);
  }
  // Advisory by contract: always succeed, even on divergence.
  process.exit(0);
}

// Run only as a CLI; stay importable for the selftest.
if (process.argv[1]?.replace(/\\/g, '/').endsWith('intake-collision-gate.mjs')) {
  main();
}
