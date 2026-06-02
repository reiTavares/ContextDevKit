/**
 * Home-scoped state helper — single owner of `~/.vibedevkit/` resolution +
 * atomic write contract (ADR-0020).
 *
 * Why this exists:
 *   Cross-repo registries (fleet.json), per-machine preferences, and
 *   regenerable caches all need to live outside any single repo. Before
 *   this helper, `fleet.mjs` resolved the path and wrote the file inline;
 *   any future consumer would have reinvented (and likely gotten slightly
 *   wrong) the same logic.
 *
 * Contract (ADR-0020):
 *   - Lazy creation. The directory is created on demand.
 *   - `VIBEDEVKIT_HOME` env var overrides the directory (for tests and
 *     sandboxed environments).
 *   - All files are plain JSON, UTF-8, no BOM.
 *   - Each file declares its own `version` field. Absent = legacy /
 *     pre-versioning (adopted on next write). An *explicitly unknown*
 *     value triggers a timestamped `.bak.<ms>` copy and a fresh read.
 *   - Atomic write via tmp + rename (`renameSync` after `writeFileSync`).
 *   - Graceful refuse on every error path (rule 2 — hooks never break
 *     real work). Returns `null` instead of throwing on read failures.
 *
 * Zero deps. No HTTP, no SQLite, no daemon (ADR-0020 explicitly rules
 * those out).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const HOME_DIR_NAME = '.vibedevkit';
const CURRENT_VERSION = 1;

/**
 * Resolve and lazily create the home-scoped state directory.
 *
 * Honours `VIBEDEVKIT_HOME` first; otherwise falls back to
 * `~/.vibedevkit/`. The directory is created on first call; subsequent
 * calls are silent.
 *
 * @returns {string}  absolute directory path
 */
export function resolveHome() {
  const dir = process.env.VIBEDEVKIT_HOME || resolve(homedir(), HOME_DIR_NAME);
  if (!existsSync(dir)) {
    try { mkdirSync(dir, { recursive: true }); } catch { /* defensive */ }
  }
  return dir;
}

/**
 * Read a JSON file from `~/.vibedevkit/`. Returns `null` when the file is
 * absent, malformed, not a plain object, or written by a future version
 * the helper does not recognise (in which case the bad file is moved to
 * `<name>.bak.<timestamp>` so the next write starts clean).
 *
 * A file without a `version` field is treated as legacy and adopted —
 * the next write stamps `version: 1`. This avoids destroying existing
 * `fleet.json` data on first read by the new helper.
 *
 * @param {string} name  file name relative to the home dir (e.g. `fleet.json`)
 * @returns {object | null}
 */
export function readHomeFile(name) {
  const path = resolve(resolveHome(), name);
  if (!existsSync(path)) return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const v = parsed.version;
  if (v !== undefined && v !== CURRENT_VERSION) {
    try { renameSync(path, `${path}.bak.${Date.now()}`); } catch { /* defensive */ }
    return null;
  }
  return parsed;
}

/**
 * Atomically write a JSON file under `~/.vibedevkit/`. Stamps the current
 * `version` field if absent — callers do not need to track schema
 * versioning themselves.
 *
 * Atomicity: writes to `<name>.tmp.<pid>` then `renameSync`s into place,
 * matching the kit's installer posture.
 *
 * @param {string} name  file name relative to the home dir
 * @param {object} data  plain object to serialise
 * @throws {Error}       when `data` is not a plain object
 */
export function writeHomeFile(name, data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('writeHomeFile: data must be a plain object');
  }
  const stamped = data.version === CURRENT_VERSION ? data : { version: CURRENT_VERSION, ...data };
  const path = resolve(resolveHome(), name);
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(stamped, null, 2) + '\n', 'utf-8');
  renameSync(tmp, path);
}

/** Current schema version recognised by this helper. Exported for selfcheck. */
export const HOME_SCHEMA_VERSION = CURRENT_VERSION;
