/**
 * boot-delta-gate.mjs — wires ECON-06 boot-delta (#259) into the SessionStart
 * banner (ADR-0103 activation go-live).
 *
 * STRATEGY (lowest-risk): the boot banner is rendered from a `boot` signal
 * bundle whose optional fields each have an `if (boot.X)` guard in
 * boot-banner.mjs. Rather than refactor the imperative renderer, this gate nulls
 * the *informational* fields whose content is UNCHANGED since the last boot, so
 * the renderer simply omits them — saving the tokens of re-printing identical
 * "residual context" every session. Mandatory governance (Process rules), the
 * drift warning, and all time-sensitive due-nudges are NEVER gated.
 *
 * SAFETY (immutable rule 2 + ADR-0103): fully fail-open — any error, a missing
 * snapshot, or `economy.bootDelta` off returns the bundle UNCHANGED (full boot).
 * Never a false-negative: an absent/unreadable snapshot ⇒ everything kept.
 *
 * Snapshot: a `{ key → contentHash }` map persisted under the session dir
 * (`<LEDGER_DIR>/.boot-snapshot.json`, gitignored, per-worktree). I/O is injected
 * (`io`) so the self-check runs without touching disk.
 *
 * Zero runtime dependencies — node:* only.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { resolveEconomyFlags, rolloutGate } from './economy-governance.mjs';
import { hashBody, changedSince } from './boot-delta.mjs';
import { LEDGER_DIR } from '../../../runtime/config/paths.mjs';

/**
 * Informational boot fields safe to gate when unchanged. Each is purely
 * re-readable context (not a warning or a time-sensitive nudge) and is guarded
 * by `if (boot.X)` in boot-banner.mjs, so nulling it omits the section cleanly.
 *
 * @type {readonly string[]}
 */
export const GATEABLE_BOOT_FIELDS = Object.freeze([
  'latest',        // last registered session digest
  'unreleased',    // CHANGELOG [Unreleased]
  'workspace',     // active workspace claims
  'branches',      // other active branches
  'value',         // value line
  'squadContext',  // active squad postures
]);

/** Default fs-backed snapshot I/O. */
const DEFAULT_IO = {
  read: (path) => readFileSync(path, 'utf-8'),
  write: (path, content) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); },
};

/** Stable content hash for a string-or-object boot field. */
function fieldHash(value) {
  return hashBody(typeof value === 'string' ? value : JSON.stringify(value));
}

/**
 * Returns a copy of the boot bundle with unchanged informational fields nulled,
 * and persists the current snapshot. Fail-open: returns the input unchanged on
 * any problem or when the feature is off.
 *
 * @param {Record<string, any>} boot - the signal bundle for renderBootBanner
 * @param {{ root: string, config: any, io?: { read:(p:string)=>string, write:(p:string,c:string)=>void } }} ctx
 * @returns {Record<string, any>}
 */
export function applyBootDeltaGate(boot, { root, config, io = DEFAULT_IO } = {}) {
  try {
    if (!boot || typeof boot !== 'object') return boot;
    if (!rolloutGate(resolveEconomyFlags(config), 'bootDelta')) return boot;

    // Current hashes for the gateable fields that are actually present.
    const cur = {};
    for (const key of GATEABLE_BOOT_FIELDS) {
      if (boot[key]) cur[key] = fieldHash(boot[key]);
    }

    const snapPath = resolve(root, LEDGER_DIR, '.boot-snapshot.json');
    let prev = {};
    try {
      const parsed = JSON.parse(io.read(snapPath));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) prev = parsed;
    } catch { prev = {}; } // missing/corrupt snapshot → full boot (never a false-negative)

    const changed = changedSince(prev, cur); // keys new or with a flipped hash
    const gated = { ...boot };
    for (const key of GATEABLE_BOOT_FIELDS) {
      // Gate out ONLY when present, unchanged, and seen in the prior snapshot.
      if (cur[key] && !changed.has(key) && Object.prototype.hasOwnProperty.call(prev, key)) {
        gated[key] = null; // renderer's `if (boot.X)` guard omits it
      }
    }

    try { io.write(snapPath, JSON.stringify(cur, null, 2)); } catch { /* best-effort persist */ }
    return gated;
  } catch {
    return boot; // fail-open: a broken gate never changes the boot banner
  }
}

