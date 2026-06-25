/**
 * active-context-resolver.mjs — Resolves the active governed context for a
 * request (WF0038, ADR-0112, Wave A7-T1, shadow-first).
 *
 * Pure + deterministic: no Date.now/Math.random on any active code path.
 * Precedence helpers live in `active-context-precedence.mjs` (same dir).
 *
 * @module active-context-resolver
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── Platform primitives ────────────────────────────────────────────────────
import { buildWorkContextRegistry } from '../../tools/scripts/registry/work-context.mjs';
import { loadConfigSync } from '../config/load.mjs';
import { pathsFor } from '../config/paths.mjs';
import { readJsonSafe } from '../hooks/safe-io.mjs';

// ─── Precedence helpers (pure, no I/O) ─────────────────────────────────────
import {
  buildResult,
  ruleExplicitIds,
  ruleEngineState,
  ruleBranchName,
  ruleClaims,
  rulePaths,
  rulePriorSession,
} from './active-context-precedence.mjs';

// ─── Public types (JSDoc-only) ───────────────────────────────────────────────

/**
 * @typedef {object} ResolverInput
 * @property {object}   [request]     - Raw request object (signals, context).
 * @property {string[]} [explicitIds] - Caller-supplied BIZ-####/OP-####/WF-#### ids.
 * @property {string}   [branch]      - Current git branch / worktree name.
 * @property {string}   [cwd]         - Working directory (defaults to process.cwd()).
 */

/**
 * @typedef {'confirmed'|'suggested'|'ambiguous'|'unlinked'} ContextState
 */

/**
 * @typedef {object} ActiveContext
 * @property {ContextState}  state          - Confidence of the resolved context.
 * @property {string|null}   rootBusinessId - Canonical root business id from config.
 * @property {string|null}   business       - Resolved BIZ-#### id, or null.
 * @property {string|null}   operation      - Resolved OP-#### id, or null.
 * @property {string|null}   workflow       - Resolved WF-#### id, or null.
 * @property {string|null}   wave           - Wave tag (e.g. "A7"), or null.
 * @property {string|null}   task           - Task tag (e.g. "T1"), or null.
 * @property {string}        source         - Which precedence rule fired.
 * @property {string[]}      reasonCodes    - Ordered explanation of the verdict.
 */

// ─── I/O readers (defensive, never throw) ───────────────────────────────────

/**
 * Reads `business.rootBusinessId` from project config.
 * @param {string} root
 * @returns {string|null}
 */
