/**
 * Migration Planning — discover→audit→propose→dry-run→apply→verify→receipt
 * pipeline for ownership-transfer and legacy workflow migrations (BIZ-0001 /
 * WF-0036, A4-T2). Cohesion note: all seven pipeline steps and the CLI entry
 * point form one indivisible unit — splitting would scatter a single workflow.
 *
 * Default posture is dry-run (constitution §8). Apply requires `opts.apply=true`
 * AND `opts.humanApproved=true` for ownership transfers. Atomic writes use
 * tmp+rename. Zero runtime dependencies — `node:*` only.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const IDS_PATH = resolve(SCRIPT_DIR, 'registry/ids.mjs');
const WF_PATH  = resolve(SCRIPT_DIR, 'registry/workflow.mjs');

/** Pipeline step names in canonical execution order. */
export const PIPELINE_STEPS = ['discover', 'audit', 'propose', 'dry-run', 'apply', 'verify', 'receipt'];

const REFUSAL_NO_APPROVAL =
  'Ownership transfer refused: opts.humanApproved must be true. ' +
  'A human actor must explicitly authorise every ownership transfer ' +
  '(ownership-origin-rules.md §"Owner change is explicit + human-approved").';

const REFUSAL_NOTHING =
  'Apply requested but no migration moves were proposed. Nothing written.';

// ---------------------------------------------------------------------------
// Dynamic import helper (A4-T1 registry may not exist yet — fail-open)
// ---------------------------------------------------------------------------

