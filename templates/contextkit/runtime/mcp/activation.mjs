/**
 * MCP Dynamic Activation — resolves which MCP servers and tools a task needs.
 *
 * Contract:
 *   - resolveActivation({taskType, workflowPhase, squad, paths}, manifest)
 *       returns { servers, allowedTools, reason, mode, warnings }
 *   - PURE and deterministic: same inputs always yield the same output.
 *   - Activation can only NARROW, never WIDEN, what policy (MCP-005) permits.
 *   - No always-on default: a server not matched by the task is not exposed.
 *   - Degrades gracefully when policy.mjs is absent (manifest-only + warning).
 *   - Zero third-party runtime dependencies (node:* only) — hot-path safe.
 *
 * The rules + matching live in ./activation-rules.mjs; the MCP-005 ceiling lives
 * in ./activation-policy.mjs. This file is the public orchestration surface.
 *
 * @module activation
 */

import {
  ACTIVATION_TABLE,
  normaliseTaskType,
  findMatchingRule,
  intersectWithManifest,
} from './activation-rules.mjs';
import { tryLoadPolicy, applyPolicyCeiling } from './activation-policy.mjs';

/**
 * @typedef {Object} ActivationContext
 * @property {string}   taskType
 * @property {string}   [workflowPhase]
 * @property {string}   [squad]
 * @property {string[]} [paths]
 */

/**
 * @typedef {Object} ManifestEntry
 * @property {string}   id
 * @property {string}   [mode]
 * @property {string[]} [allowedTools]
 * @property {boolean}  [disabled]
 */

/**
 * @typedef {Object} ActivationResult
 * @property {ManifestEntry[]}          servers
 * @property {Record<string, string[]>} allowedTools
 * @property {string}                   reason
 * @property {'full'|'degraded'|'empty'} mode
 * @property {string[]}                 [warnings]
 */

/**
 * Normalises the context's squad/paths into the shape the matcher expects.
 * @param {ActivationContext} ctx
 * @returns {{ normalisedTask: string, squad: string|undefined, paths: string[] }}
 */
function normaliseContext(ctx) {
  return {
    normalisedTask: normaliseTaskType(ctx.taskType),
    squad: typeof ctx.squad === 'string' ? ctx.squad.toLowerCase().trim() : undefined,
    paths: Array.isArray(ctx.paths) ? ctx.paths : [],
  };
}

/**
 * Validates resolveActivation inputs at the boundary (throw, not warn).
 * @param {ActivationContext} ctx
 * @param {ManifestEntry[]} manifest
 * @param {string} label
 * @throws {TypeError}
 */
function assertInputs(ctx, manifest, label) {
  if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) {
    throw new TypeError(label + ': ctx must be a plain object');
  }
  if (typeof ctx.taskType !== 'string' || ctx.taskType.trim().length === 0) {
    throw new TypeError(label + ': ctx.taskType must be a non-empty string');
  }
  if (!Array.isArray(manifest)) {
    throw new TypeError(label + ': manifest must be an array (readManifest().servers)');
  }
}

/** Builds the empty/no-match result. @returns {ActivationResult} */
function emptyResult(reason, warnings = []) {
  return { servers: [], allowedTools: {}, reason, mode: 'empty', warnings };
}

/**
 * Projects permitted candidates into the { servers, allowedTools } output shape.
 * @param {{ entry: object, mode: string, allowedTools: string[] }[]} candidates
 * @returns {{ servers: object[], allowedTools: Record<string, string[]> }}
 */
function projectResult(candidates) {
  return {
    servers: candidates.map((c) => ({ ...c.entry, mode: c.mode })),
    allowedTools: Object.fromEntries(candidates.map((c) => [c.entry.id, c.allowedTools])),
  };
}

/**
 * Resolves which MCP servers and tools are appropriate for the given task.
 * 1. table match (first-win) → 2. manifest intersect (narrow) →
 * 3. policy ceiling per server (MCP-005) → 4. drop disabled → 5. no match = empty.
 *
 * @param {ActivationContext} ctx
 * @param {ManifestEntry[]} manifest
 * @returns {Promise<ActivationResult>}
 * @throws {TypeError} If inputs are structurally invalid.
 */
export async function resolveActivation(ctx, manifest) {
  assertInputs(ctx, manifest, 'resolveActivation');
  const { normalisedTask, squad, paths } = normaliseContext(ctx);

  const rule = findMatchingRule(normalisedTask, squad, paths);
  if (!rule) {
    return emptyResult(
      "No activation rule matched task '" + ctx.taskType + "' — no servers exposed (safest default).",
    );
  }

  const candidates = intersectWithManifest(rule.servers, manifest);
  if (candidates.length === 0) {
    return emptyResult(
      "Rule matched task '" + ctx.taskType + "' but no manifest entries overlap — no servers exposed.",
    );
  }

  const policy = await tryLoadPolicy();
  const warnings = [];

  if (!policy) {
    warnings.push(
      'policy.mjs substrate absent — activation is manifest-only. ' +
        'Install MCP-005 to enable R0-R5 risk-class enforcement.',
    );
    const projected = projectResult(candidates);
    return {
      ...projected,
      reason:
        "Task '" + ctx.taskType + "' → " + projected.servers.length +
        ' server(s) [DEGRADED — policy substrate absent].',
      mode: 'degraded',
      warnings,
    };
  }

  const permitted = applyPolicyCeiling(candidates, policy, warnings);
  const projected = projectResult(permitted);

  const reasonParts = [
    "Task '" + ctx.taskType + "' → " + projected.servers.length +
      ' server(s) permitted after policy ceiling.',
  ];
  if (warnings.length > 0) reasonParts.push('Warnings: ' + warnings.join(' | '));

  return { ...projected, reason: reasonParts.join(' '), mode: 'full', warnings };
}

/**
 * Synchronous variant of resolveActivation. DOES NOT apply the policy ceiling
 * (policy.mjs uses async import). For tests/tooling ONLY — never where the
 * policy guarantee is required.
 *
 * @param {ActivationContext} ctx
 * @param {ManifestEntry[]} manifest
 * @returns {ActivationResult}
 */
export function resolveActivationSync(ctx, manifest) {
  assertInputs(ctx, manifest, 'resolveActivationSync');
  const { normalisedTask, squad, paths } = normaliseContext(ctx);

  const rule = findMatchingRule(normalisedTask, squad, paths);
  if (!rule) {
    return emptyResult(
      "No activation rule matched task '" + ctx.taskType + "' — no servers exposed.",
      ['sync mode — policy ceiling not applied'],
    );
  }

  const candidates = intersectWithManifest(rule.servers, manifest);
  const projected = projectResult(candidates);
  return {
    ...projected,
    reason:
      "Task '" + ctx.taskType + "' → " + projected.servers.length +
      ' server(s) [sync/degraded — policy ceiling not applied].',
    mode: 'degraded',
    warnings: ['sync mode — policy ceiling not applied; use resolveActivation() for full enforcement'],
  };
}

// Re-export the table for testing and tooling (preserves the prior public surface).
export { ACTIVATION_TABLE };
