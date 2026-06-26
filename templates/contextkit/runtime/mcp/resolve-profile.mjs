/**
 * MCP Profile Resolver — maps a profile id to a PROPOSAL of server entries.
 *
 * Contract:
 *   - Returns a PROPOSAL (read-only object) — the caller decides whether to
 *     apply it. Nothing is written or activated by this module.
 *   - Any entry whose registry defaultMode is 'write' is left in the proposal
 *     but marked mode:'write' with a humanApprovalRequired flag. The caller
 *     MUST gate those entries on explicit human approval before activation.
 *   - Zero third-party dependencies (node:* only) — hot-path safe.
 *
 * @module resolve-profile
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PLATFORM_DIR } from '../config/paths.mjs';

/** @typedef {import('./registry.mjs').RegistryEntry} RegistryEntry */

/**
 * @typedef {Object} ResolvedServer
 * @property {string}   id                    Registry id.
 * @property {string}   displayName           Human-readable name from registry.
 * @property {string}   source                npm/binary source string.
 * @property {string}   transport             'stdio' or 'streamable-http'.
 * @property {string}   risk                  R0..R5.
 * @property {string}   mode                  Effective mode for this activation.
 * @property {boolean}  humanApprovalRequired True when mode is 'write'.
 * @property {string[]} referencedSecrets     Secret NAMES required.
 * @property {string[]} allowedTools          Tool allow-list (empty = all declared).
 * @property {Object}   pin                   Effective pin from registry.
 * @property {string}   approval              'auto' | 'human'.
 */

/**
 * @typedef {Object} ProfileProposal
 * @property {string}           profileId   The requested profile id.
 * @property {ResolvedServer[]} servers     Resolved server proposals.
 * @property {string}           reason      Human-readable explanation of the proposal.
 * @property {boolean}          requiresHumanApproval True if any entry needs human gate.
 */

/**
 * Loads a profile JSON file from `<root>/<PLATFORM_DIR>/mcp/profiles/<id>.json`.
 *
 * @param {string} profileId
 * @param {string} root
 * @returns {{ servers: Array<{id:string, mode?:string, referencedSecrets?:string[], allowedTools?:string[]}> }}
 * @throws {Error} If the profile file is missing or malformed.
 */
function loadProfileFile(profileId, root) {
  const profilePath = resolve(root, PLATFORM_DIR, 'mcp', 'profiles', `${profileId}.json`);
  let raw;
  try {
    raw = readFileSync(profilePath, 'utf-8');
  } catch {
    throw new Error(
      `MCP profile '${profileId}' not found at ${profilePath}. ` +
      `Available profiles: web-app, backend-api, supabase, product-design, regulated.`
    );
  }

  // Strip leading UTF-8 BOM.
  const cleaned = raw.replace(/^﻿/, '');
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (parseError) {
    throw new TypeError(`MCP profile '${profileId}' contains malformed JSON: ${parseError.message}`);
  }

  if (!parsed || !Array.isArray(parsed.servers)) {
    throw new TypeError(`MCP profile '${profileId}' must have a "servers" array at root`);
  }

  return parsed;
}

/**
 * Resolves a profile id + registry to a PROPOSAL of server configurations.
 * Nothing is written; write-mode entries are flagged for human approval.
 *
 * @param {string}          profileId  e.g. 'web-app', 'regulated'.
 * @param {RegistryEntry[]} registry   Pre-loaded registry entries from loadRegistry().
 * @param {string}          [root]     Project root (defaults to cwd).
 * @returns {ProfileProposal}
 * @throws {Error|TypeError} On unknown profile, unknown server id, or malformed profile.
 */
export function resolveProfile(profileId, registry, root = process.cwd()) {
  if (!profileId || typeof profileId !== 'string') {
    throw new TypeError(`resolveProfile: profileId must be a non-empty string, got: ${JSON.stringify(profileId)}`);
  }
  if (!Array.isArray(registry) || registry.length === 0) {
    throw new TypeError(`resolveProfile: registry must be a non-empty RegistryEntry array`);
  }

  const profile = loadProfileFile(profileId, root);
  const registryMap = new Map(registry.map((e) => [e.id, e]));

  /** @type {ResolvedServer[]} */
  const servers = [];
  const warnings = [];

  for (const profileEntry of profile.servers) {
    const regEntry = registryMap.get(profileEntry.id);
    if (!regEntry) {
      throw new Error(
        `MCP profile '${profileId}' references unknown server id '${profileEntry.id}'. ` +
        `Known ids: ${[...registryMap.keys()].join(', ')}.`
      );
    }

    // Effective mode: profile override wins if explicitly set, else registry default.
    const effectiveMode = profileEntry.mode ?? regEntry.defaultMode;
    const humanApprovalRequired =
      effectiveMode === 'write' || regEntry.approval === 'human';

    if (humanApprovalRequired) {
      warnings.push(
        `'${profileEntry.id}' needs human approval (mode=${effectiveMode}, approval=${regEntry.approval})`
      );
    }

    servers.push({
      id: regEntry.id,
      displayName: regEntry.displayName,
      source: regEntry.source,
      transport: regEntry.transport,
      risk: regEntry.risk,
      mode: effectiveMode,
      humanApprovalRequired,
      referencedSecrets: profileEntry.referencedSecrets ?? regEntry.requiredSecrets,
      allowedTools: profileEntry.allowedTools ?? [],
      pin: regEntry.pin,
      approval: regEntry.approval,
    });
  }

  const requiresHumanApproval = servers.some((s) => s.humanApprovalRequired);

  const reasonParts = [
    `Profile '${profileId}' resolves ${servers.length} server(s).`,
  ];
  if (warnings.length > 0) {
    reasonParts.push(`Human approval required for: ${warnings.join('; ')}.`);
  } else {
    reasonParts.push('All entries are auto-approvable (read-only, R0-R1).');
  }

  return {
    profileId,
    servers,
    reason: reasonParts.join(' '),
    requiresHumanApproval,
  };
}
