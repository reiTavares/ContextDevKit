/**
 * policy-load.mjs — defensive loader for the domain-engineering policy tables
 * (ADR-0128 / ADR-0129 §4). The policy tables are the SINGLE SOURCE of every
 * weight, threshold and hard trigger — they are NEVER embedded in the engine
 * (§4). The scorers read them at call time.
 *
 * Fail-open contract (immutable rule 2 + constitution §8): a missing or
 * unparseable table returns `{ table: null, degraded: true, reasonCode }` — the
 * caller degrades to a recorded receipt, NEVER a false pass. On a fresh install
 * the tables ship with the kit, so the normal path is fully deterministic.
 *
 * Zero runtime dependencies — `node:fs` + the canonical paths primitive only.
 *
 * @module domain-engineering/policy-load
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathsFor } from '../config/paths.mjs';

/** Sub-directory under `policy/` holding the domain-engineering tables. */
const POLICY_SUBDIR = 'domain-engineering';

/** Canonical table ids → filenames (mirrors policy-manifest.json). */
export const POLICY_TABLES = Object.freeze({
  codeIntentWeights: 'code-intent-weights.json',
  domainApplicabilityWeights: 'domain-applicability-weights.json',
  profileThresholds: 'profile-thresholds.json',
  pathRules: 'path-rules.json',
  hardTriggers: 'hard-triggers.json',
  reasonCodes: 'reason-codes.json',
  ruleClasses: 'rule-classes.json',
  manifest: 'policy-manifest.json',
});

/**
 * Reads + parses one policy table by id. Strips a UTF-8 BOM before parsing and
 * validates `schemaVersion === 1`. Never throws.
 *
 * @param {string} root absolute project root.
 * @param {string} tableId one of POLICY_TABLES' keys.
 * @returns {{ table: object|null, degraded: boolean, reasonCode: string|null }}
 */
export function loadPolicyTable(root, tableId) {
  const filename = POLICY_TABLES[tableId];
  if (!filename) return degraded('POLICY_UNKNOWN_TABLE');
  try {
    const file = join(pathsFor(root).policy, POLICY_SUBDIR, filename);
    if (!existsSync(file)) return degraded('POLICY_FALLBACK_DEFAULT');
    const parsed = JSON.parse(readFileSync(file, 'utf-8').replace(/^﻿/, ''));
    if (!parsed || parsed.schemaVersion !== 1) return degraded('POLICY_FALLBACK_DEFAULT');
    return { table: parsed, degraded: false, reasonCode: null };
  } catch {
    return degraded('POLICY_FALLBACK_DEFAULT');
  }
}

/**
 * Loads the full policy bundle the scorers need in one call. Each entry carries
 * its own degraded flag so a single missing table never sinks the others.
 *
 * @param {string} root absolute project root.
 * @returns {{ codeIntent: object, domainApplicability: object, profiles: object,
 *   pathRules: object, hardTriggers: object, ruleClasses: object,
 *   degraded: boolean, missing: string[] }}
 */
export function loadPolicyBundle(root) {
  const ids = ['codeIntentWeights', 'domainApplicabilityWeights', 'profileThresholds', 'pathRules', 'hardTriggers', 'ruleClasses'];
  const loaded = ids.map((id) => [id, loadPolicyTable(root, id)]);
  const missing = loaded.filter(([, result]) => result.degraded).map(([id]) => id);
  const pick = (id) => loaded.find(([k]) => k === id)[1].table;
  return {
    codeIntent: pick('codeIntentWeights'),
    domainApplicability: pick('domainApplicabilityWeights'),
    profiles: pick('profileThresholds'),
    pathRules: pick('pathRules'),
    hardTriggers: pick('hardTriggers'),
    ruleClasses: pick('ruleClasses'),
    degraded: missing.length > 0,
    missing,
  };
}

/** Builds the degraded sentinel result. */
function degraded(reasonCode) {
  return { table: null, degraded: true, reasonCode };
}
