#!/usr/bin/env node
/**
 * Wiring-drift guard CLI (CDK-068, PKG-06).
 *
 * Detects drift between a project's INSTALLED artifacts and what the kit source
 * expects, across three dimensions:
 *   1. Wiring     — installed .claude/settings.json hooks vs source-expected hooks.
 *   2. Config     — installed contextkit/config.json vs the DEFAULT_CONFIG key set.
 *   3. Instruction — installed CLAUDE.md vs expected managed-section markers.
 *
 * Advisory: NEVER blocks — always exits 0. Missing installed artifacts are reported
 * as 'skipped' (fail-open → graceful degradation, never a false-pass or false-fail).
 *
 * Usage:
 *   node wiring-drift.mjs [--root <dir>] [--level <n>] [--json]
 *
 * Dimension logic lives in wiring-drift-checks.mjs (pure I/O helpers + per-dimension
 * runners). Core comparison logic lives in wiring-drift-core.mjs (pure, testable).
 * Rule 4: no 'contextkit/...' literal in resolve()/join() calls in this file.
 *
 * @module wiring-drift
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI arg parsing ──────────────────────────────────────────────────────────

/**
 * Parses `--root <dir>`, `--level <n>`, `--json` from process.argv.
 *
 * @returns {{ root: string, level: number, json: boolean }}
 */
function parseArgs() {
  const args = process.argv.slice(2);
  let root = process.cwd();
  let level = 0; // 0 = auto-detect from installed config (fallback: 2)
  let json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && args[i + 1]) root = resolve(args[++i]);
    else if (args[i] === '--level' && args[i + 1]) level = Number(args[++i]) || 0;
    else if (args[i] === '--json') json = true;
  }
  return { root, level, json };
}

// ── Report rendering ─────────────────────────────────────────────────────────

/**
 * Renders drift rows as a markdown-style aligned text table with a verdict summary.
 *
 * @param {import('./wiring-drift-checks.mjs').DriftRow[]} rows
 * @param {number} level active level used for wiring check
 * @returns {string}
 */
function renderTable(rows, level) {
  const lines = [
    `## Wiring-Drift Report  (level ${level})`,
    '',
    '| dimension   | item                              | status           |',
    '|-------------|-----------------------------------|------------------|',
  ];
  for (const row of rows) {
    const dim    = row.dimension.padEnd(11);
    const item   = row.item.length > 33 ? row.item.slice(0, 30) + '...' : row.item.padEnd(33);
    const status = row.status.padEnd(16);
    lines.push(`| ${dim} | ${item} | ${status} |`);
    if (row.detail) lines.push(`|             |   ${row.detail}`);
  }
  lines.push('');

  const driftCount = rows.filter((r) => !['ok', 'skipped'].includes(r.status)).length;
  const skippedCount = rows.filter((r) => r.status === 'skipped').length;
  if (driftCount === 0 && skippedCount === 0) {
    lines.push('**No drift detected.**');
  } else if (driftCount === 0) {
    lines.push(`**No drift detected** (${skippedCount} dimension(s) skipped — artifacts not present).`);
  } else {
    const affectedDims = new Set(
      rows.filter((r) => !['ok', 'skipped'].includes(r.status)).map((r) => r.dimension),
    );
    lines.push(`**Drift: ${driftCount} item(s)** across ${affectedDims.size} dimension(s).`);
    lines.push('Advisory — this report is informational. No action is blocked.');
  }
  lines.push('');
  return lines.join('\n');
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Lazy-import checks module to keep this file's line count under budget.
  const checksUrl = pathToFileURL(
    resolve(__dirname, 'wiring-drift-checks.mjs'),
  ).href;
  const { checkWiringDrift, checkConfigDrift, checkInstructionDrift, resolveLevel } =
    await import(checksUrl);

  const { root, level: argLevel, json } = parseArgs();

  // Resolve the effective level: CLI arg → installed config → fallback 2.
  const effectiveLevel = argLevel || (await resolveLevel(root));

  // Run all three dimension checks concurrently (fail-open: each is independent).
  const [wiringRows, configRows] = await Promise.all([
    checkWiringDrift(root, effectiveLevel),
    checkConfigDrift(root),
  ]);
  const instructionRows = checkInstructionDrift(root);

  const allRows = [...wiringRows, ...configRows, ...instructionRows];

  if (json) {
    process.stdout.write(JSON.stringify(allRows, null, 2) + '\n');
  } else {
    process.stdout.write(renderTable(allRows, effectiveLevel));
  }

  process.exit(0); // Advisory: exit 0 always.
}

main().catch((err) => {
  // Belt-and-suspenders: even an unhandled error must not block real work.
  process.stderr.write(`[wiring-drift] unexpected error: ${err?.message ?? err}\n`);
  process.exit(0);
});