function readRootBusinessId(root) {
  try {
    const cfg = loadConfigSync(root);
    const id  = cfg?.business?.rootBusinessId;
    return typeof id === 'string' && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Reads all workspace claim files under `.claude/.workspace/`.
 * @param {string} root
 * @returns {object[]}
 */
function readWorkspaceClaims(root) {
  const wsDir = pathsFor(root).workspaceStateDir;
  if (!existsSync(wsDir)) return [];
  try {
    return readdirSync(wsDir)
      .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
      .map((f) => readJsonSafe(join(wsDir, f), null))
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Reads BIZ-/OP-/WF-#### ids from the most recent session markdown.
 * @param {string} root
 * @returns {{ business:string|null, operation:string|null, workflow:string|null }}
 */
function readPriorSessionIds(root) {
  const sessionsDir = pathsFor(root).sessions;
  const empty = { business: null, operation: null, workflow: null };
  if (!existsSync(sessionsDir)) return empty;
  try {
    const files = readdirSync(sessionsDir)
      .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
      .sort().reverse();
    if (!files.length) return empty;
    const text = readFileSync(join(sessionsDir, files[0]), 'utf-8');
    return {
      business:  (text.match(/\b(BIZ-\d{4})\b/) ?? [])[1] ?? null,
      operation: (text.match(/\b(OP-\d{4})\b/)  ?? [])[1] ?? null,
      workflow:  (text.match(/\b(WF-\d{4})\b/)  ?? [])[1] ?? null,
    };
  } catch {
    return empty;
  }
}

/**
 * Scans the business folder tree for an active workflow-state.json.
 *
 * Canonical path: `contextkit/memory/business/<BIZ-####-slug>/workflows/<WF-####-slug>/workflow-state.json`
 *
 * @param {string}      root
 * @param {string|null} bizId
 * @returns {{ workflow:string|null, wave:string|null, task:string|null }}
 */
function readEngineWorkflowState(root, bizId) {
  const empty = { workflow: null, wave: null, task: null };
  if (!bizId) return empty;
  const bizDir = pathsFor(root).business;
  if (!existsSync(bizDir)) return empty;
  try {
    const bizFolders = readdirSync(bizDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith(bizId))
      .map((e) => e.name);
    for (const folder of bizFolders) {
      const wfDir = join(bizDir, folder, 'workflows');
      if (!existsSync(wfDir)) continue;
      const wfFolders = readdirSync(wfDir, { withFileTypes: true })
        .filter((e) => e.isDirectory()).map((e) => e.name);
      for (const wf of wfFolders) {
        const state = readJsonSafe(join(wfDir, wf, 'workflow-state.json'), null);
        if (state?.overallStatus === 'active' || state?.overallStatus === 'in-progress') {
          return {
            workflow: (wf.match(/^(WF-\d{4})/) ?? [])[1] ?? null,
            wave: state?.currentWave ?? null,
            task: state?.currentTask ?? null,
          };
        }
      }
    }
  } catch { /* fall through */ }
  return empty;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Resolves the active governed context for a request.
 *
 * Precedence (first confident hit wins):
 *   1. explicitIds   — caller-supplied BIZ-/OP-/WF-#### ids
 *   2. engine-state  — workflow-state.json under the business tree
 *   3. branch-name   — BIZ-/OP-/WF-#### tokens in the branch name
 *   4. claims        — active workspace claim files
 *   5. paths         — cwd or request paths contain a context folder segment
 *   6. prior-session — most recent session markdown contains context ids
 *
 * Returns a FROZEN object. Deterministic: same input → identical output.
 *
 * @param {ResolverInput} input
 * @param {object}        [opts]
 * @param {string}        [opts.root]         - project root (overrides `input.cwd`).
 * @param {boolean}       [opts.strictContext] - throws when state is 'unlinked'.
 * @returns {ActiveContext}
 * @throws {Error} when `opts.strictContext` is true and state is 'unlinked'.
 */
export function resolveActiveContext(input, opts = {}) {
  const safeInput = (input && typeof input === 'object') ? input : {};
  const safeOpts  = (opts  && typeof opts  === 'object') ? opts  : {};
  const effectiveRoot = safeOpts.root
    ?? safeInput.cwd
    ?? (typeof process !== 'undefined' ? process.cwd() : '');

  const rootBusinessId = readRootBusinessId(effectiveRoot);
  const reasonCodes    = [];

  let registry;
  try {
    registry = buildWorkContextRegistry(effectiveRoot);
  } catch {
    registry = { schemaVersion: 1, generator: 'fallback', contexts: [] };
    reasonCodes.push('registry=unavailable (buildWorkContextRegistry failed; continuing)');
  }

  const requestPaths = safeInput.request?.signals?.paths;
  const claims       = readWorkspaceClaims(effectiveRoot);
  const priorIds     = readPriorSessionIds(effectiveRoot);

  const rules = [
    () => ruleExplicitIds(safeInput.explicitIds, registry),
    () => ruleEngineState(rootBusinessId, registry, readEngineWorkflowState, effectiveRoot),
    () => ruleBranchName(safeInput.branch, registry, effectiveRoot),
    () => ruleClaims(claims, registry),
    () => rulePaths(effectiveRoot, requestPaths, registry),
    () => rulePriorSession(priorIds, registry),
  ];

  for (const rule of rules) {
    let hit;
    try { hit = rule(); } catch { continue; }
    if (!hit) continue;
    reasonCodes.push(hit.reason ?? `source=${hit.source}`);
    if (hit.state === 'ambiguous') {
      return buildResult('ambiguous', rootBusinessId, null, null, null, null, null, hit.source, reasonCodes);
    }
    return buildResult(
      hit.state, rootBusinessId,
      hit.business ?? null, hit.operation ?? null, hit.workflow ?? null,
      hit.wave ?? null, hit.task ?? null,
      hit.source, reasonCodes,
    );
  }

  reasonCodes.push('unlinked: no rule produced a hit');
  if (safeOpts.strictContext) {
    throw new Error(`[active-context-resolver] unlinked: no context could be resolved for root='${effectiveRoot}'`);
  }
  return buildResult('unlinked', rootBusinessId, null, null, null, null, null, 'none', reasonCodes);
}
