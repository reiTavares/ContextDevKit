/**
 * MCP-002 self-check orchestrator — wires the four per-suite files into a single
 * exported function consumed by tools/selfcheck.mjs.
 *
 * Suites:
 *   1. registry.mjs (loadRegistry / findEntry / curated seed / fail-fast)
 *   2. manifest.mjs (atomic write / BOM-strip / round-trip / secret rejection)
 *   3. resolve-profile.mjs (PROPOSAL contract / no silent write-mode enablement)
 *   4. manifest.schema.json (structure checks)
 *
 * @module selfcheck-mcp-002
 */
import { mkdirSync, rmSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { runMcp002RegistryChecks } from './selfcheck-mcp-002-registry.mjs';
import { runMcp002ManifestChecks } from './selfcheck-mcp-002-manifest.mjs';
import { runMcp002ProfileChecks } from './selfcheck-mcp-002-profiles.mjs';
import { runMcp002SchemaChecks } from './selfcheck-mcp-002-schema.mjs';

function copyDirSync(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    const s = join(src, name);
    const d = join(dst, name);
    statSync(s).isDirectory() ? copyDirSync(s, d) : copyFileSync(s, d);
  }
}

/**
 * Runs all four MCP-002 suites. Sets up and tears down a temp isolated root so
 * module imports resolve against the copied template tree, not the live install.
 *
 * @param {{ ok: Function, bad: Function }} rep
 * @param {{ KIT: string }} ctx
 */
export async function runMcp002Checks({ ok, bad }, { KIT }) {
  console.log('Checking MCP-002 (registry / manifest / profiles / schema)...');

  const TEMPLATES = join(KIT, 'templates', 'contextkit');
  const FAKE_ROOT = join(tmpdir(), `sc-mcp-002-${randomUUID()}`);
  const PLATFORM = join(FAKE_ROOT, 'contextkit');
  const MCP_DIR = join(PLATFORM, 'mcp');
  const PROFILES_DIR = join(MCP_DIR, 'profiles');
  const RUNTIME_MCP = join(PLATFORM, 'runtime', 'mcp');

  // Bootstrap: copy templates into an isolated temp root
  copyDirSync(join(TEMPLATES, 'mcp'), MCP_DIR);
  copyDirSync(join(TEMPLATES, 'runtime', 'config'), join(PLATFORM, 'runtime', 'config'));
  copyDirSync(join(TEMPLATES, 'runtime', 'mcp'), RUNTIME_MCP);

  // Dynamic imports against the copied tree (avoids module-cache collisions)
  let loadRegistry, findEntry, readManifest, writeManifest, manifestPathFor, resolveProfile;
  try {
    ({ loadRegistry, findEntry } = await import(pathToFileURL(join(RUNTIME_MCP, 'registry.mjs')).href));
    ({ readManifest, writeManifest, manifestPathFor } = await import(pathToFileURL(join(RUNTIME_MCP, 'manifest.mjs')).href));
    ({ resolveProfile } = await import(pathToFileURL(join(RUNTIME_MCP, 'resolve-profile.mjs')).href));
    ok('mcp-002: runtime/mcp modules import cleanly');
  } catch (err) {
    bad(`mcp-002: module import failed — ${err?.message ?? err}`);
    rmSync(FAKE_ROOT, { recursive: true, force: true });
    return;
  }

  await runMcp002RegistryChecks({ ok, bad }, { PLATFORM, MCP_DIR, loadRegistry, findEntry });
  await runMcp002ManifestChecks({ ok, bad }, { FAKE_ROOT, MCP_DIR, readManifest, writeManifest, manifestPathFor });

  // Reload registry from restored state before profile checks
  const registry = loadRegistry(FAKE_ROOT);
  runMcp002ProfileChecks({ ok, bad }, { FAKE_ROOT, PROFILES_DIR, registry, resolveProfile });
  runMcp002SchemaChecks({ ok, bad }, { MCP_DIR });

  try { rmSync(FAKE_ROOT, { recursive: true, force: true }); } catch { /* non-critical */ }
}
