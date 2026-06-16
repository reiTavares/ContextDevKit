/**
 * economy-governance-core.mjs — Pure logic for governance flags, rollout gate,
 * and before/after measurement (WF0020, CDK-264 ECON-11).
 *
 * WHY split from economy-governance.mjs: the CI check export + JSDoc in the
 * orchestrating file would breach the 308-line constitution ceiling (§1 +10%).
 * Splitting pure domain logic here keeps both files within budget while
 * preserving a clean seam: callers that need only the flag/gate/measurement
 * logic import from this file; the CI check lives in economy-governance.mjs.
 *
 * Exports consumed by economy-governance.mjs:
 *   FLAG_DEFAULTS, resolveEconomyFlags, rolloutGate,
 *   measureBeforeAfter, loadUsageWindow
 *
 * Advisory + fail-open: no export throws on bad input — see each function's
 * JSDoc for its specific fail-open guarantee.
 *
 * Zero runtime dependencies — node:* only.
 */

import { readFile, readdir } from 'node:fs/promises';
import { resolve, join }     from 'node:path';
import { ECONOMY_DEFAULTS }  from './economy-defaults.mjs';

// ---------------------------------------------------------------------------
// Default governance flags
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} EconomyFeatureFlags
 * @property {boolean} enabled         - Master switch for Economy Runtime
 * @property {'advisory'|'blocking'}  mode - Execution mode; always 'advisory' by default
 * @property {Object} output           - Output contract overrides (ECON-01 owns schema)
 * @property {{ enabled: boolean }} compaction      - ECON-04 compaction runner flag
 * @property {{ enabled: boolean }} contextProfiles - ECON-05 context profiles flag
 * @property {{ enabled: boolean }} resumePack      - ECON-06 resume-pack flag
 * @property {{ enabled: boolean }} measurement     - ECON-11 governance measurement flag
 */

/** @type {EconomyFeatureFlags} */
export const FLAG_DEFAULTS = Object.freeze({
  enabled:         true,
  mode:            'advisory',
  output:          ECONOMY_DEFAULTS.output,
  compaction:      Object.freeze({ enabled: false }),
  contextProfiles: Object.freeze({ enabled: false }),
  resumePack:      Object.freeze({ enabled: false }),
  measurement:     Object.freeze({ enabled: false }),
});

// ---------------------------------------------------------------------------
// resolveEconomyFlags
// ---------------------------------------------------------------------------

/**
 * Merges FLAG_DEFAULTS with the caller-supplied config's `economy` block.
 * Returns the fully resolved, default-safe flags.
 *
 * Fail-open: missing or non-object cfg → defaults applied for every key.
 * mode: any value that is not exactly 'blocking' resolves to 'advisory'.
 * Sub-feature objects are shallow-merged so partial config extends the default.
 *
 * @param {object|null|undefined} cfg - Full ContextDevKit config (cfg.economy is used)
 * @returns {EconomyFeatureFlags}
 */
export function resolveEconomyFlags(cfg) {
  const econCfg = (cfg && typeof cfg === 'object' && !Array.isArray(cfg))
    ? (cfg.economy && typeof cfg.economy === 'object' ? cfg.economy : {})
    : {};

  const resolvedMode = econCfg.mode === 'blocking' ? 'blocking' : 'advisory';

  const mergeSubFeature = (key) => {
    const defVal = FLAG_DEFAULTS[key];
    const cfgVal = econCfg[key];
    if (cfgVal && typeof cfgVal === 'object' && !Array.isArray(cfgVal)) {
      return Object.freeze({ ...defVal, ...cfgVal });
    }
    return defVal;
  };

  return {
    enabled:
      typeof econCfg.enabled === 'boolean' ? econCfg.enabled : FLAG_DEFAULTS.enabled,
    mode: resolvedMode,
    output:
      econCfg.output && typeof econCfg.output === 'object'
        ? econCfg.output
        : FLAG_DEFAULTS.output,
    compaction:      mergeSubFeature('compaction'),
    contextProfiles: mergeSubFeature('contextProfiles'),
    resumePack:      mergeSubFeature('resumePack'),
    measurement:     mergeSubFeature('measurement'),
  };
}

// ---------------------------------------------------------------------------
// rolloutGate
// ---------------------------------------------------------------------------

