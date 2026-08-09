/**
 * Update preflight checks for the ContextDevKit updater safety layer (P0-02).
 *
 * Implements three independent checks that run before any file is written:
 *   1. projectId           — deterministic sha256 id for the canonical target path.
 *   2. detectActiveSessions — scans explicit workspace claims for in-flight work.
 *   3. detectSelfHost      — detects overlap between the running installer and target.
 *   4. runPreflight        — composes the above and returns a unified decision object.
 *
 * Design principles (from CLAUDE.md):
 *   - Zero runtime dependencies. node:* only.
 *   - Default to refuse / opt-in to permit. Any uncovered risk → deferred.
 *   - One consent flag never implies the other (both + only one override → still deferred).
 *   - Fail fast: I/O errors in the workspace scan treat the record as ACTIVE
 *     (conservative / false-positive-safe, never false-negative-safe).
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { platform } from 'node:process';
import {
  DEFERRED_ACTIVE_SESSIONS,
  DEFERRED_SELF_UPDATE,
} from './update-status.mjs';

/** Explicit workspace-claim directory relative to a project root. */
const WORKSPACE_DIR_REL = '.claude/.workspace';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Best-effort canonical path: tries realpathSync (resolves symlinks, normalises
 * drive-letter casing on win32 fs), falls back to resolve() when path absent.
 * @param {string} p
 * @returns {string}
 */
