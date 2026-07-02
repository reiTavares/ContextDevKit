/**
 * policy-load.mjs — defensive loader for the devteam policy tables
 * (ADR-0128 §11/§12, WF-0064). The tables are the SINGLE SOURCE of skill
 * registration, triggers and the playbook journey — they are NEVER embedded in
 * the engine (ADR-0129 §4). The resolvers read them at call time.
 *
 * Fail-open contract (immutable rule 2 + constitution §8): a missing or
 * unparseable table returns `{ table: null, degraded: true, reasonCode }` — the
 * caller degrades to a recorded receipt (conservative baseline), NEVER a false
 * pass. NOTE: installer distribution of `policy/devteam/` (and the `skills/`
 * tree) is deferred to WF-0068 (multi-host installer & rollout) — until then a
 * real install resolves the recorded baseline via this fail-open path.
 *
 * Zero runtime dependencies — `node:fs` + the canonical paths primitive only.
 *
 * @module devteam/policy-load
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathsFor } from '../config/paths.mjs';

/** Sub-directory under `policy/` holding the devteam tables. */
const POLICY_SUBDIR = 'devteam';

/** Canonical table ids → filenames (mirrors policy-manifest.json). */
export const DEVTEAM_POLICY_TABLES = Object.freeze({
  skillsRegistry: 'skills-registry.json',
  skillTriggers: 'skill-triggers.json',
  playbook: 'playbook.json',
  reasonCodes: 'reason-codes.json',
  manifest: 'policy-manifest.json',
});

/**
 * Reads + parses one devteam policy table by id. Strips a UTF-8 BOM before
 * parsing and validates `schemaVersion === 1`. Never throws.
 *
 * @param {string} root absolute project root.
 * @param {string} tableId one of DEVTEAM_POLICY_TABLES' keys.
 * @returns {{ table: object|null, degraded: boolean, reasonCode: string|null }}
 */
export function loadDevteamPolicyTable(root, tableId) {
  const filename = DEVTEAM_POLICY_TABLES[tableId];
  if (!filename) return degraded('DEVTEAM_POLICY_DEGRADED');
  try {
    const file = join(pathsFor(root).policy, POLICY_SUBDIR, filename);
    if (!existsSync(file)) return degraded('DEVTEAM_POLICY_DEGRADED');
    const parsed = JSON.parse(readFileSync(file, 'utf-8').replace(/^﻿/, ''));
    if (!parsed || parsed.schemaVersion !== 1) return degraded('DEVTEAM_POLICY_DEGRADED');
    return { table: parsed, degraded: false, reasonCode: null };
  } catch {
    return degraded('DEVTEAM_POLICY_DEGRADED');
  }
}

/**
 * Loads the devteam policy bundle the resolvers need in one call. Each entry
 * carries its own degraded flag so a single missing table never sinks the rest.
 *
 * @param {string} root absolute project root.
 * @returns {{ skillsRegistry: object|null, skillTriggers: object|null,
 *   playbook: object|null, degraded: boolean, missing: string[] }}
 */
export function loadDevteamPolicyBundle(root) {
  const ids = ['skillsRegistry', 'skillTriggers', 'playbook'];
  const loaded = ids.map((id) => [id, loadDevteamPolicyTable(root, id)]);
  const missing = loaded.filter(([, result]) => result.degraded).map(([id]) => id);
  const pick = (id) => loaded.find(([k]) => k === id)[1].table;
  return {
    skillsRegistry: pick('skillsRegistry'),
    skillTriggers: pick('skillTriggers'),
    playbook: pick('playbook'),
    degraded: missing.length > 0,
    missing,
  };
}

/** Builds the degraded sentinel result. */
function degraded(reasonCode) {
  return { table: null, degraded: true, reasonCode };
}
