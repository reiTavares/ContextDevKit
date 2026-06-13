#!/usr/bin/env node
/**
 * Explicit pre-edit checkpoint — governance parity for hook-less hosts (ticket 095).
 *
 * Claude Code enforces the L5 high-risk gate automatically via the PreToolUse
 * simulate-gate hook. Antigravity has no hook lifecycle, so the agent calls this
 * BEFORE editing a sensitive file:
 *
 *   node ctx.mjs guard <path>      (alias: agy guard <path>)
 *
 * Same decision logic as the hook (shared `matchHighRisk` + ledger simulation
 * coverage); the verdict is the EXIT CODE so playbooks can chain on it:
 *   0 — allowed (below L5, not high-risk, or covered by /simulate-impact)
 *   1 — blocked (high-risk + no covering simulation) or no path given
 *
 * Refuse-by-default (rule 8): a matched path with no simulation record blocks —
 * there is no "assume it's fine" branch.
 */
import { getLevel, loadConfig } from '../../runtime/config/load.mjs';
import { hasSimulationFor, readMostRecentLedger, toRepoRelative } from '../../runtime/hooks/ledger.mjs';
import { matchHighRisk } from '../../runtime/hooks/path-classification.mjs';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PLATFORM_DIR } from '../../runtime/config/paths.mjs';

const ROOT = process.cwd();

function usage() {
  console.log('Usage: node ctx.mjs guard <path>\n\nChecks the L5 high-risk gate for <path> before you edit it.\nExit 0 = allowed · exit 1 = blocked (run the simulate-impact skill first).');
}

async function main() {
  const rawPath = process.argv[2];
  if (!rawPath || rawPath === '--help' || rawPath === '-h') {
    usage();
    process.exit(rawPath ? 0 : 1);
  }

  const level = getLevel(ROOT);
  if (level < 5) {
    console.log(`✅ guard: allowed — L5 gate is inert at Level ${level}.`);
    return;
  }

  const targetPath = toRepoRelative(rawPath);
  const config = await loadConfig(ROOT);
  const matched = matchHighRisk(targetPath, config?.l5?.highRiskPaths ?? []);
  if (!matched) {
    console.log(`✅ guard: allowed — \`${targetPath}\` matches no l5.highRiskPaths entry.`);
    return;
  }

  // No hook payload on this host — the active session is the most recently
  // touched ledger (same resolution as mark-simulation.mjs / slash commands).
  const recent = await readMostRecentLedger();
  if (recent?.ledger && hasSimulationFor(recent.ledger, targetPath)) {
    console.log(`✅ guard: allowed — \`${targetPath}\` is high-risk (\`${matched}\`) but covered by a /simulate-impact record.`);
    
    // Enforce squad compliance checks
    try {
      const auditorPath = resolve(ROOT, PLATFORM_DIR, 'tools/scripts/squad-audit.mjs');
      if (existsSync(auditorPath)) {
        execFileSync('node', [auditorPath], { cwd: ROOT });
      }
    } catch {
      console.log('🛑 guard: BLOCKED — active squad compliance audit failed.');
      process.exit(1);
    }
    return;
  }

  console.log([
    '🛑 guard: BLOCKED — high-risk path with no covering simulation.',
    '',
    `  • path:    ${targetPath}`,
    `  • matched: ${matched}  (l5.highRiskPaths)`,
    '',
    'Required next step — pick ONE:',
    '  1. Run the `simulate-impact` skill ("<one-sentence objective>") to produce a',
    '     Blast Radius Report and mark the ledger, then re-run this guard.',
    '  2. For a genuinely trivial edit (typo / comment), record an auditable bypass:',
    '     node contextkit/tools/scripts/mark-simulation.mjs "BYPASS: <reason>" <path>',
  ].join('\n'));
  process.exit(1);
}

main().catch((err) => {
  // Refuse-by-default: an unexpected failure must not silently allow a high-risk edit.
  console.error(`[guard] error: ${err?.message ?? err}`);
  process.exit(1);
});
