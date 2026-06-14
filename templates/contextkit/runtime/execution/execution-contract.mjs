/**
 * execution-contract.mjs — Build, persist and reclassify an Execution Contract (CDK-021, ADR-0072).
 *
 * An Execution Contract maps a task's canonical signals to the set of governance
 * capabilities that MUST run at each lifecycle moment:
 *   beforeExploration — capabilities to satisfy before reading unfamiliar code.
 *   beforeWrite       — capabilities to satisfy before any file mutation.
 *   beforeCompletion  — capabilities to satisfy before the task is declared done.
 *
 * Capabilities with moment 'informational' are collected into `recommended` only
 * and are never placed into a required list.
 *
 * Contracts are persisted atomically to:
 *   <pipeline>/state/<id>/execution-contract.json
 * They are intentionally CO-LOCATED with the task's state.json but kept as a SEPARATE
 * file because state-io.mjs's normalize() drops unknown fields (a contract has fields
 * that are not part of the pipeline-state schema).
 *
 * Zero runtime dependencies — only `node:*` and the canonical platform primitives.
 * Do NOT import config/load.mjs or any hook file.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomicSync, readJsonSafe } from '../hooks/safe-io.mjs';
import { resolveCapabilities, loadRegistry } from '../capabilities/resolve-capabilities.mjs';
import { pathsFor } from '../config/paths.mjs';

/** Schema version for future migrations. */
const CONTRACT_VERSION = 1;

/**
 * Ceremony tier rank — used by reclassify to determine when a scope shrink may
 * drop required capabilities. Lower rank = lower ceremony.
 */
const TIER_RANK = { trivial: 0, feature: 1, architectural: 2 };

/**
 * Groups applicable capabilities by their required lifecycle moment and returns
 * a fully populated Execution Contract object.
 *
 * The contract object contains the taskId, sessionId, branch, host, the filtered
 * signal snapshot, the per-moment capability id lists (sorted for determinism),
 * a recommended list (informational capabilities, also sorted), plus createdAt and
 * an empty history array.
 *
 * This function is PURE except for Date.now() — tests must compare required-set
 * fields, not createdAt.
 *
 * @param {{ taskId: string|null, sessionId: string|null, branch: string|null,
 *           host: string|null, tier: string, domain: string, level: number,
 *           needsAdr: boolean, paths: string[], phase?: string }} signals
 * @param {object} [registry] capability registry (defaults to loadRegistry())
 * @returns {object} execution contract
 */
export function buildContract(signals, registry = loadRegistry()) {
  if (!signals || typeof signals !== 'object') {
    throw new TypeError('buildContract: signals must be a non-null object');
  }

  const applicable = resolveCapabilities(signals, registry);

  const requiredBeforeExploration = [];
  const requiredBeforeWrite = [];
  const requiredBeforeCompletion = [];
  const recommended = [];

  for (const cap of applicable) {
    switch (cap.requiredMoment) {
      case 'beforeExploration':
        requiredBeforeExploration.push(cap.id);
        break;
      case 'beforeWrite':
        requiredBeforeWrite.push(cap.id);
        break;
      case 'beforeCompletion':
        requiredBeforeCompletion.push(cap.id);
        break;
      case 'informational':
        recommended.push(cap.id);
        break;
      // Unknown moments are silently ignored — forward-compatibility.
    }
  }

  // Sort each list for deterministic output (resolveCapabilities already sorts by id,
  // but a secondary sort here guards against future resolver changes).
  requiredBeforeExploration.sort();
  requiredBeforeWrite.sort();
  requiredBeforeCompletion.sort();
  recommended.sort();

  return {
    version: CONTRACT_VERSION,
    taskId: signals.taskId ?? null,
    sessionId: signals.sessionId ?? null,
    branch: signals.branch ?? null,
    host: signals.host ?? null,
    signals: {
      tier: signals.tier,
      domain: signals.domain,
      level: signals.level,
      needsAdr: signals.needsAdr,
      paths: Array.isArray(signals.paths) ? signals.paths : [],
    },
    requiredBeforeExploration,
    requiredBeforeWrite,
    requiredBeforeCompletion,
    recommended,
    createdAt: Date.now(),
    history: [],
  };
}

