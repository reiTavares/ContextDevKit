/**
 * boot-delta.mjs — Boot-section delta computation for Economy Runtime (ECON-06, WF0020).
 *
 * WHY this exists: the boot banner prints both mandatory governance blocks
 * (Process rules) and optional informational sections (drift, last-session,
 * unreleased, squads…). Paying the token cost for an UNCHANGED optional section
 * every boot is wasteful. This module gates optional sections to "changed since
 * last session" so only novel content reaches the context window — while ALWAYS
 * keeping Process rules (cheapest governance per token; trimming them risks drift).
 *
 * Design constraints:
 *   - ALWAYS_KEEP: sections that survive regardless of changedKeys.
 *   - kind:'rule' sections are treated identically to ALWAYS_KEEP entries.
 *   - Fail-open: missing last-snapshot → ALL keys count as changed (full boot).
 *   - Pure, deterministic — no I/O. Hashing helper uses node:crypto.
 *   - Advisory + UNREGISTERED (Phase 1) — activation deferred, no hook wiring.
 *
 * Cohesion note: pure computation only; boot-banner.mjs owns rendering.
 * Zero runtime dependencies — node:* only.
 */

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/**
 * Section keys that are NEVER gated out, regardless of changedKeys.
 * 'process-rules' maps to the mandatory governance block in boot-banner.mjs
 * (lines 201-208: "## ⚠️ Process rules").
 *
 * @type {readonly string[]}
 */
export const ALWAYS_KEEP = Object.freeze(['process-rules']);

// ---------------------------------------------------------------------------
// gateOptionalSections
// ---------------------------------------------------------------------------

/**
 * Filter a boot section list to only the sections that should appear this boot.
 *
 * Keep criteria (OR — any one retains the section):
 *   1. key is in ALWAYS_KEEP.
 *   2. kind === 'rule' (governance invariant mirrors context-profiles).
 *   3. key is in changedKeys (content changed since last boot).
 *
 * @param {Array<{key: string, kind: string, body: string|null}>} sections
 * @param {Set<string>|string[]} changedKeys
 * @returns {Array<{key: string, kind: string, body: string|null}>}
 */
export function gateOptionalSections(sections, changedKeys) {
  const changedSet =
    changedKeys instanceof Set ? changedKeys : new Set(changedKeys ?? []);
  const alwaysSet = new Set(ALWAYS_KEEP);

  return sections.filter((section) => {
    if (alwaysSet.has(section.key)) return true;
    if (section.kind === 'rule') return true;
    return changedSet.has(section.key);
  });
}

// ---------------------------------------------------------------------------
// changedSince
// ---------------------------------------------------------------------------

/**
 * Diff two `{key → contentHash}` snapshots; return keys whose hash changed or are new.
 * Build hashes with `hashBody()`. Defensive: null/non-object input treated as `{}`.
 *
 * @param {Record<string, string>} prevSnapshot
 * @param {Record<string, string>} curSnapshot
 * @returns {Set<string>}
 */
