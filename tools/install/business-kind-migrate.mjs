/**
 * Explicit migration for legacy Business.kind values.
 *
 * The installer detects legacy values but never silently changes user-owned
 * business records. This command is dry-run by default; `--apply` performs one
 * validated atomic replacement after the operator supplies the canonical kind.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathsFor } from '../../templates/contextkit/runtime/config/paths.mjs';
import { readJsonSafe, writeFileAtomicSync } from '../../templates/contextkit/runtime/hooks/safe-io.mjs';
import { BUSINESS_KINDS, isBusinessKind } from '../../templates/contextkit/runtime/work/enums.mjs';
import { validateBusiness } from '../../templates/contextkit/runtime/work/schema-business.mjs';

/** Legacy values that require an explicit operator decision. */
export const LEGACY_BUSINESS_KINDS = Object.freeze(['PLATFORM']);

/**
 * Find Business records that still carry a retired kind.
 *
 * @param {string} target project root
 * @returns {Array<{id:string, kind:string, path:string}>} legacy records
 */
export function findLegacyBusinessKinds(target) {
  const businessRoot = pathsFor(target).business;
  let names;
  try {
    names = readdirSync(businessRoot);
  } catch {
    return [];
  }
  const legacyRecords = [];
  for (const name of names) {
    if (!/^BIZ-\d{4}-/.test(name)) continue;
    const businessPath = join(businessRoot, name, 'business.json');
    const business = readJsonSafe(businessPath, null);
    if (business && LEGACY_BUSINESS_KINDS.includes(business.kind)) {
      legacyRecords.push({ id: business.id, kind: business.kind, path: businessPath });
    }
  }
  return legacyRecords;
}

/**
 * Explicitly migrate one legacy Business.kind value.
 *
 * @param {string} target project root
 * @param {{businessId:string,targetKind:string,apply?:boolean}} options migration options
 * @returns {{applied:boolean,businessId:string,from:string,to:string,path:string,validation:string[]}}
 * @throws {Error} when the target, source kind, or destination kind is invalid
 */
export function migrateLegacyBusinessKind(target, { businessId, targetKind, apply = false } = {}) {
  if (typeof businessId !== 'string' || !/^BIZ-\d{4}$/.test(businessId)) {
    throw new Error('businessId must match BIZ-####');
  }
  if (!isBusinessKind(targetKind)) {
    throw new Error(`targetKind must be one of ${BUSINESS_KINDS.join(' | ')}`);
  }
  const record = findLegacyBusinessKinds(target).find((candidate) => candidate.id === businessId);
  if (!record) throw new Error(`no legacy Business.kind record found for ${businessId}`);
  const business = readJsonSafe(record.path, null);
  if (!business) throw new Error(`business.json is unreadable for ${businessId}`);
  const migrated = { ...business, kind: targetKind };
  const verdict = validateBusiness(migrated);
  if (!verdict.ok) throw new Error(`migrated ${businessId} is invalid — ${verdict.errors.join('; ')}`);
  if (apply) writeFileAtomicSync(record.path, `${JSON.stringify(migrated, null, 2)}\n`);
  return {
    applied: apply,
    businessId,
    from: business.kind,
    to: targetKind,
    path: record.path,
    validation: verdict.errors,
  };
}

function readFlag(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('business-kind-migrate.mjs')) {
  const [, , target, businessId] = process.argv;
  if (!target || !businessId || !readFlag('kind')) {
    console.error('Usage: node business-kind-migrate.mjs <project-root> <BIZ-####> --kind <canonical-kind> [--apply]');
    process.exit(1);
  }
  try {
    console.log(JSON.stringify(migrateLegacyBusinessKind(target, {
      businessId,
      targetKind: readFlag('kind'),
      apply: process.argv.includes('--apply'),
    }), null, 2));
  } catch (error) {
    console.error(`business-kind-migrate refused: ${error?.message ?? error}`);
    process.exit(1);
  }
}
