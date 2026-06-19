/**
 * economy-governance.mjs — Governance entry point for Economy Runtime
 * (WF0020, CDK-264 ECON-11).
 *
 * Public surface (re-exported from economy-governance-core.mjs):
 *   resolveEconomyFlags(cfg)            — merge FLAG_DEFAULTS ← cfg.economy
 *   rolloutGate(flags, featureKey)      — advisory boolean gate; fail-open
 *   measureBeforeAfter({ before, after }) — delta measurement; never fabricates
 *   loadUsageWindow(root, sinceMs)      — fail-open EACP store reader
 *
 * Own export:
 *   econCheckGovernance(root)           — CI self-check suite → {name,pass,detail}[]
 *
 * `economy.*` config shape (FLAG_DEFAULTS = the default layer):
 *   {
 *     enabled        : boolean           — master switch; default true
 *     mode           : 'advisory'        — ALWAYS 'advisory' by default;
 *                                          'blocking' must be set explicitly
 *     output         : { ... }           — ECON-01 output-contract overrides
 *     compaction     : { enabled:bool }  — ECON-04
 *     contextProfiles: { enabled:bool }  — ECON-05
 *     resumePack     : { enabled:bool }  — ECON-06
 *     measurement    : { enabled:bool }  — ECON-11 (this card)
 *   }
 *
 * Split rationale: pure logic (flag resolution, gate, measurement, store reader)
 * lives in economy-governance-core.mjs to keep both files within the 308-line
 * constitution ceiling (§1 +10% tolerance).
 *
 * Advisory + fail-open contract: no export throws on bad input.
 * UNREGISTERED: no hook or boot wiring in Phase 1.
 * Zero runtime dependencies — node:* only.
 */

export {
  FLAG_DEFAULTS,
  resolveEconomyFlags,
  rolloutGate,
  measureBeforeAfter,
  loadUsageWindow,
} from './economy-governance-core.mjs';

import {
  resolveEconomyFlags,
  rolloutGate,
  measureBeforeAfter,
} from './economy-governance-core.mjs';
import { ECONOMY_MODULE_KEYS } from './economy-defaults.mjs';

// ---------------------------------------------------------------------------
// CI check export
// ---------------------------------------------------------------------------

/**
 * Self-check suite for economy-governance.mjs.
 * Pure and fail-open: each assertion is caught individually; a thrown error
 * becomes a failed check, not an unhandled rejection.
 * Called by the wave selfcheck runner with the repo root path.
 *
 * Checks:
 *   1. resolveEconomyFlags({}) → mode === 'advisory' (default-safe)
 *   2. rolloutGate on a missing flag key → false, no throw
 *   3. rolloutGate on null flags → false, no throw
 *   4. measureBeforeAfter with empty before → measured:false, note:'unmeasured'
 *   5. measureBeforeAfter with null before → measured:false, savedTokens null
 *   6. measureBeforeAfter real pair → correct savedTokens + savedPct
 *   7. measureBeforeAfter regression → negative savedTokens, measured:true
 *   8. resolveEconomyFlags mode:'blocking' → mode === 'blocking'
 *   9. rolloutGate respects master enabled:false
 *
 * @param {string} _root - Repo root path (unused; present for runner signature)
 * @returns {{ name: string, pass: boolean, detail: string }[]}
 */
export function econCheckGovernance(_root) {
  const checks = [];

  /** @param {string} name @param {()=>void} fn */
  function check(name, fn) {
    try {
      fn();
      checks.push({ name, pass: true, detail: 'ok' });
    } catch (err) {
      checks.push({ name, pass: false, detail: err?.message ?? String(err) });
    }
  }

  /** @param {boolean} cond @param {string} msg */
  function assert(cond, msg) {
    if (!cond) throw new Error(msg);
  }

  check('resolveEconomyFlags({}) defaults to advisory mode', () => {
    const flags = resolveEconomyFlags({});
    assert(flags.mode === 'advisory', `expected mode 'advisory', got '${flags.mode}'`);
    assert(flags.enabled === true, 'expected enabled:true by default');
  });

  check('rolloutGate on unknown feature key → false, no throw', () => {
    const flags  = resolveEconomyFlags({});
    const result = rolloutGate(flags, 'nonExistentFeatureXYZ');
    assert(result === false, `expected false for unknown key, got ${result}`);
  });

  check('rolloutGate on null flags → false, no throw', () => {
    const result = rolloutGate(null, 'compaction');
    assert(result === false, `expected false for null flags, got ${result}`);
  });

  check('measureBeforeAfter empty before → measured:false, note:unmeasured', () => {
    const res = measureBeforeAfter({ before: [], after: [{ total: 500 }] });
    assert(res.measured    === false,      `expected measured:false, got ${res.measured}`);
    assert(res.savedTokens === null,       `expected savedTokens:null, got ${res.savedTokens}`);
    assert(res.note        === 'unmeasured', `expected note:'unmeasured', got '${res.note}'`);
  });

  check('measureBeforeAfter null before → measured:false (NOT 0 savings)', () => {
    const res = measureBeforeAfter({ before: null, after: [{ total: 100 }] });
    assert(res.measured    === false, 'expected measured:false for null before');
    assert(res.savedTokens === null,  'must not fabricate savedTokens when unmeasured');
  });

  check('measureBeforeAfter real pair → correct savedTokens + savedPct', () => {
    const before = [{ total: 1000 }, { total: 500 }]; // 1500 total
    const after  = [{ total: 900 }];                   // 900 total
    const res    = measureBeforeAfter({ before, after });
    assert(res.measured    === true, 'expected measured:true');
    assert(res.savedTokens === 600,  `expected savedTokens 600, got ${res.savedTokens}`);
    assert(res.savedPct    === 40,   `expected savedPct 40, got ${res.savedPct}`);
  });

  check('measureBeforeAfter negative saving reported faithfully', () => {
    const res = measureBeforeAfter({ before: [{ total: 500 }], after: [{ total: 800 }] });
    assert(res.measured    === true, 'expected measured:true even for regression');
    assert(res.savedTokens === -300, `expected -300, got ${res.savedTokens}`);
  });

  check('resolveEconomyFlags mode:blocking → mode === blocking', () => {
    const flags = resolveEconomyFlags({ economy: { mode: 'blocking' } });
    assert(flags.mode === 'blocking', `expected 'blocking', got '${flags.mode}'`);
  });

  check('rolloutGate respects master enabled:false', () => {
    const flags  = resolveEconomyFlags({
      economy: { enabled: false, compaction: { enabled: true } },
    });
    const result = rolloutGate(flags, 'compaction');
    assert(result === false, 'master enabled:false must gate all sub-features');
  });

  // ADR-0103 activation go-live: every wired module is ON by default (advisory).
  check('ADR-0103: all wired modules default ON (advisory go-live)', () => {
    const flags = resolveEconomyFlags({});
    for (const key of ECONOMY_MODULE_KEYS) {
      assert(rolloutGate(flags, key) === true,
        `module '${key}' must default enabled:true at go-live, got ${rolloutGate(flags, key)}`);
    }
  });

  // Each module remains individually opt-out-able via config (user can disable one).
  check('ADR-0103: a single module can be disabled without affecting others', () => {
    const flags = resolveEconomyFlags({ economy: { loopBreaker: { enabled: false } } });
    assert(rolloutGate(flags, 'loopBreaker') === false,
      'loopBreaker explicitly disabled must gate to false');
    assert(rolloutGate(flags, 'patchEconomy') === true,
      'disabling one module must NOT disable the others');
  });

  return checks;
}
