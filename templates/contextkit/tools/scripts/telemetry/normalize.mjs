#!/usr/bin/env node
/**
 * Host-adapter dispatch registry — CDK-062, PKG-06 multi-host telemetry.
 *
 * WHY this module exists: as ContextDevKit adds native-host support (claude-code,
 * codex, cursor, vscode, …) each host exposes token usage in a different shape.
 * This registry normalizes raw per-host entries into the canonical UsageEvent
 * defined by the EACP layer (ADR-0078), so every downstream consumer (attribution
 * lenses, cost projections, budget gates) operates on a single, typed record.
 *
 * Design decisions:
 *   - Adapters are IMPORTED (never forked) from their canonical homes. The
 *     economics/ adapters live under economics/adapters/ (EACP program). The
 *     codex adapter is PKG-06-owned and lives under telemetry/adapters/.
 *   - The registry is a plain Map keyed by host string. No reflection, no
 *     dynamic requires — the set of known hosts is explicit and auditable.
 *   - normalize() is fail-open: unknown host → null, usage-less entry → null,
 *     adapter error → null + stderr note. Never throws to the caller.
 *   - CLI: `node normalize.mjs hosts` / `node normalize.mjs declares` for
 *     quick operator inspection. Both exit 0 always.
 *
 * Immutable rule compliance:
 *   - Zero runtime dependencies (node:* only).
 *   - Imports resolved relative to import.meta.url — no 'contextkit/...' literals.
 *   - ≤ 308 lines (cohesion rationale: registry + dispatch + CLI are one cohesive unit).
 *
 * Zero runtime dependencies — plain Node.js ESM, node:* only.
 */

import { fileURLToPath } from 'node:url';
import { resolve, dirname }   from 'node:path';

// ---------------------------------------------------------------------------
// Adapter imports — resolved relative to THIS file, never by kit-absolute path
// ---------------------------------------------------------------------------

/** @type {URL} */
const __dir = dirname(fileURLToPath(import.meta.url));

// EACP-owned adapter (economics program — import-only, never edit that dir)
import * as claudeCodeAdapter from '../economics/adapters/claude-code.mjs';

// PKG-06-owned adapter
import * as codexAdapter from './adapters/codex.mjs';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Internal adapter map keyed by host string.
 * Shape of each value: `{ ADAPTER, declares, adapt }` — the named exports
 * of an adapter module.
 *
 * @type {Map<string, { ADAPTER: string, declares: () => object, adapt: (entry: object) => object|null }>}
 */
const REGISTRY = new Map([
  ['claude-code', claudeCodeAdapter],
  ['codex',       codexAdapter],
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the adapter module for the given host key, or null if the host
 * is not registered. Callers can use `declares()` to inspect capabilities
 * or `adapt(entry)` to produce a UsageEvent.
 *
 * @param {string} host - The host identifier (e.g. 'claude-code', 'codex')
 * @returns {{ ADAPTER: string, declares: () => object, adapt: (entry: object) => object|null }|null}
 */
export function adapterFor(host) {
  if (typeof host !== 'string') return null;
  return REGISTRY.get(host) ?? null;
}

/**
 * Returns the sorted list of registered host keys.
 *
 * @returns {string[]}
 */
export function registeredHosts() {
  return [...REGISTRY.keys()].sort();
}

/**
 * Normalizes a raw host-specific entry into a canonical UsageEvent.
 *
 * Fail-open contract (never throws to the caller):
 *   - Unknown or missing `rawEntry.host` → returns null.
 *   - No matching adapter → returns null.
 *   - Adapter returns null for usage-less entries → passes null through.
 *   - Adapter throws unexpectedly → logs to stderr, returns null.
 *
 * @param {{ host?: string, [key: string]: unknown }} rawEntry
 *   Raw transcript entry with at minimum a `host` field identifying the source.
 * @returns {import('../economics/usage-event.mjs').UsageEvent|null}
 *   Canonical UsageEvent on success; null when the entry cannot be normalized.
 */
export function normalize(rawEntry) {
  if (!rawEntry || typeof rawEntry !== 'object') return null;

  const adapter = adapterFor(rawEntry.host);
  if (!adapter) return null;

  try {
    return adapter.adapt(rawEntry);
  } catch (err) {
    // Defensive: adapters should return null on bad input, but we guard anyway.
    process.stderr.write(
      `[normalize] adapter '${rawEntry.host}' threw unexpectedly: ${err?.message ?? err}\n`,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// CLI — operator inspection (exit 0 always)
// ---------------------------------------------------------------------------

/**
 * Prints a newline-separated list of registered host keys, then exits 0.
 * Used by CI and human operators to confirm which adapters are wired.
 */
function cliHosts() {
  console.log(registeredHosts().join('\n'));
}

/**
 * Prints each registered adapter's capability descriptor as pretty JSON,
 * preceded by a host-key header, then exits 0. Used to inspect what each
 * host adapter claims to support (e.g. which buckets, confidence tier).
 */
function cliDeclares() {
  for (const host of registeredHosts()) {
    const adapter = adapterFor(host);
    console.log(`\n--- ${host} ---`);
    try {
      console.log(JSON.stringify(adapter.declares(), null, 2));
    } catch (err) {
      console.log(`(declares() threw: ${err?.message ?? err})`);
    }
  }
}

// Entry point guard — only run CLI when invoked directly.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const subcommand = process.argv[2];
  if (subcommand === 'hosts') {
    cliHosts();
  } else if (subcommand === 'declares') {
    cliDeclares();
  } else {
    console.log('Usage: node normalize.mjs <hosts|declares>');
  }
  process.exit(0);
}
