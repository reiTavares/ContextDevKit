/**
 * Shared bootstrap + helpers for integration-test-mcp-002-*.mjs sub-suites.
 *
 * Responsibilities (single): build the isolated temp tree, expose dynamic
 * imports of the three modules under test, and provide assertThrows helpers.
 * Each sub-suite imports what it needs and owns its own `finish()` call.
 *
 * @module integration-test-mcp-002-helpers
 */
import { mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { reporter, KIT } from './it-helpers.mjs';

// ---------------------------------------------------------------------------
// Public: reporter factory (re-exported so callers don't import it twice)
// ---------------------------------------------------------------------------
export { reporter, KIT };

// ---------------------------------------------------------------------------
// Public: temp-root layout constants (derived from KIT)
// ---------------------------------------------------------------------------
export const TEMPLATES = join(KIT, 'templates', 'contextkit');

/**
 * Build an isolated temp root with the template MCP tree copied in.
 * Returns the layout paths needed by the sub-suites.
 *
 * @returns {{ FAKE_ROOT: string, PLATFORM: string, MCP_DIR: string, PROFILES_DIR: string }}
 */
export function buildTempTree() {
  const FAKE_ROOT = join(tmpdir(), `mcp-002-it-${randomUUID()}`);
  const PLATFORM = join(FAKE_ROOT, 'contextkit');
  const MCP_DIR = join(PLATFORM, 'mcp');
  const PROFILES_DIR = join(MCP_DIR, 'profiles');

  copyDirSync(join(TEMPLATES, 'mcp'), MCP_DIR);
  copyDirSync(join(TEMPLATES, 'runtime', 'config'), join(PLATFORM, 'runtime', 'config'));
  copyDirSync(join(TEMPLATES, 'runtime', 'mcp'), join(PLATFORM, 'runtime', 'mcp'));

  return { FAKE_ROOT, PLATFORM, MCP_DIR, PROFILES_DIR };
}

/**
 * Recursively copy a directory tree.
 *
 * @param {string} src
 * @param {string} dst
 */
export function copyDirSync(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    const srcPath = join(src, name);
    const dstPath = join(dst, name);
    statSync(srcPath).isDirectory()
      ? copyDirSync(srcPath, dstPath)
      : copyFileSync(srcPath, dstPath);
  }
}

/**
 * Dynamically import the three MCP-002 modules from a given temp tree.
 * Uses pathToFileURL to avoid Node module-cache collisions across test runs.
 *
 * @param {string} PLATFORM - path to contextkit/ inside the temp root
 * @returns {Promise<{ loadRegistry, findEntry, readManifest, writeManifest, manifestPathFor, resolveProfile }>}
 */
export async function importMcpModules(PLATFORM) {
  const runtimeMcp = join(PLATFORM, 'runtime', 'mcp');

  const { loadRegistry, findEntry } = await import(
    pathToFileURL(join(runtimeMcp, 'registry.mjs')).href
  );
  const { readManifest, writeManifest, manifestPathFor } = await import(
    pathToFileURL(join(runtimeMcp, 'manifest.mjs')).href
  );
  const { resolveProfile } = await import(
    pathToFileURL(join(runtimeMcp, 'resolve-profile.mjs')).href
  );

  return { loadRegistry, findEntry, readManifest, writeManifest, manifestPathFor, resolveProfile };
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/**
 * Assert that a synchronous function throws an error optionally containing
 * a fragment in its message.
 *
 * @param {string} label
 * @param {Function} fn
 * @param {string} [fragment]
 * @param {{ ok: Function, bad: Function }} rep
 */
export function assertThrows(label, fn, fragment, rep) {
  try {
    fn();
    rep.bad(`${label} — expected throw but did not throw`);
  } catch (err) {
    const msg = err?.message ?? String(err);
    if (fragment && !msg.includes(fragment)) {
      rep.bad(`${label} — threw but wrong message (got: ${msg.slice(0, 120)})`);
    } else {
      rep.ok(label);
    }
  }
}

/**
 * Assert that an async function throws an error optionally containing
 * a fragment in its message.
 *
 * @param {string} label
 * @param {Function} fn
 * @param {string} [fragment]
 * @param {{ ok: Function, bad: Function }} rep
 * @returns {Promise<void>}
 */
export async function assertThrowsAsync(label, fn, fragment, rep) {
  try {
    await fn();
    rep.bad(`${label} — expected throw but did not throw`);
  } catch (err) {
    const msg = err?.message ?? String(err);
    if (fragment && !msg.includes(fragment)) {
      rep.bad(`${label} — threw but wrong message (got: ${msg.slice(0, 120)})`);
    } else {
      rep.ok(label);
    }
  }
}