/**
 * Atomically persists an execution contract to the canonical path.
 *
 * Creates the parent directory if it does not exist. Uses writeFileAtomicSync so
 * concurrent readers always see either the previous file or the complete new one.
 *
 * @param {string} root project root
 * @param {string} id task id (used as the state sub-directory name)
 * @param {object} contract execution contract from buildContract()
 * @returns {void}
 */
export function saveContract(root, id, contract) {
  const contractPath = contractPathFor(root, id);
  const stateDir = join(pathsFor(root).pipeline, 'state', String(id));
  mkdirSync(stateDir, { recursive: true });
  writeFileAtomicSync(contractPath, JSON.stringify(contract, null, 2));
}

/**
 * Reads a persisted execution contract. Returns null when the file is missing or
 * unparseable — never throws (defensive I/O, ADR-0072 / rule 2).
 *
 * @param {string} root project root
 * @param {string} id task id
 * @returns {object|null}
 */
export function loadContract(root, id) {
  return readJsonSafe(contractPathFor(root, id), null);
}

/**
 * Rebuilds an execution contract from new signals while PRESERVING the history
 * carried in the existing contract.
 *
 * History policy (v1):
 *   - Additions are always allowed: new required capabilities are accepted regardless
 *     of scope direction.
 *   - Removals on scope shrink (newSignals.tier ranks LOWER than existing) are RECORDED
 *     in history but still applied. This preserves auditability without silently
 *     re-adding gates that the updated scope no longer warrants. Any consumer that
 *     needs to re-enforce removed gates can inspect history.
 *   - Removals on scope expansion or lateral move (same tier or higher) are applied
 *     normally — a higher-tier reclassification may naturally produce a different set.
 *
 * The caller is responsible for saving the returned contract if persistence is desired.
 *
 * @param {object} existing previously built or loaded contract
 * @param {{ tier: string, domain: string, level: number, needsAdr: boolean,
 *           paths: string[], phase?: string, taskId?: string|null,
 *           sessionId?: string|null, branch?: string|null, host?: string|null }} newSignals
 * @param {object} [registry] capability registry
 * @param {string} [reason] human-readable reason for the reclassification
 * @returns {object} new contract with updated fields and appended history entry
 */
export function reclassify(existing, newSignals, registry = loadRegistry(), reason = '') {
  if (!existing || typeof existing !== 'object') {
    throw new TypeError('reclassify: existing must be a non-null contract object');
  }

  const fresh = buildContract(newSignals, registry);

  // Collect all previously required ids (across all moments).
  const prevRequired = new Set([
    ...(existing.requiredBeforeExploration ?? []),
    ...(existing.requiredBeforeWrite ?? []),
    ...(existing.requiredBeforeCompletion ?? []),
  ]);
  const nextRequired = new Set([
    ...fresh.requiredBeforeExploration,
    ...fresh.requiredBeforeWrite,
    ...fresh.requiredBeforeCompletion,
  ]);

  const added = [...nextRequired].filter((id) => !prevRequired.has(id)).sort();
  const removed = [...prevRequired].filter((id) => !nextRequired.has(id)).sort();

  const prevTierRank = TIER_RANK[existing.signals?.tier] ?? 1;
  const nextTierRank = TIER_RANK[newSignals.tier] ?? 1;
  const isScopeShrink = nextTierRank < prevTierRank;

  const historyEntry = {
    ts: fresh.createdAt,
    event: 'reclassified',
    added,
    removed,
    isScopeShrink,
    reason: reason || 'signals updated',
  };

  // Build the returned contract: fresh data + preserved + extended history.
  const previousHistory = Array.isArray(existing.history) ? existing.history : [];
  return {
    ...fresh,
    createdAt: existing.createdAt ?? fresh.createdAt,
    history: [...previousHistory, historyEntry],
  };
}

/**
 * Returns the absolute path for a task's execution-contract.json.
 *
 * @param {string} root project root
 * @param {string} id task id
 * @returns {string}
 */
function contractPathFor(root, id) {
  return join(pathsFor(root).pipeline, 'state', String(id), 'execution-contract.json');
}
