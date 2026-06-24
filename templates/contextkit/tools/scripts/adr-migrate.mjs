/**
 * ADR Migration Pipeline — orchestrator + CLI (BIZ-0001 / WF-0037, B4-T1).
 *
 * Runs the full ADR-specific pipeline shape:
 *   discover → audit → propose → dry-run → ref-impact → collision → apply → verify → receipt
 *
 * Extends the proven `migration-plan.mjs` (A4) pipeline shape with two extra
 * steps: **ref-impact** (cross-file reference count) and **collision** (id/path
 * collision between legacy and new-format ADRs). Step logic lives in
 * `adr-migrate-core.mjs` (SRP split: orchestration vs step logic).
 *
 * Constitution §8 — dry-run DEFAULT, apply requires explicit `--write` (CLI)
 * or `opts.apply = true` (API) AND `opts.humanApproved = true`. No auto-moves.
 *
 * Zero runtime dependencies — `node:*` only.
 */
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADR_PIPELINE_STEPS,
  stepDiscover,
  stepAudit,
  stepPropose,
  stepDryRun,
  stepRefImpact,
  stepApply,
  stepVerify,
  buildReceipt,
  tryImport,
} from './adr-migrate-core.mjs';

export { ADR_PIPELINE_STEPS };

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = resolve(SCRIPT_DIR, 'registry/decision.mjs');

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Plans (and optionally executes) an ADR migration on `root`.
 *
 * Dry-run is the DEFAULT (constitution §8). Nothing is written unless
 * `opts.apply === true` AND `opts.humanApproved === true`.
 *
 * @param {string}  root - absolute project root.
 * @param {object} [opts]
 * @param {boolean} [opts.apply=false]         - perform actual moves.
 * @param {boolean} [opts.humanApproved=false] - explicit human gate.
 * @param {{ from: string, to: string, type?: string, reason?: string }[]} [opts.moves]
 * @param {string}  [opts.now]                 - injected ISO timestamp (testing).
 * @returns {Promise<object>} full pipeline result with receipt.
 */
export async function planAdrMigration(root, opts = {}) {
  const resolvedRoot = resolve(String(root));
  const now = opts.now ?? new Date().toISOString();
  const stepsCompleted = [];

  // DISCOVER
  const legacyEntries = await stepDiscover(resolvedRoot);
  stepsCompleted.push('discover');

  // Load new-format rows from registry (fail-open: empty array when absent).
  let newRows = [];
  const buildFn = await tryImport(REGISTRY_PATH, 'buildDecisionRegistry');
  if (buildFn) {
    try { newRows = buildFn(resolvedRoot).decisions.filter((r) => r.format === 'new'); }
    catch { /* fail-open */ }
  }

  // AUDIT
  const collisions = stepAudit(legacyEntries, newRows);
  stepsCompleted.push('audit');

  // PROPOSE
  const proposed = stepPropose(collisions, opts);
  stepsCompleted.push('propose');

  // DRY-RUN
  const dryRunLines = stepDryRun(proposed);
  stepsCompleted.push('dry-run');

  // REF-IMPACT
  const refImpact = stepRefImpact(resolvedRoot, proposed);
  stepsCompleted.push('ref-impact');

  // COLLISION (computed in audit; step marker for pipeline parity with A4 shape)
  stepsCompleted.push('collision');

  // APPLY
  const { refused, reason, appliedMoves } = stepApply(proposed, opts);
  const applied = appliedMoves.length > 0;
  stepsCompleted.push('apply');

  // VERIFY
  const verification = stepVerify(proposed, appliedMoves);
  stepsCompleted.push('verify');

  // RECEIPT
  const receipt = buildReceipt(resolvedRoot, proposed, applied, appliedMoves, reason ?? null, now);
  stepsCompleted.push('receipt');

  return {
    steps: ADR_PIPELINE_STEPS,
    stepsCompleted,
    legacyEntries,
    newRows,
    collisions,
    proposed,
    dryRunLines,
    refImpact,
    applied,
    refused: reason ?? null,
    verification,
    receipt,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point — node adr-migrate.mjs [--write] [--human-approved] [--root=]
// ---------------------------------------------------------------------------

function parseCliFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === '--write') flags.apply = true;
    else if (t === '--human-approved') flags.humanApproved = true;
    else if (t === '--json') flags.json = true;
    else if (t === '--root' && argv[i + 1]) { flags.root = argv[i + 1]; i += 1; }
    else if (t.startsWith('--root=')) flags.root = t.slice(7);
  }
  return flags;
}

async function main() {
  const flags = parseCliFlags(process.argv.slice(2));
  const result = await planAdrMigration(flags.root ?? process.cwd(), {
    apply: flags.apply ?? false,
    humanApproved: flags.humanApproved ?? false,
  });
  if (flags.json) { process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return; }

  console.log(`adr-migrate: ${result.stepsCompleted.join(' → ')}`);
  console.log(`  discovered ${result.legacyEntries.length} legacy ADR(s), ${result.newRows.length} new-format row(s)`);
  if (result.collisions.length) {
    console.log(`  ${result.collisions.length} collision(s):`);
    for (const c of result.collisions) console.log(`    ${JSON.stringify(c)}`);
  }
  for (const line of result.dryRunLines) console.log(`  ${line}`);
  if (!result.dryRunLines.length) console.log('  [dry-run] no moves proposed.');
  if (result.refImpact.length) {
    console.log('  ref-impact:');
    for (const r of result.refImpact) console.log(`    ${basename(r.from)}: ${r.referenceCount} reference(s)`);
  }
  if (result.refused) console.error(`REFUSED: ${result.refused}`);
  else if (result.applied) console.log(`  applied ${result.receipt.appliedCount} move(s).`);
  else console.log('  dry-run complete — pass --write --human-approved to execute.');
  console.log(`  receipt checksum: ${result.receipt.checksum}`);
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
if (isMain) main().catch((err) => { console.error(err); process.exit(1); });
