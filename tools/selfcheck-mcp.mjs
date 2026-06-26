#!/usr/bin/env node
/**
 * selfcheck-mcp.mjs — STANDALONE static-wiring floor check for the WF0014 MCP
 * Integration Layer (exit 0/1).
 *
 * WHY: the per-ticket `integration-test-mcp-*.mjs` suites prove BEHAVIOUR of
 * each slice. This check is the cross-cutting STRUCTURAL guard that the layer
 * is wired together at all — the same role `selfcheck.mjs` plays for the core:
 * registry is valid, every profile references a KNOWN registry id, every source
 * file the layer depends on exists under `templates/` (single-sourcing rule),
 * and the `/mcp` command surface is present on every host. A renamed/dropped
 * source file or a profile pointing at a phantom server id fails loudly here
 * instead of silently at a user's `/mcp` call.
 *
 * Zero runtime deps — `node:*` only. Windows-safe (forward-slashed, BOM-stripped
 * via the registry loader). Follows the `tools/selfcheck-suites.mjs` convention.
 *
 * Run: node tools/selfcheck-mcp.mjs
 *
 * @module selfcheck-mcp
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const MCP_DIR = resolve(KIT, 'templates/contextkit/mcp');
const RUNTIME_MCP = resolve(KIT, 'templates/contextkit/runtime/mcp');
const MCP_SERVER = resolve(KIT, 'templates/contextkit/mcp-server');
const SCRIPTS = resolve(KIT, 'templates/contextkit/tools/scripts');

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => {
  console.error(`  ✗ ${msg}`);
  failures += 1;
};

/** Source files every part of the layer single-sources under `templates/`. */
const RUNTIME_FILES = Object.freeze([
  'activation.mjs', 'manifest.mjs', 'policy.mjs', 'registry.mjs',
  'resolve-profile.mjs', 'risk-classes.mjs', 'secret-shape.mjs',
  'render/render-shared.mjs', 'render/render-claude.mjs',
  'render/render-codex.mjs', 'render/render-cursor.mjs',
  'render/render-antigravity.mjs',
]);
const SERVER_FILES = Object.freeze([
  'server.mjs', 'tools.read.mjs', 'tools.write.mjs',
  'tools.write-gate.mjs', 'resources.mjs', 'prompts.mjs',
]);
const SCRIPT_FILES = Object.freeze([
  'mcp.mjs', 'mcp-discover.mjs', 'mcp-discover-core.mjs',
  'mcp-doctor.mjs', 'mcp-doctor-core.mjs', 'mcp-doctor-helpers.mjs',
  'mcp-doctor-probe-http.mjs', 'mcp-doctor-probe-stdio.mjs',
  'mcp-audit.mjs', 'mcp-audit-core.mjs', 'mcp-receipt.mjs',
]);

/** Every host that must carry a `/mcp` command surface (ADR-0036/0056/0068). */
const COMMAND_SURFACES = Object.freeze([
  'templates/claude/commands/mcp',
  'templates/antigravity/skills/mcp',
]);

function checkSourcePresent(base, files, label) {
  for (const rel of files) {
    existsSync(join(base, rel))
      ? ok(`${label}: ${rel} present`)
      : bad(`${label}: MISSING source file ${rel}`);
  }
}

async function checkRegistryAndProfiles() {
  const { loadRegistry } = await import(pathToFileURL(join(RUNTIME_MCP, 'registry.mjs')).href);
  let entries;
  try {
    entries = loadRegistry(resolve(KIT, 'templates')); // loader joins <root>/contextkit/mcp/registry.json
  } catch (err) {
    bad(`registry: loadRegistry threw — ${err?.message?.slice(0, 120)}`);
    return;
  }
  Array.isArray(entries) && entries.length > 0
    ? ok(`registry: loadRegistry returns ${entries.length} validated entr(ies)`)
    : bad('registry: loadRegistry returned no entries');

  const knownIds = new Set(entries.map((e) => e.id));

  const profilesDir = join(MCP_DIR, 'profiles');
  const profileFiles = readdirSync(profilesDir).filter((n) => n.endsWith('.json'));
  profileFiles.length > 0
    ? ok(`profiles: ${profileFiles.length} profile file(s) found`)
    : bad('profiles: no profile files found');

  for (const file of profileFiles) {
    let profile;
    try {
      profile = JSON.parse(readFileSync(join(profilesDir, file), 'utf-8').replace(/^﻿/, ''));
    } catch (err) {
      bad(`profiles/${file}: malformed JSON — ${err?.message?.slice(0, 80)}`);
      continue;
    }
    const servers = Array.isArray(profile.servers) ? profile.servers : [];
    const unknown = servers.map((s) => s.id).filter((id) => !knownIds.has(id));
    unknown.length === 0
      ? ok(`profiles/${file}: every server id is in the registry`)
      : bad(`profiles/${file}: references unknown registry id(s): ${unknown.join(', ')}`);
  }
}

function checkCommandSurfaces() {
  for (const rel of COMMAND_SURFACES) {
    const dir = resolve(KIT, rel);
    if (!existsSync(dir)) {
      bad(`command-surface: MISSING ${rel}`);
      continue;
    }
    const mdFiles = readdirSync(dir).filter((n) => n.endsWith('.md'));
    mdFiles.length > 0
      ? ok(`command-surface: ${rel} present (${mdFiles.length} doc(s))`)
      : bad(`command-surface: ${rel} exists but has no command docs`);
  }
  // The dispatch doc must actually invoke the mcp.mjs dispatcher.
  const dispatchDoc = resolve(KIT, 'templates/claude/commands/mcp/mcp.md');
  if (existsSync(dispatchDoc)) {
    readFileSync(dispatchDoc, 'utf-8').includes('mcp.mjs')
      ? ok('command-surface: claude /mcp doc invokes mcp.mjs')
      : bad('command-surface: claude /mcp doc does not invoke mcp.mjs');
  } else {
    bad('command-surface: templates/claude/commands/mcp/mcp.md missing');
  }
}

async function main() {
  console.log('\n🌀 ContextDevKit MCP integration-layer static wiring check\n');

  console.log('  [registry + profiles]');
  await checkRegistryAndProfiles();

  console.log('\n  [runtime/mcp source]');
  checkSourcePresent(RUNTIME_MCP, RUNTIME_FILES, 'runtime/mcp');

  console.log('\n  [mcp-server source]');
  checkSourcePresent(MCP_SERVER, SERVER_FILES, 'mcp-server');

  console.log('\n  [tools/scripts/mcp-*]');
  checkSourcePresent(SCRIPTS, SCRIPT_FILES, 'scripts');

  console.log('\n  [command surfaces]');
  checkCommandSurfaces();

  console.log(failures === 0 ? '\n✅ MCP static wiring check passed.\n' : `\n❌ ${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`selfcheck-mcp: unexpected error: ${err?.stack ?? err}`);
  process.exit(1);
});
