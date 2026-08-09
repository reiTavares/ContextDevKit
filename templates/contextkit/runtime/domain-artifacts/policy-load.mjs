/**
 * policy-load.mjs — defensive loader for the domain-artifacts policy tables
 * (ADR-0128 §13/§21/§22, WF-0066). The tables are the SINGLE SOURCE of the five
 * artifact contracts, the Task Compiler recipe declarations and the governed
 * scaffold contracts — they are NEVER embedded in the engine (ADR-0129 §4). The
 * validators/compilers/resolvers read them at call time.
 *
 * Fail-open contract (immutable rule 2 + constitution §8): a missing or
 * unparseable table returns `{ table: null, degraded: true, reasonCode }` — the
 * caller degrades to a recorded receipt, NEVER a false pass.
 *
 * Zero runtime dependencies — `node:fs` + the canonical paths primitive only.
 *
 * @module domain-artifacts/policy-load
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathsFor } from '../config/paths.mjs';

/** Sub-directory under `policy/` holding the domain-artifacts tables. */
const POLICY_SUBDIR = 'domain-artifacts';

/** Canonical table ids → filenames (mirrors policy-manifest.json). */
export const DOMAIN_ARTIFACTS_POLICY_TABLES = Object.freeze({
  artifactSchemas: 'artifact-schemas.json',
  recipeContracts: 'recipe-contracts.json',
  scaffoldContracts: 'scaffold-contracts.json',
  reasonCodes: 'reason-codes.json',
  manifest: 'policy-manifest.json',
});

/**
 * Reads + parses one domain-artifacts policy table by id. Strips a UTF-8 BOM
 * before parsing and validates `schemaVersion === 1`. Never throws.
 *
 * @param {string} root absolute project root.
 * @param {string} tableId one of DOMAIN_ARTIFACTS_POLICY_TABLES' keys.
 * @returns {{ table: object|null, degraded: boolean, reasonCode: string|null }}
 */
export function loadDomainArtifactsPolicyTable(root, tableId) {
  const filename = DOMAIN_ARTIFACTS_POLICY_TABLES[tableId];
  if (!filename) return degraded('ARTIFACTS_POLICY_DEGRADED');
  try {
    const file = join(pathsFor(root).policy, POLICY_SUBDIR, filename);
    if (!existsSync(file)) return degraded('ARTIFACTS_POLICY_DEGRADED');
    const parsed = JSON.parse(readFileSync(file, 'utf-8').replace(/^﻿/, ''));
    if (!parsed || ![1, 2].includes(parsed.schemaVersion)) return degraded('ARTIFACTS_POLICY_DEGRADED');
    return { table: parsed, degraded: false, reasonCode: null };
  } catch {
    return degraded('ARTIFACTS_POLICY_DEGRADED');
  }
}

/**
 * Loads the full domain-artifacts policy bundle the validators/compilers need
 * in one call. Each entry carries its own degraded flag so a single missing
 * table never sinks the others.
 *
 * @param {string} root absolute project root.
 * @returns {{ artifactSchemas: object|null, recipeContracts: object|null,
 *   scaffoldContracts: object|null, reasonCodes: object|null,
 *   degraded: boolean, missing: string[] }}
 */
export function loadDomainArtifactsPolicyBundle(root) {
  const ids = ['artifactSchemas', 'recipeContracts', 'scaffoldContracts', 'reasonCodes'];
  const loaded = ids.map((id) => [id, loadDomainArtifactsPolicyTable(root, id)]);
  const missing = loaded.filter(([, result]) => result.degraded).map(([id]) => id);
  const pick = (id) => loaded.find(([k]) => k === id)[1].table;
  return {
    artifactSchemas: pick('artifactSchemas'),
    recipeContracts: pick('recipeContracts'),
    scaffoldContracts: pick('scaffoldContracts'),
    reasonCodes: pick('reasonCodes'),
    degraded: missing.length > 0,
    missing,
  };
}

/** Builds the degraded sentinel result. */
function degraded(reasonCode) {
  return { table: null, degraded: true, reasonCode };
}