/**
 * Self-check suite for boot-delta-gate.mjs. Pure + fail-open; injects a fake
 * snapshot store so no disk is touched.
 *
 * @param {string} _root - repo root (unused; runner signature parity)
 * @returns {Promise<{ name: string, pass: boolean, detail: string }[]>}
 */
export async function econCheckBootDeltaGate(_root) {
  const checks = [];
  const run = (name, fn) => {
    try { fn(); checks.push({ name, pass: true, detail: 'ok' }); }
    catch (err) { checks.push({ name, pass: false, detail: err?.message ?? String(err) }); }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

  const sampleBoot = () => ({
    level: 7, branch: 'main',                    // mandatory-ish, never gated
    drift: [{ sessionId: 'x' }],                 // warning, never gated
    latest: { content: 'Session 1', mode: 'digest' },
    unreleased: 'Added 3',
    value: 'value line',
    workspace: 'claim a',
  });

  // A throwaway in-memory snapshot store for the fake io.
  let store = null;
  const io = { read: () => { if (store == null) throw new Error('no snapshot'); return store; },
               write: (_p, c) => { store = c; } };

  // 1. No snapshot → full boot (nothing gated), snapshot persisted.
  run('no snapshot → full boot (all fields kept)', () => {
    store = null;
    const out = applyBootDeltaGate(sampleBoot(), { root: '/x', config: {}, io });
    assert(out.latest && out.unreleased && out.value && out.workspace, 'all informational fields kept on first boot');
    assert(store !== null, 'snapshot persisted after first boot');
  });

  // 2. Identical second boot → unchanged informational fields gated OUT; drift kept.
  run('unchanged second boot → informational fields gated, drift kept', () => {
    store = null;
    applyBootDeltaGate(sampleBoot(), { root: '/x', config: {}, io }); // seeds snapshot
    const out = applyBootDeltaGate(sampleBoot(), { root: '/x', config: {}, io });
    assert(out.latest === null && out.unreleased === null && out.value === null && out.workspace === null,
      'unchanged informational fields must be nulled');
    assert(Array.isArray(out.drift) && out.drift.length === 1, 'drift (a warning) is NEVER gated');
  });

  // 3. A changed field survives; an unchanged sibling is still gated.
  run('changed field kept; unchanged sibling gated', () => {
    store = null;
    applyBootDeltaGate(sampleBoot(), { root: '/x', config: {}, io });
    const boot2 = sampleBoot(); boot2.unreleased = 'Added 7'; // changed
    const out = applyBootDeltaGate(boot2, { root: '/x', config: {}, io });
    assert(out.unreleased === 'Added 7', 'changed field must survive');
    assert(out.value === null, 'unchanged sibling must still be gated');
  });

  // 4. bootDelta disabled → bundle unchanged even on an identical boot.
  run('economy.bootDelta disabled → no gating', () => {
    store = null;
    const cfg = { economy: { bootDelta: { enabled: false } } };
    applyBootDeltaGate(sampleBoot(), { root: '/x', config: cfg, io });
    const out = applyBootDeltaGate(sampleBoot(), { root: '/x', config: cfg, io });
    assert(out.latest && out.unreleased, 'disabled bootDelta must keep every field');
  });

  // 5. fail-open: a throwing write never propagates.
  run('throwing io.write → fail-open (returns a bundle, never throws)', () => {
    const boom = { read: () => { throw new Error('x'); }, write: () => { throw new Error('disk full'); } };
    const out = applyBootDeltaGate(sampleBoot(), { root: '/x', config: {}, io: boom });
    assert(out && out.latest, 'fail-open returns the full bundle on I/O error');
  });

  return checks;
}