/**
 * Advisory boolean gate: is a named Economy Runtime feature active?
 *
 * Fail-open: unknown feature key, missing flags, or any unexpected type → false.
 * NEVER throws; NEVER blocks real work.
 * Master `enabled:false` gates every sub-feature regardless of its own flag.
 *
 * @param {EconomyFeatureFlags|null|undefined} flags
 * @param {string} featureKey - Sub-feature key (e.g. 'compaction', 'measurement')
 * @returns {boolean}
 */
export function rolloutGate(flags, featureKey) {
  try {
    if (!flags || typeof flags !== 'object') return false;
    if (flags.enabled === false)             return false;
    const feature = flags[featureKey];
    if (!feature || typeof feature !== 'object') return false;
    return feature.enabled === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// measureBeforeAfter
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} MeasurementResult
 * @property {boolean}       measured    - False when either side is absent/empty
 * @property {number|null}   savedTokens - Positive = saving; negative = regression; null = unmeasured
 * @property {number|null}   savedPct    - Percentage saved; null when unmeasured
 * @property {string}        [note]      - Human note when unmeasured or edge case
 */

/**
 * Computes a before/after token delta from two event lists.
 *
 * Constitution §8 (refuse-by-default): if either side is missing, null, or
 * empty → `{ measured:false, note:'unmeasured' }`. NEVER fabricates a saving.
 * Negative savings are reported faithfully (a regression is real data).
 * Tokens rounded to nearest integer.
 *
 * @param {{ before: Array<{total:number}>|null|undefined,
 *            after:  Array<{total:number}>|null|undefined }} param0
 * @returns {MeasurementResult}
 */
export function measureBeforeAfter({ before, after } = {}) {
  const sumTokens = (events) => {
    if (!Array.isArray(events) || events.length === 0) return null;
    let acc = 0;
    for (const ev of events) {
      const t = ev && typeof ev.total === 'number' && isFinite(ev.total) ? ev.total : 0;
      acc += t;
    }
    return acc;
  };

  const beforeTotal = sumTokens(before);
  const afterTotal  = sumTokens(after);

  if (beforeTotal === null || afterTotal === null) {
    return { measured: false, savedTokens: null, savedPct: null, note: 'unmeasured' };
  }

  if (beforeTotal === 0) {
    return {
      measured:    true,
      savedTokens: 0,
      savedPct:    null,
      note:        'before-total is zero; percentage undefined',
    };
  }

  const savedTokens = Math.round(beforeTotal - afterTotal);
  const savedPct    = Math.round(((beforeTotal - afterTotal) / beforeTotal) * 10000) / 100;

  return { measured: true, savedTokens, savedPct };
}

// ---------------------------------------------------------------------------
// loadUsageWindow
// ---------------------------------------------------------------------------

/**
 * Fail-open reader over the EACP usage store.
 * Scans `<root>/contextkit/memory/economics/` for *.json files modified within
 * the sinceMs window and returns the parsed events (objects with `total`).
 *
 * Missing store, missing root, or any I/O error → returns [] (never throws).
 *
 * @param {string} root        - Repository root path
 * @param {number} [sinceMs=0] - Unix ms lower bound (inclusive); 0 = all files
 * @returns {Promise<Array<{total:number}>>}
 */
export async function loadUsageWindow(root, sinceMs = 0) {
  if (!root || typeof root !== 'string') return [];
  try {
    const storeDir = join(root, 'contextkit', 'memory', 'economics');
    let entries;
    try {
      entries = await readdir(storeDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const results = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const filePath = resolve(storeDir, entry.name);
      try {
        const raw  = await readFile(filePath, 'utf-8');
        const data = JSON.parse(raw.replace(/^﻿/, '')); // strip BOM (constitution §4)
        const events = Array.isArray(data) ? data : [data];
        for (const ev of events) {
          if (
            ev && typeof ev === 'object' &&
            typeof ev.total === 'number' &&
            isFinite(ev.total) &&
            (sinceMs === 0 || (typeof ev.ts === 'number' && ev.ts >= sinceMs))
          ) {
            results.push(ev);
          }
        }
      } catch {
        // Malformed or unreadable file → skip (advisory, not fatal)
      }
    }
    return results;
  } catch {
    return [];
  }
}
