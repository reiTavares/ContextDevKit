/**
 * Shared helpers for the per-session ledger (L2).
 *
 * Each Claude Code session writes its OWN ledger at:
 *   `.claude/.sessions/<sessionId>.json`
 *
 * Why per-session and not a single file?
 *   - Multiple parallel chats on the same machine would otherwise stomp on
 *     each other's state. Per-session files isolate naturally.
 *   - For multi-machine parallelism, `git worktree` gives each chat its own
 *     `.claude/.sessions/` directory anyway (it lives outside `.git`).
 *
 * Ledger schema:
 *   {
 *     sessionId: string,
 *     startedAt: number,
 *     modifications: Array<{ path, tool, at }>,
 *     registered: boolean,
 *     stopWarnedAt: number | null,
 *     simulations: Array<{ objective, coveredPaths, predictionFile, at }>
 *   }
 *
 * All functions are defensive: never throw; on error return safe defaults so
 * a hook never breaks a Claude session. Zero third-party deps.
 */
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { isImportant, isRegistrationFile, isTrackable } from './path-classification.mjs';
import { LEDGER_DIR } from '../config/paths.mjs';

export { isImportant, isRegistrationFile, isTrackable };

export const ROOT = process.cwd();
export const SESSIONS_DIR = resolve(ROOT, LEDGER_DIR);

/**
 * "Last touched" pointer — updated by every track-edits run. Lets slash
 * commands (`/log-session`) discover the current session without a hook
 * payload.
 */
export const LAST_TOUCHED_PATH = resolve(SESSIONS_DIR, '.last-touched');

export function ledgerPathFor(sessionId) {
  return resolve(SESSIONS_DIR, `${sanitizeSid(sessionId)}.json`);
}

/** Reads a ledger by sessionId. Returns a fresh ledger if missing/corrupt. */
export async function readLedger(sessionId) {
  try {
    const raw = await readFile(ledgerPathFor(sessionId), 'utf-8');
    return normalizeLedger(JSON.parse(raw), sessionId);
  } catch {
    return freshLedger(sessionId);
  }
}

/** Persists a ledger and updates the last-touched pointer. */
export async function writeLedger(sessionId, ledger) {
  try {
    await mkdir(SESSIONS_DIR, { recursive: true });
    await writeFile(ledgerPathFor(sessionId), JSON.stringify(ledger, null, 2), 'utf-8');
    await writeFile(LAST_TOUCHED_PATH, JSON.stringify({ sessionId, at: Date.now() }), 'utf-8');
  } catch (err) {
    process.stderr.write(`[ledger] write failed: ${err?.message ?? err}\n`);
  }
}

/**
 * Most recently touched ledger across all session files. Used by slash
 * commands that don't receive a hook payload.
 *
 * @returns {Promise<{ sessionId: string, ledger: any } | null>}
 */
export async function readMostRecentLedger() {
  try {
    const raw = await readFile(LAST_TOUCHED_PATH, 'utf-8');
    const ptr = JSON.parse(raw);
    if (typeof ptr?.sessionId !== 'string') return null;
    return { sessionId: ptr.sessionId, ledger: await readLedger(ptr.sessionId) };
  } catch {
    try {
      const files = await readdir(SESSIONS_DIR);
      let best = null;
      for (const f of files) {
        if (!f.endsWith('.json') || f.startsWith('.')) continue;
        const st = await stat(resolve(SESSIONS_DIR, f));
        if (!best || st.mtimeMs > best.mtime) {
          best = { sessionId: f.slice(0, -5), mtime: st.mtimeMs };
        }
      }
      if (!best) return null;
      return { sessionId: best.sessionId, ledger: await readLedger(best.sessionId) };
    } catch {
      return null;
    }
  }
}

/** Lists all ledgers in this worktree. Used by SessionStart drift detection. */
export async function listAllLedgers() {
  let files = [];
  try {
    files = await readdir(SESSIONS_DIR);
  } catch {
    return [];
  }
  const all = [];
  for (const f of files) {
    if (!f.endsWith('.json') || f.startsWith('.')) continue;
    const sid = f.slice(0, -5);
    all.push({ sessionId: sid, ledger: await readLedger(sid) });
  }
  return all;
}

