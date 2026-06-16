/**
 * Additive policy-store distribution for `npx contextdevkit --update` (ADR-0097,
 * CDK-082). Companion to config-migrate.mjs: where that additively merges new
 * config SECTIONS, this additively merges new keys into the project's saved
 * POLICY stores (contextkit/policy/*.json) without ever clobbering a user's edits.
 *
 * Reuses the proven additive merge of `migrateConfigSections` (same semantics:
 * clone-not-mutate, user value always wins, arrays are leaves, idempotent). The
 * advisory dry-run PLAN counterpart is `tools/scripts/policy-distribution.mjs`
 * (`additivePlan`) — this module is the APPLY side, run by the installer.
 *
 * Design constraints (ADR-0097):
 *   - Additive-only: an existing target store keeps every user value; only keys
 *     absent from it are copied from the kit baseline.
 *   - Skip-not-fabricate: a missing/corrupt baseline or target store is skipped
 *     (never written from nothing here — fresh seeding is MEMORY_SEEDS' job). §8.
 *   - Fail-open: a parse error on any store is swallowed; the install never breaks.
 *   - Zero runtime dependencies.
 *
 * @module policy-migrate
 */
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { migrateConfigSections } from './config-migrate.mjs';

/** Policy stores the kit ships and additively distributes on update. */
const POLICY_STORES = [
  'complexity-rubric.json',
  'routing-policy.json',
  'squads-registry.json',
  'capability-registry.json',
];

/**
 * Parses JSON text, stripping a leading BOM. Returns null on any error.
 * @param {string} text
 * @returns {Record<string, unknown> | null}
 */
function parseJsonSafe(text) {
  try {
    const parsed = JSON.parse(String(text).replace(/^﻿/, ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Additively merges each kit baseline policy store into the project's existing
 * store. Only stores already present in the target are touched (fresh seeding is
 * handled separately by MEMORY_SEEDS); a present store gains any keys it lacks,
 * never losing a user value.
 *
 * @param {string}   target  - project root
 * @param {string}   tplDir  - templates dir (kit baseline source)
 * @param {{ read:(p:string)=>Promise<string>, overwrite:(p:string,c:string)=>Promise<void> }} io
 * @param {string[]} report  - mutated with progress lines
 * @returns {Promise<void>}
 */
export async function migratePolicyStores(target, tplDir, io, report) {
  for (const store of POLICY_STORES) {
    const baselinePath = join(tplDir, 'contextkit', 'policy', store);
    const targetPath = join(target, 'contextkit', 'policy', store);

    // Skip when the project doesn't have this store (seeding owns fresh writes),
    // or when the kit baseline is missing (§8 — never fabricate from nothing).
    if (!existsSync(baselinePath) || !existsSync(targetPath)) continue;

    const baseline = parseJsonSafe(await io.read(baselinePath));
    const current = parseJsonSafe(await io.read(targetPath));
    if (!baseline || !current) continue; // corrupt either side → skip (fail-open).

    const { cfg: merged, added } = migrateConfigSections(current, baseline);
    if (added.length === 0) continue; // idempotent — nothing new to distribute.

    await io.overwrite(targetPath, JSON.stringify(merged, null, 2) + '\n');
    report.push(`📦 policy/${store}: +${added.length} key(s) (${added.join(', ')})`);
  }
}