function safeCanonical(p) {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/**
 * Normalises a path for cross-platform string comparison:
 *   - Converts backslashes to forward slashes.
 *   - Lowercases the drive letter on win32 so "C:\foo" === "c:\foo".
 * @param {string} p already-resolved path
 * @returns {string}
 */
function normForCompare(p) {
  let s = p.replace(/\\/g, '/');
  if (platform === 'win32' && /^[A-Za-z]:\//.test(s)) {
    s = s[0].toLowerCase() + s.slice(1);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Deterministic 16-hex-char identifier for a project target path.
 *
 * The id is derived from the canonical real path so symlinks, trailing slashes,
 * and win32 drive-letter case differences all resolve to the same value.
 *
 * @param {string} target project root (absolute or relative)
 * @returns {string} 16 lowercase hex characters
 */
export function projectId(target) {
  const canonical = normForCompare(safeCanonical(target));
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Scans `<target>/.claude/.workspace/*.json` and returns entries that look ACTIVE.
 *
 * Conservative active-classification rules — any one match → ACTIVE:
 *   a) A workspace record cannot be parsed → treated as active (unknown is risky).
 *   b) `claims[]` is non-empty.
 *   c) `tasks[]` is non-empty.
 *
 * @param {string} target project root
 * @returns {Promise<Array<{ sessionId: string, reason: string }>>}
 */
export async function detectActiveSessions(target) {
  const workspaceDir = join(target, WORKSPACE_DIR_REL);
  if (!existsSync(workspaceDir)) return [];

  let filenames;
  try {
    filenames = readdirSync(workspaceDir);
  } catch {
    return [{ sessionId: 'unknown', reason: 'workspace directory unreadable — treated as active' }];
  }

  const active = [];
  for (const filename of filenames) {
    if (!filename.endsWith('.json') || filename.startsWith('.')) continue;
    const sessionId = filename.slice(0, -5);
    const filePath = join(workspaceDir, filename);

    let workspace;
    try {
      const raw = await readFile(filePath, 'utf-8');
      workspace = JSON.parse(raw.replace(/^﻿/, '')); // strip BOM (windows-safe)
    } catch {
      active.push({ sessionId, reason: 'workspace record unreadable or corrupt — treated as active' });
      continue;
    }

    if (typeof workspace !== 'object' || workspace === null) {
      active.push({ sessionId, reason: 'workspace record is not a JSON object — treated as active' });
      continue;
    }

    const claims = Array.isArray(workspace.claims) ? workspace.claims : [];
    const tasks = Array.isArray(workspace.tasks) ? workspace.tasks : [];
    if (claims.length > 0 || tasks.length > 0) {
      active.push({
        sessionId: typeof workspace.sessionId === 'string' ? workspace.sessionId : sessionId,
        reason: `${claims.length} claim(s), ${tasks.length} canonical task binding(s)`,
      });
    }
  }

  return active;
}

/**
 * Returns true when the running installer source overlaps the target project.
 *
 * Overlap conditions (any one → true):
 *   1. canonical(kitRoot) === canonical(target)
 *   2. target is a subdirectory of kitRoot (kitRoot is an ancestor of target)
 *   3. kitRoot is a subdirectory of target (target contains kitRoot)
 *   4. target contains install.mjs AND templates/contextkit (self-hosting fingerprint)
 *
 * All comparisons use normalised paths (forward slashes, lowercase drive letter).
 *
 * @param {string} target project root
 * @param {string} kitRoot running installer's directory
 * @returns {boolean}
 */
export function detectSelfHost(target, kitRoot) {
  const canonTarget = normForCompare(safeCanonical(target));
  const canonKit = normForCompare(safeCanonical(kitRoot));

  if (canonTarget === canonKit) return true;

  // Ensure trailing slash to avoid false prefix match ("/foo/bar-extra" vs "/foo/bar").
  const targetSlash = canonTarget.endsWith('/') ? canonTarget : `${canonTarget}/`;
  const kitSlash = canonKit.endsWith('/') ? canonKit : `${canonKit}/`;

  if (canonTarget.startsWith(kitSlash)) return true; // target inside kitRoot
  if (canonKit.startsWith(targetSlash)) return true;  // kitRoot inside target

  // Content-based fingerprint: target is a ContextDevKit repo itself.
  const hasInstaller = existsSync(join(target, 'install.mjs'));
  const hasTemplates = existsSync(join(target, 'templates', 'contextkit'));
  if (hasInstaller && hasTemplates) return true;

  return false;
}

/**
 * Runs all preflight checks and returns a unified decision object.
 *
 * Decision rules (applied simultaneously; both risks can coexist):
 *   - selfHost && !args.allowSelfUpdate   → status DEFERRED_SELF_UPDATE
 *   - activeSessions.length && !args.allowActiveSessions → status DEFERRED_ACTIVE_SESSIONS
 *   - BOTH risks un-overridden            → primary status is DEFERRED_SELF_UPDATE;
 *     both reasons are appended.
 *   - One override given but the other risk remains → still deferred for that risk.
 *   - All risks absent or overridden      → status null (proceed).
 *
 * `gitRisk` is best-effort with zero shelling-out; it is always null here.
 * The orchestrator may enrich this field after calling runPreflight.
 *
 * @param {string} target project root
 * @param {string} kitRoot running installer source directory
 * @param {{
 *   allowActiveSessions?: boolean,
 *   allowSelfUpdate?: boolean,
 *   update?: boolean,
 * }} args parsed CLI args
 * @returns {Promise<{
 *   status: string | null,
 *   activeSessions: Array<{ sessionId: string, reason: string }>,
 *   selfHost: boolean,
 *   gitRisk: null,
 *   reasons: string[],
 * }>}
 */
export async function runPreflight(target, kitRoot, args) {
  const [activeSessions, selfHost] = await Promise.all([
    detectActiveSessions(target),
    Promise.resolve(detectSelfHost(target, kitRoot)),
  ]);

  const reasons = [];
  let status = null;

  if (selfHost && !args.allowSelfUpdate) {
    status = DEFERRED_SELF_UPDATE;
    reasons.push(
      'The installer source overlaps the target project (self-hosting). ' +
        'Pass --allow-self-update to override.',
    );
  }

  if (activeSessions.length > 0 && !args.allowActiveSessions) {
    if (status === null) status = DEFERRED_ACTIVE_SESSIONS;
    const sessionList = activeSessions
      .map((s) => `  • ${s.sessionId}: ${s.reason}`)
      .join('\n');
    reasons.push(
      `${activeSessions.length} active session(s) detected:\n${sessionList}\n` +
        'Pass --allow-active-sessions to override.',
    );
  }

  return { status, activeSessions, selfHost, gitRisk: null, reasons };
}
