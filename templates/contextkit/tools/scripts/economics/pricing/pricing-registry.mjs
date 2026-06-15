#!/usr/bin/env node
/**
 * pricing-registry — versioned offline price snapshot loader and query API.
 * EACP-04 / ADR-0079 panel E1.
 *
 * Single module (cohesion: all exports operate on one immutable registry object;
 * no distinct second consumer yet — ADR-0079 §cohesion). Responsibilities:
 * load + validate JSON, merge override, resolve ids/aliases, usability gate,
 * drift detection, summary, thin CLI.
 *
 * Constitution §8 (refuse-by-default):
 *   - Missing registry → null (cost engine degrades to skipped, not false price).
 *   - Present but malformed → THROW (fail-fast; never silently mis-price).
 *   - 'inferred'/'unknown' confidence → isPriceUsable false (no dollar figure).
 *
 * Zero runtime deps: node:fs, node:path, node:url + relative ../privacy.mjs.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { skipped } from '../privacy.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Canonical schema identifier; validated on every registry load. */
export const REGISTRY_SCHEMA_VERSION = 'eacp-pricing-registry/1';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REGISTRY_PATH = resolve(HERE, 'pricing-registry.json');
const DEFAULT_OVERRIDE_PATH = resolve(HERE, 'pricing-registry.override.json');

/** Confidence levels whose prices are safe for a dollar figure. */
const USABLE_CONFIDENCE = new Set(['direct', 'derived']);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Reads and parses a JSON file, stripping a BOM if present (rule 4).
 * @param {string} filePath
 * @returns {unknown}
 * @throws {SyntaxError}
 */
function readJson(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  return JSON.parse(raw.replace(/^﻿/, ''));
}

/**
 * Validates the top-level shape of a loaded registry. Fail-fast (constitution §8).
 * @param {unknown} obj
 * @throws {Error} When schemaVersion is missing/wrong or models is not an array.
 */
function validateShape(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('pricing-registry: root value must be a JSON object');
  }
  if (obj.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
    throw new Error(
      `pricing-registry: unsupported schemaVersion "${obj.schemaVersion}"; ` +
      `expected "${REGISTRY_SCHEMA_VERSION}"`
    );
  }
  if (!Array.isArray(obj.models)) {
    throw new Error('pricing-registry: "models" must be an array');
  }
}

/**
 * Deep-merges override model entries over the base array by canonicalId.
 * Unmatched override entries are appended. Base array is not mutated.
 * @param {object[]} baseModels
 * @param {object[]} overrideModels
 * @returns {object[]}
 */
