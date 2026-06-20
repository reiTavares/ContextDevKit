/**
 * ADR Migration Core — pure pipeline step implementations (BIZ-0001 / WF-0037, B4-T1).
 *
 * Contains every pipeline step as a pure / near-pure function so that
 * `adr-migrate.mjs` (the orchestrator + CLI) stays under the 280-line budget.
 * Separated by the single-responsibility seam: "step logic" vs "orchestration".
 *
 * Reuses `normalizeCollisions` from `migration-plan.mjs` (A4 shape contract).
 *
 * Zero runtime dependencies — `node:*` only.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { normalizeCollisions } from './migration-plan.mjs';
import { indexLegacyAdrsDirs } from './adr-index.mjs';

export { normalizeCollisions };

/** All pipeline step names in canonical execution order. */
export const ADR_PIPELINE_STEPS = [
  'discover',
  'audit',
  'propose',
  'dry-run',
  'ref-impact',
  'collision',
  'apply',
  'verify',
  'receipt',
];

const REFUSAL_NO_APPROVAL =
  'ADR migration refused: opts.humanApproved must be true. ' +
  'A human actor must explicitly authorise every file move (constitution §8).';

const REFUSAL_NOTHING = 'Apply requested but no migration moves were proposed. Nothing written.';

// ---------------------------------------------------------------------------
// Dynamic import helper — fail-open when optional dep absent
// ---------------------------------------------------------------------------

/** Load named export from modPath; returns null on any error. */
export async function tryImport(modPath, name) {
  try {
    const mod = await import(modPath);
    return typeof mod[name] === 'function' ? mod[name] : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pipeline steps (pure / near-pure)
// ---------------------------------------------------------------------------

/**
 * DISCOVER — index legacy ADRs across known decisions dirs under `root`.
 *
 * @param {string} root - project root.
 * @returns {Promise<import('./adr-index.mjs').LegacyAdrEntry[]>}
 */
export async function stepDiscover(root) {
  try {
    const decisionsRoot = resolve(root, 'contextkit', 'memory', 'decisions');
    const legacyDir = resolve(decisionsRoot, 'legacy');
    const dirs = [decisionsRoot, legacyDir].filter(existsSync);
    return indexLegacyAdrsDirs(dirs, { recursive: false });
  } catch {
    return [];
  }
}

/**
 * AUDIT — detect id/path collisions between legacy entries and new-format rows.
 *
 * @param {import('./adr-index.mjs').LegacyAdrEntry[]} legacyEntries
 * @param {object[]} newRows - registry rows with format === 'new'.
 * @returns {object[]} normalised collision descriptors.
 */
export function stepAudit(legacyEntries, newRows) {
  // Defensive: a caller (or a pipeline stage) may pass null/undefined; never throw.
  const legacy = Array.isArray(legacyEntries) ? legacyEntries : [];
  const rows = Array.isArray(newRows) ? newRows : [];
  const legacyIds = new Set(legacy.map((e) => e.id));
  const newIds = new Set(rows.map((r) => r.id));
  const duplicateIds = [...legacyIds].filter((id) => newIds.has(id));
  const legacyPaths = new Set(legacy.map((e) => e.absolutePath));
  const newPaths = new Set(rows.map((r) => r.path || '').filter(Boolean));
  const duplicatePaths = [...legacyPaths].filter((p) => newPaths.has(p));
  return normalizeCollisions({ duplicateIds, duplicatePaths });
}

/**
 * PROPOSE — build `{ from, to, type, reason }` moves from caller-supplied opts.
 * Never auto-moves; only materialises explicitly provided moves (constitution §8).
 *
 * @param {object[]} collisions
 * @param {object}   opts
 * @returns {{from:string, to:string, type:string, reason:string}[]}
 */
export function stepPropose(collisions, opts) {
  const moves = [];
  if (Array.isArray(opts.moves)) {
    for (const m of opts.moves) {
      if (m?.from && m?.to) {
        moves.push({
          from: resolve(String(m.from)),
          to: resolve(String(m.to)),
          type: m.type ?? 'adr-migration',
          reason: m.reason ?? 'explicit caller-supplied ADR migration',
        });
      }
    }
  }
  for (const c of collisions) {
    if (c?.from && c?.to) {
      moves.push({
        from: resolve(String(c.from)),
        to: resolve(String(c.to)),
        type: 'adr-collision-resolution',
        reason: c.reason ?? 'detected id/path collision',
      });
    }
  }
  return moves;
}

/** DRY-RUN — describe what WOULD happen; touches NOTHING on disk. */
export function stepDryRun(proposed) {
  return proposed.map((m) => `[dry-run] ${m.type}: ${m.from} → ${m.to} (${m.reason})`);
}

/**
 * REF-IMPACT — for each proposed move, count files in `root` referencing the
 * source filename. Reads defensively; never writes.
 *
 * @param {string}               root     - project root.
 * @param {{from:string}[]}      proposed - proposed moves.
 * @returns {object[]} `{ from, referenceCount, sampleRefs }` per move.
 */
export function stepRefImpact(root, proposed) {
  if (!proposed.length) return [];

  function collectFiles(dir, exts, depth) {
    if (!existsSync(dir) || depth > 3) return [];
    const collected = [];
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && exts.some((ext) => entry.name.endsWith(ext))) {
          collected.push(resolve(dir, entry.name));
        } else if (entry.isDirectory() && depth < 3 && !entry.name.startsWith('.')) {
          collected.push(...collectFiles(resolve(dir, entry.name), exts, depth + 1));
        }
      }
    } catch { /* fail-open */ }
    return collected;
  }

  const allFiles = collectFiles(root, ['.md', '.mjs', '.json'], 0);
  return proposed.map((m) => {
    const needle = basename(m.from);
    const sampleRefs = [];
    let count = 0;
    for (const f of allFiles) {
      try {
        if (readFileSync(f, 'utf-8').includes(needle)) {
          count += 1;
          if (sampleRefs.length < 3) sampleRefs.push(f);
        }
      } catch { /* skip unreadable */ }
    }
    return { from: m.from, referenceCount: count, sampleRefs };
  });
}

