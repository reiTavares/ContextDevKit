/**
 * Pre-update critical-state snapshot for the ContextDevKit updater safety layer (P0-03).
 *
 * Before any file mutation, the orchestrator calls `snapshotCriticalState()` to
 * create a versioned, hash-verified backup under the user's home directory.
 * If the snapshot cannot be completed or its integrity check fails, the orchestrator
 * must abort the update (FAILED_SNAPSHOT) so the user always retains a recovery path.
 *
 * Key design decisions:
 *   - NEVER writes anything inside `target`. All output goes to `~/.contextdevkit/`.
 *   - Per-file sha256 written alongside the copy, then re-read + re-hashed to verify.
 *   - opts.root overrides the home-dir base for test isolation.
 *   - newUpdateId() uses process.hrtime.bigint() + process.pid + randomBytes(4) so ids
 *     are unique, monotone, and carry no wall-clock privacy risk.
 *
 * Zero runtime dependencies. node:* only.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { projectId } from './update-preflight.mjs';

// ---------------------------------------------------------------------------
// Critical surfaces to snapshot (relative to target root)
// ---------------------------------------------------------------------------

/**
 * Single files to include when present.
 * @type {string[]}
 */
const SINGLE_FILES = [
  '.claude/settings.json',
  'contextkit/config.json',
  'contextkit/.install-manifest.json',
  'contextkit/.engine-version',
];

/**
 * Directories whose entire tree is recursively snapshotted when present.
 * @type {string[]}
 */
const RECURSIVE_DIRS = [
  '.claude/.sessions',
  '.claude/.workspace',
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Computes the sha256 hex digest of a Buffer.
 * @param {Buffer} buf
 * @returns {string}
 */
function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Recursively yields every file path under `dir` as an array of absolute paths.
 * @param {string} dir
 * @returns {string[]}
 */
function walkFilesSync(dir) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFilesSync(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

/**
 * Copies a single file from `srcPath` to `destPath`, computing the sha256 of
 * the source bytes before the copy and re-reading the destination to verify.
 *
 * @param {string} srcPath
 * @param {string} destPath
 * @returns {Promise<{ srcHash: string, destHash: string, verified: boolean }>}
 */
async function copyAndVerify(srcPath, destPath) {
  const srcBuf = await readFile(srcPath);
  const srcHash = sha256(srcBuf);

  await mkdir(dirname(destPath), { recursive: true });
  await copyFile(srcPath, destPath);

  const destBuf = await readFile(destPath);
  const destHash = sha256(destBuf);

  return { srcHash, destHash, verified: srcHash === destHash };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Generates a collision-resistant update identifier.
 *
 * Format: `<hrtime-hex>-<pid-hex>-<random-4-bytes-hex>`
 *
 * Uses process.hrtime.bigint() for monotone nanosecond precision,
 * process.pid for process disambiguation, and 4 random bytes for entropy.
 * No wall-clock timestamp so privacy concerns about system time are avoided.
 *
 * @returns {string}
 */
export function newUpdateId() {
  const hrt = process.hrtime.bigint().toString(16).padStart(16, '0');
  const pid = process.pid.toString(16).padStart(6, '0');
  const rnd = randomBytes(4).toString('hex');
  return `${hrt}-${pid}-${rnd}`;
}

/**
 * Snapshots the critical project state to an out-of-tree backup directory.
 *
 * Destination root: `<opts.root or homedir()>/.contextdevkit/projects/<projectId>/backups/<updateId>/`
 *
 * Included surfaces (when present):
 *   - `.claude/settings.json`
 *   - `.claude/.sessions/**`
 *   - `.claude/.workspace/**`
 *   - `contextkit/config.json`
 *   - `contextkit/.install-manifest.json`
 *   - `contextkit/.engine-version`
 *
 * After copying each file the destination is re-read and its sha256 is compared
 * to the source. Any mismatch sets `ok: false` so the orchestrator can abort.
 *
 * NEVER writes inside `target`. When homedir() is unavailable and no opts.root
 * is provided, returns `{ ok: false, ... }` with an entry in skipped[].
 *
 * @param {string} target project root
 * @param {string} updateId unique identifier for this update run (use newUpdateId())
 * @param {{ root?: string }} [opts] optional overrides (root replaces ~/.contextdevkit base)
 * @returns {Promise<{
 *   ok: boolean,
 *   dir: string,
 *   files: Array<{ rel: string, sha256: string }>,
 *   skipped: Array<{ rel: string, reason: string }>,
 * }>}
 */
export async function snapshotCriticalState(target, updateId, opts = {}) {
  // Resolve snapshot destination root (never inside target).
  let backupBase;
  try {
    const homeBase = opts.root ?? homedir();
    if (!homeBase) throw new Error('homedir() returned empty string');
    backupBase = join(homeBase, '.contextdevkit', 'projects', projectId(target), 'backups', updateId);
  } catch (err) {
    return {
      ok: false,
      dir: '',
      files: [],
      skipped: [{ rel: '<root>', reason: `cannot resolve backup destination: ${err.message}` }],
    };
  }

  const files = [];
  const skipped = [];
  let overallOk = true;

  /**
   * Copies one file from `srcPath` into `<backupBase>/<relPath>` and records
   * the hash. Sets overallOk = false on any hash mismatch.
   * @param {string} srcPath
   * @param {string} relPath forward-slash relative path for the manifest
   */
  async function snapshotOne(srcPath, relPath) {
    const destPath = join(backupBase, ...relPath.split('/'));
    try {
      const { srcHash, verified } = await copyAndVerify(srcPath, destPath);
      files.push({ rel: relPath, sha256: srcHash });
      if (!verified) {
        skipped.push({ rel: relPath, reason: 'hash mismatch after copy — integrity check failed' });
        overallOk = false;
      }
    } catch (err) {
      skipped.push({ rel: relPath, reason: `copy failed: ${err.message}` });
      overallOk = false;
    }
  }

  // Snapshot single files.
  for (const rel of SINGLE_FILES) {
    const srcPath = join(target, ...rel.split('/'));
    if (existsSync(srcPath)) {
      await snapshotOne(srcPath, rel);
    }
  }

  // Snapshot recursive directories.
  for (const dirRel of RECURSIVE_DIRS) {
    const srcDir = join(target, ...dirRel.split('/'));
    for (const absFile of walkFilesSync(srcDir)) {
      const relPath = relative(target, absFile).replace(/\\/g, '/');
      await snapshotOne(absFile, relPath);
    }
  }

  return { ok: overallOk, dir: backupBase, files, skipped };
}
