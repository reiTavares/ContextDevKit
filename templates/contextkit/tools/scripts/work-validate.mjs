/**
 * `work validate` handler — validates a Business or Operation entity's JSON
 * against its schema (BIZ-0001 / WF-0036, Wave 3, OP-0005 / ADR-0125).
 *
 * Routes to:
 *   `runtime/work/schema-operation.mjs` → `validateOperation`
 *   `runtime/work/schema-business.mjs`  → `validateBusiness`
 *
 * Posture (constitution §8): this is a PURE READ command. `--apply` has no
 * write side-effect (validate is always read-only). `--check` reports readiness
 * only (schema modules loadable, no entity required).
 *
 * In normal mode, `--id BIZ-####` or `--id OP-####` is required to identify the
 * entity to validate. Without `--id`, validates every entity on disk (scan mode).
 *
 * Zero runtime dependencies — `node:*` + sibling/runtime modules only.
 *
 * @module work-validate
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { makeReceipt } from './work-io.mjs';
import { validateOperation } from '../../runtime/work/schema-operation.mjs';
import { validateBusiness } from '../../runtime/work/schema-business.mjs';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Reads and JSON-parses a file, stripping BOM. Returns `{ ok, entity, error }`.
 *
 * @param {string} filePath - absolute path.
 * @returns {{ ok: boolean, entity: object|null, error: string|null }}
 */
function tryReadJson(filePath) {
  if (!existsSync(filePath)) return { ok: false, entity: null, error: `file not found: "${filePath}"` };
  try {
    const raw = readFileSync(filePath, 'utf-8').replace(/^﻿/, '');
    return { ok: true, entity: JSON.parse(raw), error: null };
  } catch (err) {
    return { ok: false, entity: null, error: `parse error: ${err.message}` };
  }
}

/**
 * Determines which validator to use and runs it.
 *
 * @param {string} entityId - the entity id (`BIZ-####` or `OP-####`).
 * @param {object} entity - the parsed entity object.
 * @returns {{ schemaOk: boolean, errors: string[] }}
 */
function runValidator(entityId, entity) {
  if (String(entityId).startsWith('BIZ-')) {
    const verdict = validateBusiness(entity);
    return { schemaOk: verdict.ok, errors: verdict.errors };
  }
  if (String(entityId).startsWith('OP-')) {
    const verdict = validateOperation(entity);
    return { schemaOk: verdict.ok, errors: verdict.errors };
  }
  return { schemaOk: false, errors: [`unknown entity id pattern for "${entityId}" — expected BIZ-#### or OP-####`] };
}

/**
 * Scans all context folders under `root` dir, collecting `{ id, jsonPath }` pairs.
 *
 * @param {string} dir - absolute directory to scan (business/ or operations/).
 * @param {string} jsonName - the JSON file name in each folder (e.g. `business.json`).
 * @param {RegExp} idPattern - pattern to match the leading id in the folder name.
 * @returns {Array<{ id: string, jsonPath: string }>}
 */
function scanContextDir(dir, jsonName, idPattern) {
  if (!existsSync(dir)) return [];
  const entries = [];
  try {
    const folders = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== '_TEMPLATE');
    for (const folder of folders) {
      const match = folder.name.match(idPattern);
      if (!match) continue;
      entries.push({ id: match[0], jsonPath: resolve(dir, folder.name, jsonName) });
    }
  } catch { /* unreadable dir */ }
  return entries;
}

// ---------------------------------------------------------------------------
// Public handler
// ---------------------------------------------------------------------------

/**
 * Handles `work validate` — validates the operation.json or business.json for
 * a specific entity (when `--id` is given) or all entities on disk (scan mode).
 *
 * `--check` mode only tests that the validator modules are importable.
 *
 * @param {{ flags: Record<string,string|boolean>, apply: boolean, root: string }} ctx
 * @returns {ReturnType<typeof makeReceipt>}
 */
export function handleValidate({ flags, root }) {
  const checkOnly = flags.check === true;

  if (checkOnly) {
    // Readiness: verify that both schema validators exported their functions.
    const bizOk = typeof validateBusiness === 'function';
    const opOk = typeof validateOperation === 'function';
    return makeReceipt({
      command: 'validate',
      applied: false,
      writes: [],
      detail: {
        check: true,
        ready: bizOk && opOk,
        validators: { business: bizOk, operation: opOk },
      },
    });
  }

  const entityId = typeof flags.id === 'string' ? flags.id.trim() : null;
  const paths = pathsFor(root);

  if (entityId) {
    // Single-entity validation.
    const isBiz = entityId.startsWith('BIZ-');
    const jsonName = isBiz ? 'business.json' : 'operation.json';
    const dir = isBiz ? paths.business : paths.operations;
    const prefix = `${entityId}-`;
    let jsonPath;
    try {
      const match = readdirSync(dir).find((name) => name === entityId || name.startsWith(prefix));
      jsonPath = match ? join(dir, match, jsonName) : join(dir, entityId, jsonName);
    } catch {
      jsonPath = join(dir, entityId, jsonName);
    }

    const { ok: readOk, entity, error: readError } = tryReadJson(jsonPath);
    if (!readOk) {
      return makeReceipt({
        command: 'validate',
        applied: false,
        writes: [],
        detail: { id: entityId, valid: false, errors: [readError] },
      });
    }

    const { schemaOk, errors } = runValidator(entityId, entity);
    return makeReceipt({
      command: 'validate',
      applied: false,
      writes: [],
      detail: { id: entityId, valid: schemaOk, errors },
    });
  }

  // Scan mode: validate all Business + Operation entities on disk.
  const bizEntries = scanContextDir(paths.business, 'business.json', /^BIZ-\d{4}/);
  const opEntries = scanContextDir(paths.operations, 'operation.json', /^OP-\d{4}/);
  const allEntries = [...bizEntries, ...opEntries];

  const results = allEntries.map(({ id, jsonPath }) => {
    const { ok: readOk, entity, error: readError } = tryReadJson(jsonPath);
    if (!readOk) return { id, valid: false, errors: [readError] };
    const { schemaOk, errors } = runValidator(id, entity);
    return { id, valid: schemaOk, errors };
  });

  const allValid = results.every((result) => result.valid);
  return makeReceipt({
    command: 'validate',
    applied: false,
    writes: [],
    detail: { scanMode: true, count: results.length, allValid, results },
  });
}