/**
 * APPLY — atomic renames when fully authorised (constitution §8 guard order).
 *
 * @param {{from:string,to:string}[]} proposed
 * @param {object} opts
 * @returns {{ refused: boolean, reason: string|null, appliedMoves: string[] }}
 */
export function stepApply(proposed, opts) {
  if (!opts.apply) return { refused: false, reason: null, appliedMoves: [] };
  if (opts.humanApproved !== true) return { refused: true, reason: REFUSAL_NO_APPROVAL, appliedMoves: [] };
  if (proposed.length === 0) return { refused: true, reason: REFUSAL_NOTHING, appliedMoves: [] };
  const appliedMoves = [];
  for (const m of proposed) {
    if (!existsSync(m.from)) continue;
    if (m.from === m.to) continue; // no-op self-move (defensive; avoids a platform rename error)
    mkdirSync(dirname(m.to), { recursive: true });
    renameSync(m.from, m.to);
    appliedMoves.push(m.to);
  }
  return { refused: false, reason: null, appliedMoves };
}

/** VERIFY — confirm applied targets exist on disk. */
export function stepVerify(proposed, appliedMoves) {
  if (!appliedMoves.length) return [];
  return proposed
    .filter((m) => appliedMoves.includes(m.to))
    .map((m) => ({ path: m.to, exists: existsSync(m.to) }));
}

/**
 * RECEIPT — deterministic audit object; `now` is injected for test determinism.
 *
 * @param {string}      root
 * @param {object[]}    proposed
 * @param {boolean}     applied
 * @param {string[]}    appliedMoves
 * @param {string|null} refused
 * @param {string}      now - ISO timestamp.
 * @returns {object}
 */
export function buildReceipt(root, proposed, applied, appliedMoves, refused, now) {
  const checksum = createHash('sha256')
    .update(JSON.stringify({ root, proposed, appliedMoves, refused }))
    .digest('hex')
    .slice(0, 16);
  return {
    timestamp: now,
    root,
    applied,
    proposedCount: proposed.length,
    appliedCount: appliedMoves.length,
    refused,
    checksum,
  };
}