function mergeModels(baseModels, overrideModels) {
  const merged = baseModels.map(entry => ({ ...entry }));
  for (const override of overrideModels) {
    const idx = merged.findIndex(e => e.canonicalId === override.canonicalId);
    if (idx >= 0) {
      merged[idx] = { ...merged[idx], ...override };
    } else {
      merged.push({ ...override });
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Loads the pricing registry from disk.
 *
 * If the file does not exist, returns null (degrade-to-skip). If it exists
 * but is malformed or fails shape validation, throws (fail-fast). Merges a
 * sibling pricing-registry.override.json when present (missing override is fine).
 *
 * @param {string} [filePath] - Defaults to the sibling pricing-registry.json.
 * @returns {object|null}
 * @throws {Error} On malformed or structurally invalid registry.
 */
export function loadRegistry(filePath = DEFAULT_REGISTRY_PATH) {
  if (!existsSync(filePath)) return null;

  const registry = readJson(filePath);
  validateShape(registry);

  const overridePath = filePath === DEFAULT_REGISTRY_PATH
    ? DEFAULT_OVERRIDE_PATH
    : resolve(dirname(filePath), 'pricing-registry.override.json');

  if (existsSync(overridePath)) {
    const overrideRaw = readJson(overridePath);
    if (Array.isArray(overrideRaw?.models)) {
      registry.models = mergeModels(registry.models, overrideRaw.models);
    }
  }

  return registry;
}

/**
 * Resolves any canonical id or alias string to the registry's canonicalId.
 *
 * Match order (all case-insensitive):
 *   1. canonicalId exact match.
 *   2. aliases array includes the input.
 *   3. canonicalId ends with the input (prefix-mismatch tolerance, e.g.
 *      "claude-opus-4-8" matches "anthropic/claude-opus-4-8").
 *
 * @param {object} registry
 * @param {string} idOrAlias
 * @returns {string|null}
 */
export function resolveModelId(registry, idOrAlias) {
  if (!registry || typeof idOrAlias !== 'string') return null;
  const needle = idOrAlias.toLowerCase();

  for (const entry of registry.models) {
    if (entry.canonicalId?.toLowerCase() === needle) return entry.canonicalId;
    if (Array.isArray(entry.aliases) &&
        entry.aliases.some(a => a.toLowerCase() === needle)) {
      return entry.canonicalId;
    }
  }
  for (const entry of registry.models) {
    if (entry.canonicalId?.toLowerCase().endsWith(needle)) return entry.canonicalId;
  }
  return null;
}

/**
 * Returns the full registry entry for a model id or alias.
 * @param {object|null} registry - Loaded registry (may be null when absent).
 * @param {string} idOrAlias
 * @returns {object|null} Entry or null when registry is null or id not found.
 */
export function priceFor(registry, idOrAlias) {
  if (!registry) return null;
  const canonicalId = resolveModelId(registry, idOrAlias);
  if (!canonicalId) return null;
  return registry.models.find(e => e.canonicalId === canonicalId) ?? null;
}

/**
 * Returns true only when the entry's confidence is 'direct' or 'derived'.
 *
 * 'inferred'/'unknown'/missing → false. This is the single gate the cost engine
 * uses to decide whether to emit a dollar figure (constitution §8).
 *
 * @param {object|null|undefined} entry
 * @returns {boolean}
 */
export function isPriceUsable(entry) {
  if (!entry || typeof entry !== 'object') return false;
  return USABLE_CONFIDENCE.has(entry.confidence);
}

/**
 * Detects price drift between the registry and an external comparison array.
 *
 * Pure — no I/O. For every comparison entry, checks input and output prices
 * against the registry. Emits {canonicalId, field, registry, comparison} for
 * each differing price and {canonicalId, field:'missing-in-registry'} for ids
 * absent from the registry.
 *
 * @param {object} registry
 * @param {Array<{canonicalId: string, input: number, output: number}>} comparison
 * @returns {Array<{canonicalId: string, field: string, registry?: number, comparison?: number}>}
 */
export function detectDrift(registry, comparison) {
  if (!registry || !Array.isArray(comparison)) return [];
  const drifts = [];
  for (const compEntry of comparison) {
    const regEntry = registry.models.find(e => e.canonicalId === compEntry.canonicalId);
    if (!regEntry) {
      drifts.push({ canonicalId: compEntry.canonicalId, field: 'missing-in-registry' });
      continue;
    }
    for (const field of ['input', 'output']) {
      if (regEntry[field] !== compEntry[field]) {
        drifts.push({ canonicalId: compEntry.canonicalId, field,
          registry: regEntry[field], comparison: compEntry[field] });
      }
    }
  }
  return drifts;
}

/**
 * Returns a concise summary of the registry state, or the skipped() marker
 * when the registry is null (absent). Never counts absence as a pass
 * (constitution §8 false-negative prohibition).
 *
 * @param {object|null} registry
 * @returns {{ schemaVersion: string, updated: string, modelCount: number,
 *   usableCount: number, inferredCount: number }
 *   | Readonly<{status: 'skipped', reason: string}>}
 */
export function registrySummary(registry) {
  if (!registry) return skipped('pricing registry not installed');
  return {
    schemaVersion: registry.schemaVersion,
    updated: registry.updated,
    modelCount: registry.models.length,
    usableCount: registry.models.filter(isPriceUsable).length,
    inferredCount: registry.models.filter(e => e.confidence === 'inferred').length,
  };
}

// ---------------------------------------------------------------------------
// Thin CLI (guarded by import.meta main check — library-safe)
// ---------------------------------------------------------------------------

const isMain =
  process.argv[1] && resolve(process.argv[1]).endsWith('pricing-registry.mjs');

if (isMain) {
  const argv = process.argv.slice(2);
  const verb = argv[0];
  const useJson = argv.includes('--json');
  try {
    const registry = loadRegistry();
    if (verb === 'summary') {
      const result = registrySummary(registry);
      if (useJson) {
        console.log(JSON.stringify(result, null, 2));
      } else if (result.status === 'skipped') {
        console.log(`skipped: ${result.reason}`);
      } else {
        console.log(
          `schema: ${result.schemaVersion}  updated: ${result.updated}  ` +
          `models: ${result.modelCount}  usable: ${result.usableCount}  ` +
          `inferred: ${result.inferredCount}`
        );
      }
    } else if (verb === 'price') {
      const idOrAlias = argv[1] && !argv[1].startsWith('--') ? argv[1] : null;
      if (!idOrAlias) {
        console.error('Usage: pricing-registry.mjs price <idOrAlias> [--json]');
        process.exit(1);
      }
      const entry = priceFor(registry, idOrAlias);
      if (!entry) {
        const notFound = skipped(`model "${idOrAlias}" not found in registry`);
        console.log(useJson ? JSON.stringify(notFound, null, 2) : `skipped: ${notFound.reason}`);
      } else if (useJson) {
        console.log(JSON.stringify(entry, null, 2));
      } else {
        console.log(
          `${entry.canonicalId}  in: $${entry.input}  out: $${entry.output}  ` +
          `conf: ${entry.confidence} (${isPriceUsable(entry) ? 'usable' : 'NOT-usable'})`
        );
      }
    } else {
      console.error('Usage: pricing-registry.mjs <summary|price> [args]');
      process.exit(1);
    }
  } catch (err) {
    console.error(err?.message || String(err));
    process.exit(1);
  }
}
