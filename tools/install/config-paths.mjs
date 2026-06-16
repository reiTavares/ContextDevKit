/**
 * Legacy-prefix config-path healing — P0 hotfix 3.0.1 (ADR-0095 errata).
 *
 * When the platform folder was renamed `vibekit/` → `contextkit/` (migrate.mjs
 * TOKENS), the `ledger.*` / `l5.highRiskPaths` / `qa.criticalPaths` STRINGS in
 * config.json kept pointing at the dead prefix. This heals exactly those — and
 * NOTHING else.
 *
 * The shipped v3.0.0 healer (engine.healPathList) was unbounded: it treated the
 * first segment of ANY missing path as a legacy prefix, accepted an empty suffix
 * (`dist/` → suffix `''` → `contextkit/`), and adopted the rewrite merely because
 * `contextkit/` exists on disk after install. Result: `src/`, `lib/`, `dist/`,
 * `build/`, `coverage/`, `node_modules/` all collapsed to duplicate `contextkit/`
 * entries (issue: "migrated N config path(s) onto contextkit/"). Root cause &
 * regression proof: tools/selfcheck-config-paths.mjs.
 *
 * The corrected healer is allowlist-gated (constitution §8 default-refuse): a path
 * migrates ONLY when its head is a KNOWN legacy platform prefix, the suffix is
 * non-empty, and the rewritten candidate actually resolves on disk. Everything
 * else — project paths, custom paths, globs, URLs, absolute paths, variables,
 * Windows paths — is returned verbatim, order preserved.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PLATFORM_DIR } from '../../templates/contextkit/runtime/config/paths.mjs';

/**
 * The ONLY platform-folder prefixes ever shipped, single-sourced from the rename
 * map in migrate.mjs (`['vibekit', 'contextkit']`). A first segment that is not
 * in this set is NEVER treated as a legacy prefix (constitution §8). Add an entry
 * only with real evidence from a prior tag / the migrate.mjs TOKENS / an ADR —
 * never invent an alias.
 * @type {ReadonlySet<string>}
 */
export const LEGACY_PLATFORM_PREFIXES = Object.freeze(new Set(['vibekit']));

/**
 * True when an entry is a relative, slash-bearing project path that the migrator
 * is even allowed to consider. Rejects everything the spec forbids touching:
 * single tokens, globs, URLs, POSIX/Windows absolute paths, backslash paths,
 * env-var / home references.
 * @param {*} entry candidate config entry
 * @returns {boolean}
 */
function isMigratableEntry(entry) {
  if (typeof entry !== 'string' || entry.length === 0) return false;
  if (!entry.includes('/')) return false; // single token, not a path
  if (/[*?{}[\]!]/.test(entry)) return false; // glob
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(entry)) return false; // URL scheme
  if (entry.startsWith('/')) return false; // POSIX absolute
  if (/^[A-Za-z]:[\\/]/.test(entry)) return false; // Windows absolute (C:\ or C:/)
  if (entry.includes('\\')) return false; // backslash path — not ours
  if (entry.includes('$') || entry.includes('%') || entry.includes('~')) return false; // variable / home
  return true;
}

/**
 * Heals one path list off a renamed platform dir. Pure (no I/O beyond existsSync
 * probes under `target`), order-preserving, idempotent, never produces duplicates
 * that were not already present.
 *
 * @param {string} target project root used to verify candidates resolve
 * @param {string[]|undefined} entries the path list to heal
 * @param {{n:number}} counter mutated with the number of rewrites
 * @returns {string[]|undefined} the healed list (returns the input untouched when not an array)
 */
export function healPathList(target, entries, counter) {
  if (!Array.isArray(entries)) return entries;
  return entries.map((entry) => {
    if (!isMigratableEntry(entry)) return entry;
    const slash = entry.indexOf('/');
    const head = entry.slice(0, slash);
    // Allowlist gate: only a KNOWN legacy platform prefix is ever migrated.
    if (!LEGACY_PLATFORM_PREFIXES.has(head)) return entry;
    const suffix = entry.slice(slash + 1);
    if (suffix.length === 0) return entry; // never an empty suffix → bare `contextkit/`
    if (existsSync(join(target, entry))) return entry; // legacy path still resolves — leave it
    const candidate = `${PLATFORM_DIR}/${suffix}`;
    if (!existsSync(join(target, candidate))) return entry; // can't verify target — don't guess
    counter.n += 1;
    return candidate;
  });
}

/**
 * Heals every renamed-dir entry across the path-bearing config lists in place.
 * @param {string} target project root
 * @param {object} cfg parsed config.json (mutated)
 * @returns {number} total rewrites applied
 */
export function migrateConfigPaths(target, cfg) {
  const counter = { n: 0 };
  if (cfg.ledger) {
    for (const key of ['registration', 'important', 'irrelevant']) {
      if (cfg.ledger[key]) cfg.ledger[key] = healPathList(target, cfg.ledger[key], counter);
    }
  }
  if (cfg.l5) cfg.l5.highRiskPaths = healPathList(target, cfg.l5.highRiskPaths, counter);
  if (cfg.qa) cfg.qa.criticalPaths = healPathList(target, cfg.qa.criticalPaths, counter);
  return counter.n;
}