export function changedSince(prevSnapshot, curSnapshot) {
  const prev = (prevSnapshot && typeof prevSnapshot === 'object') ? prevSnapshot : {};
  const cur  = (curSnapshot  && typeof curSnapshot  === 'object') ? curSnapshot  : {};

  const changed = new Set();
  for (const key of Object.keys(cur)) {
    if (prev[key] !== cur[key]) {
      changed.add(key);
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// hashBody (helper — exported for callers building snapshots)
// ---------------------------------------------------------------------------

/**
 * Compute a stable SHA-256 hex digest for a section body string.
 * Normalises null/undefined to empty string so absent bodies hash consistently.
 *
 * @param {string|null|undefined} body
 * @returns {string} 64-char hex digest.
 */
export function hashBody(body) {
  return createHash('sha256').update(body ?? '').digest('hex');
}

// ---------------------------------------------------------------------------
// computeBootDelta
// ---------------------------------------------------------------------------

/**
 * Compute which keys changed between the last boot snapshot and the current key set.
 *
 * Fail-open: if `lastSnapshotKeys` is absent, null, or empty, ALL currentKeys are
 * returned as changed — the session gets a full boot (never a false-negative).
 *
 * @param {string} root
 *   Project root (reserved for future I/O extension; unused in Phase 1).
 * @param {{
 *   lastSnapshotKeys?: string[]|null,
 *   currentKeys?: string[]
 * }} [options]
 * @returns {{ changed: string[], unchanged: string[], alwaysKept: string[] }}
 *   `changed`   — keys that changed or are new (will appear in the banner).
 *   `unchanged` — keys with no change (gated out of the banner).
 *   `alwaysKept`— keys retained by ALWAYS_KEEP / rule-kind logic (subset of changed
 *                 for reporting purposes; they would appear even if unchanged).
 */
export function computeBootDelta(root, { lastSnapshotKeys, currentKeys } = {}) {
  const current = Array.isArray(currentKeys) ? currentKeys : [];
  const alwaysSet = new Set(ALWAYS_KEEP);

  // Fail-open: no previous snapshot → full boot (all keys treated as changed).
  const hasPrev =
    Array.isArray(lastSnapshotKeys) && lastSnapshotKeys.length > 0;

  if (!hasPrev) {
    return {
      changed:    [...current],
      unchanged:  [],
      alwaysKept: current.filter((k) => alwaysSet.has(k)),
    };
  }

  const prevSet = new Set(lastSnapshotKeys);
  const changed    = [];
  const unchanged  = [];
  const alwaysKept = [];

  for (const key of current) {
    const isAlways = alwaysSet.has(key);
    const isNew    = !prevSet.has(key);

    if (isAlways) {
      alwaysKept.push(key);
      // Count as changed so the banner includes it (governance invariant).
      changed.push(key);
    } else if (isNew) {
      changed.push(key);
    } else {
      unchanged.push(key);
    }
  }

  return { changed, unchanged, alwaysKept };
}

// ---------------------------------------------------------------------------
// CI check export
// ---------------------------------------------------------------------------

/**
 * Assert boot-delta invariants.
 * Called from selfcheck infrastructure — no direct runner.
 *
 * Invariants verified:
 *   A. A kind:'rule' section SURVIVES gateOptionalSections even when absent
 *      from changedKeys.
 *   B. An unchanged optional section (non-rule, not in changedKeys) is gated OUT.
 *   C. computeBootDelta with no last-snapshot returns ALL currentKeys as changed
 *      (graceful full boot).
 *   D. changedSince detects a flipped hash and a new key.
 *
 * @param {string} root — repo / kit root (reserved; unused in Phase 1).
 * @returns {Promise<Array<{name: string, pass: boolean, detail: string}>>}
 */
export async function econCheckBootDelta(root) {
  const results = [];

  /** @param {string} name @param {boolean} pass @param {string} [detail] */
  const assert = (name, pass, detail = '') => results.push({ name, pass, detail });

  // ---- Fixture: mixed section list ----
  /** @type {Array<{key:string,kind:string,body:string|null}>} */
  const sections = [
    { key: 'process-rules', kind: 'rule',     body: '1. Read SESSIONS\n2. Use /new-adr' },
    { key: 'drift',         kind: 'optional',  body: '3 files changed.' },
    { key: 'last-session',  kind: 'session',   body: 'Merged PR #96.' },
    { key: 'squads',        kind: 'optional',  body: 'devteam, qa.' },
  ];

  // ---- A: kind:'rule' survives even when NOT in changedKeys ----
  const noChanges = new Set(); // nothing changed
  const filteredA = gateOptionalSections(sections, noChanges);
  const ruleKept = filteredA.some((s) => s.kind === 'rule');
  assert(
    'rule-kind-survives-empty-changedKeys',
    ruleKept,
    ruleKept
      ? 'rule section present after gate with empty changedKeys'
      : 'rule section was wrongly dropped'
  );

  // ---- A2: process-rules key survives (ALWAYS_KEEP) even when not in changedKeys ----
  const processKept = filteredA.some((s) => s.key === 'process-rules');
  assert(
    'process-rules-always-kept',
    processKept,
    processKept
      ? 'process-rules present (ALWAYS_KEEP)'
      : 'process-rules was dropped — ALWAYS_KEEP invariant violated'
  );

  // ---- B: unchanged optional section is gated OUT ----
  // 'drift' and 'squads' are optional, not in ALWAYS_KEEP, not kind:'rule'.
  // When changedKeys is empty → only rule-kind / ALWAYS_KEEP sections survive.
  const driftKept  = filteredA.some((s) => s.key === 'drift');
  const squadsKept = filteredA.some((s) => s.key === 'squads');
  assert(
    'unchanged-optional-drift-gated-out',
    !driftKept,
    !driftKept ? 'drift absent (correct)' : 'drift was incorrectly retained'
  );
  assert(
    'unchanged-optional-squads-gated-out',
    !squadsKept,
    !squadsKept ? 'squads absent (correct)' : 'squads was incorrectly retained'
  );

  // ---- B2: changed optional section IS kept ----
  const changedOne = new Set(['drift']);
  const filteredB2 = gateOptionalSections(sections, changedOne);
  const driftRetained = filteredB2.some((s) => s.key === 'drift');
  assert(
    'changed-optional-drift-retained',
    driftRetained,
    driftRetained ? 'drift kept (in changedKeys)' : 'drift dropped despite being in changedKeys'
  );

  // ---- C: computeBootDelta with no last-snapshot → full boot ----
  const allKeys = ['process-rules', 'drift', 'last-session', 'squads'];
  const deltaC = computeBootDelta('', { lastSnapshotKeys: null, currentKeys: allKeys });
  const allChanged = deltaC.changed.length === allKeys.length && deltaC.unchanged.length === 0;
  assert(
    'no-last-snapshot-full-boot',
    allChanged,
    allChanged
      ? `all ${allKeys.length} keys changed (graceful full boot)`
      : `changed=${deltaC.changed.length} unchanged=${deltaC.unchanged.length} — expected all ${allKeys.length} changed`
  );

  // ---- C2: computeBootDelta with empty lastSnapshotKeys → full boot ----
  const deltaC2 = computeBootDelta('', { lastSnapshotKeys: [], currentKeys: allKeys });
  const allChangedC2 = deltaC2.changed.length === allKeys.length;
  assert(
    'empty-last-snapshot-full-boot',
    allChangedC2,
    allChangedC2
      ? 'empty lastSnapshotKeys → full boot (correct)'
      : `only ${deltaC2.changed.length}/${allKeys.length} keys changed`
  );

  // ---- D: changedSince detects flipped hash and new key ----
  const prev = {
    'process-rules': hashBody('old process rules text'),
    'drift':         hashBody('no changes yesterday'),
  };
  const cur = {
    'process-rules': hashBody('old process rules text'), // unchanged
    'drift':         hashBody('3 files changed TODAY'),  // flipped
    'last-session':  hashBody('new session entry'),      // new key
  };
  const diffSet = changedSince(prev, cur);

  assert(
    'changedSince-detects-flipped-hash',
    diffSet.has('drift'),
    diffSet.has('drift') ? 'drift detected as changed' : 'drift not detected despite hash change'
  );
  assert(
    'changedSince-detects-new-key',
    diffSet.has('last-session'),
    diffSet.has('last-session') ? 'last-session detected as new key' : 'last-session not detected'
  );
  assert(
    'changedSince-unchanged-key-absent',
    !diffSet.has('process-rules'),
    !diffSet.has('process-rules')
      ? 'process-rules correctly absent from diff'
      : 'process-rules wrongly flagged as changed'
  );

  return results;
}