/** Load a named export from `modPath`; returns null on any error. */
async function tryImport(modPath, name) {
  try {
    const mod = await import(modPath);
    return typeof mod[name] === 'function' ? mod[name] : null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Pipeline step implementations
// ---------------------------------------------------------------------------

/** DISCOVER — all workflow-holding directories; [] when dep absent. */
async function stepDiscover(root) {
  const fn = await tryImport(IDS_PATH, 'workflowRoots');
  try { return fn ? fn(root) : []; } catch { return []; }
}

/** AUDIT — collision descriptors across roots; [] when dep absent. */
async function stepAudit(root) {
  const fn = await tryImport(WF_PATH, 'detectWorkflowCollisions');
  try { return fn ? (fn(root) ?? []) : []; } catch { return []; }
}

/**
 * PROPOSE — build the list of `{ from, to, type, reason }` moves.
 * Only materialises caller-supplied `opts.moves` and detected collisions;
 * never auto-moves legacy NNNN dirs (compatibility-plan §"Do-not-touch list").
 */
function stepPropose(collisions, opts) {
  const moves = [];
  if (Array.isArray(opts.moves)) {
    for (const m of opts.moves) {
      if (m?.from && m?.to) {
        moves.push({
          from: resolve(String(m.from)),
          to: resolve(String(m.to)),
          type: m.type ?? 'ownership-transfer',
          reason: m.reason ?? 'explicit caller-supplied migration',
        });
      }
    }
  }
  for (const c of collisions) {
    if (c?.from && c?.to) {
      moves.push({
        from: resolve(String(c.from)),
        to: resolve(String(c.to)),
        type: 'collision-resolution',
        reason: c.reason ?? 'detected id/path collision',
      });
    }
  }
  return moves;
}

/** DRY-RUN — describe what WOULD happen; touches nothing. */
function stepDryRun(proposed) {
  return proposed.map((m) => `[dry-run] ${m.type}: ${m.from} → ${m.to} (${m.reason})`);
}

/**
 * APPLY — perform atomic moves (renameSync) only when fully authorised.
 *
 * Guard order (constitution §8):
 *  1. `opts.apply` must be true.
 *  2. `opts.humanApproved` must be true.
 *  3. There must be proposed moves.
 */
function stepApply(proposed, opts) {
  if (!opts.apply) return { refused: false, reason: null, appliedMoves: [] };
  if (opts.humanApproved !== true) return { refused: true, reason: REFUSAL_NO_APPROVAL, appliedMoves: [] };
  if (proposed.length === 0) return { refused: true, reason: REFUSAL_NOTHING, appliedMoves: [] };
  const appliedMoves = [];
  for (const m of proposed) {
    if (!existsSync(m.from)) continue;
    mkdirSync(dirname(m.to), { recursive: true });
    renameSync(m.from, m.to); // atomic on same-filesystem
    appliedMoves.push(m.to);
  }
  return { refused: false, reason: null, appliedMoves };
}

/** VERIFY — confirm applied targets exist on disk. */
function stepVerify(proposed, appliedMoves) {
  if (!appliedMoves.length) return [];
  return proposed
    .filter((m) => appliedMoves.includes(m.to))
    .map((m) => ({ path: m.to, exists: existsSync(m.to) }));
}

/** RECEIPT — deterministic audit object for the entire run. */
function buildReceipt(root, proposed, applied, appliedMoves, refused) {
  const checksum = createHash('sha256')
    .update(JSON.stringify({ root, proposed, applied, appliedMoves, refused }))
    .digest('hex')
    .slice(0, 16);
  return {
    timestamp: new Date().toISOString(),
    root,
    applied,
    proposedCount: proposed.length,
    appliedCount: appliedMoves.length,
    refused,
    checksum,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Plans (and optionally executes) a workflow migration on `root`.
 *
 * @param {string} root - absolute project root path.
 * @param {object} [opts]
 * @param {boolean} [opts.apply=false] - write moves to disk.
 * @param {boolean} [opts.humanApproved=false] - must be true for ownership transfer.
 * @param {{ from: string, to: string, type?: string, reason?: string }[]} [opts.moves]
 * @returns {Promise<{
 *   steps: string[], stepsCompleted: string[], proposed: object[],
 *   dryRunLines: string[], applied: boolean, refused: string|null,
 *   verification: object[], receipt: object
 * }>}
 */
export async function planMigration(root, opts = {}) {
  const resolvedRoot = resolve(String(root));
  const stepsCompleted = [];

  const discoveredRoots = await stepDiscover(resolvedRoot);
  stepsCompleted.push('discover');

  const collisions = await stepAudit(resolvedRoot);
  stepsCompleted.push('audit');

  const proposed = stepPropose(collisions, opts);
  stepsCompleted.push('propose');

  const dryRunLines = stepDryRun(proposed);
  stepsCompleted.push('dry-run');

  const { refused, reason, appliedMoves } = stepApply(proposed, opts);
  const applied = appliedMoves.length > 0;
  stepsCompleted.push('apply');

  const verification = stepVerify(proposed, appliedMoves);
  stepsCompleted.push('verify');

  const receipt = buildReceipt(resolvedRoot, proposed, applied, appliedMoves, reason ?? null);
  stepsCompleted.push('receipt');

  return {
    steps: PIPELINE_STEPS,
    stepsCompleted,
    proposed,
    dryRunLines,
    applied,
    refused: reason ?? null,
    verification,
    receipt,
    // Legacy-compatible alias used by some tests
    discoveredRoots,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point — node migration-plan.mjs [--apply] [--human-approved] ...
// ---------------------------------------------------------------------------

function parseCliFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === '--apply') flags.apply = true;
    else if (t === '--human-approved') flags.humanApproved = true;
    else if (t === '--json') flags.json = true;
    else if (t === '--root' && argv[i + 1]) { flags.root = argv[i + 1]; i += 1; }
    else if (t.startsWith('--root=')) flags.root = t.slice(7);
  }
  return flags;
}

async function main() {
  const flags = parseCliFlags(process.argv.slice(2));
  const result = await planMigration(flags.root ?? process.cwd(), {
    apply: flags.apply ?? false,
    humanApproved: flags.humanApproved ?? false,
  });
  if (flags.json) { process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return; }
  console.log(`migration-plan: ${result.stepsCompleted.join(' → ')}`);
  for (const line of result.dryRunLines) console.log(line);
  if (!result.dryRunLines.length) console.log('[dry-run] no moves proposed.');
  if (result.refused) console.error(`REFUSED: ${result.refused}`);
  else if (result.applied) console.log(`applied ${result.receipt.appliedCount} move(s).`);
  else console.log('dry-run complete — pass --apply to execute.');
  console.log(`receipt checksum: ${result.receipt.checksum}`);
}

const isMain = process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) main().catch((err) => { console.error(err); process.exit(1); });