export function freshLedger(sessionId) {
  return {
    sessionId,
    startedAt: Date.now(),
    modifications: [],
    registered: false,
    stopWarnedAt: null,
    simulations: [],
  };
}

function sanitizeSid(sid) {
  return String(sid).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function normalizeLedger(obj, sessionId) {
  const base = freshLedger(sessionId);
  if (!obj || typeof obj !== 'object') return base;
  return {
    sessionId: typeof obj.sessionId === 'string' ? obj.sessionId : sessionId,
    startedAt: typeof obj.startedAt === 'number' ? obj.startedAt : base.startedAt,
    modifications: Array.isArray(obj.modifications) ? obj.modifications : [],
    registered: obj.registered === true,
    stopWarnedAt: typeof obj.stopWarnedAt === 'number' ? obj.stopWarnedAt : null,
    simulations: Array.isArray(obj.simulations) ? obj.simulations : [],
  };
}

export function toRepoRelative(absOrRel) {
  if (!absOrRel) return '';
  try {
    return relative(ROOT, resolve(ROOT, absOrRel)).replaceAll('\\', '/');
  } catch {
    return String(absOrRel);
  }
}

export function pendingImportantPaths(ledger) {
  const seen = new Set();
  for (const mod of ledger.modifications) {
    if (isRegistrationFile(mod.path)) continue;
    if (!isImportant(mod.path)) continue;
    seen.add(mod.path);
  }
  return [...seen];
}

export function wasRegisteredDuringSession(ledger) {
  return ledger.modifications.some((m) => isRegistrationFile(m.path));
}

/**
 * Appends a simulate-impact record (L5). `coveredPaths` MUST already be
 * repo-relative + forward-slashed. Mutates the ledger in place and returns it.
 *
 * @param {ReturnType<typeof freshLedger>} ledger
 * @param {{ objective: string, coveredPaths: string[], predictionFile?: string }} entry
 */
export function markSimulation(ledger, entry) {
  if (!ledger || typeof ledger !== 'object') return ledger;
  if (!entry || typeof entry.objective !== 'string') return ledger;
  if (!Array.isArray(ledger.simulations)) ledger.simulations = [];
  const covered = Array.isArray(entry.coveredPaths)
    ? entry.coveredPaths.filter((p) => typeof p === 'string' && p.length > 0)
    : [];
  ledger.simulations.push({
    objective: entry.objective,
    coveredPaths: covered,
    predictionFile: typeof entry.predictionFile === 'string' ? entry.predictionFile : null,
    at: Date.now(),
  });
  return ledger;
}

/**
 * True when at least one simulation entry covers `targetPath` (exact match or
 * a directory-prefix claim ending in `/`).
 *
 * @param {ReturnType<typeof freshLedger>} ledger
 * @param {string} targetPath — repo-relative, forward-slashed
 */
export function hasSimulationFor(ledger, targetPath) {
  if (!ledger || !Array.isArray(ledger.simulations)) return false;
  if (typeof targetPath !== 'string' || targetPath.length === 0) return false;
  const normalized = toRepoRelative(targetPath);
  for (const sim of ledger.simulations) {
    if (!sim || !Array.isArray(sim.coveredPaths)) continue;
    for (const covered of sim.coveredPaths) {
      if (typeof covered !== 'string' || covered.length === 0) continue;
      if (covered === normalized) return true;
      if (covered.endsWith('/') && normalized.startsWith(covered)) return true;
    }
  }
  return false;
}

/**
 * Reads the sessionId from a hook stdin payload, falling back to env then a
 * synthetic per-process id so the script never crashes.
 *
 * @param {any} payload
 */
export function resolveSessionId(payload) {
  if (payload?.session_id && typeof payload.session_id === 'string') return payload.session_id;
  if (process.env.CLAUDE_SESSION_ID) return process.env.CLAUDE_SESSION_ID;
  return `local_${process.pid}_${Date.now()}`;
}

export { dirname };
