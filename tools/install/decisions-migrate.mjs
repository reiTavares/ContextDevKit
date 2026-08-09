/**
 * Decisions ownership-based filing on `--update` (ADR-0123).
 *
 * Files loose top-level ADRs into the folder their OWNER implies (BIZ/OP → their
 * folder; ownerless → legacy/), by running the TARGET's installed
 * `decisions-file.mjs` after the engine is copied. A fresh install with no loose
 * ADRs is a no-op. Fail-open: any error is reported and swallowed — a decisions
 * tidy never blocks an update. Zero third-party deps.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Files loose ADRs by owner in the target's installed decisions tree.
 *
 * @param {string} target - project root.
 * @param {string[]} report - mutated with a progress line when files move.
 */
export function migrateDecisions(target, report) {
  try {
    const script = join(target, 'contextkit', 'tools', 'scripts', 'decisions-file.mjs');
    if (!existsSync(script)) return;
    const child = spawnSync(process.execPath, [script, '--write'], { cwd: target, encoding: 'utf-8' });
    const filed = (child.stdout || '').match(/filed (\d+)/);
    if (filed && Number(filed[1]) > 0) {
      report.push(`✓ filed ${filed[1]} loose ADR(s) by owner into decisions/{business,operations,legacy}/ (ADR-0123)`);
    }
  } catch (err) {
    report.push(`ℹ️  decisions filing skipped: ${err?.message ?? err}`);
  }
}
