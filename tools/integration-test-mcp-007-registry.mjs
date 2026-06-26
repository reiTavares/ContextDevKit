/**
 * integration-test-mcp-007-registry.mjs — MCP-007 sub-suite: registry + profile shape.
 *
 * Covers:
 *   [Suite 1] AC#1 — registry.json NOT edited; github wave-1 entry intact
 *   [Suite 2] AC#2 — profile shape: read-only mode + read tools present
 *
 * Run:  node tools/integration-test-mcp-007-registry.mjs
 * Exits non-zero on any failure. Plain node:* — zero framework, zero deps.
 */

import { reporter } from './it-helpers.mjs';
import { loadFixtures, READ_TOOLS } from './integration-test-mcp-007-helpers.mjs';

const { ok, bad, finish } = reporter();

// ── Load JSON fixtures ────────────────────────────────────────────────────────

let profile, registry;

try {
  const fixtures = loadFixtures();
  profile  = fixtures.profile;
  registry = fixtures.registry;
} catch (err) {
  bad(`JSON load failed — ${err.message}`);
  finish('MCP-007/registry (integration)');
}

const registryEntries     = registry.entries ?? [];
const githubRegistryEntry = registryEntries.find((e) => e.id === 'github');

// ────────────────────────────────────────────────────────────────────────────
// [Suite 1] AC#1 — Registry not edited; wave-1 github entry intact
// ────────────────────────────────────────────────────────────────────────────

console.log('\n[Suite 1] AC#1 — registry.json NOT edited; github entry is wave-1 seeded\n');

githubRegistryEntry
  ? ok('AC#1 github entry found in registry.json (wave-1 seeded)')
  : bad('AC#1 github entry MISSING from registry.json — was registry.json edited?');

githubRegistryEntry?.risk === 'R2'
  ? ok('AC#1 github registry entry has risk R2')
  : bad(`AC#1 github registry risk: expected R2, got ${githubRegistryEntry?.risk}`);

githubRegistryEntry?.pin?.npm === '2.0.0'
  ? ok('AC#1 github registry pin.npm is 2.0.0 (pinned, not floating)')
  : bad(`AC#1 github registry pin.npm: expected 2.0.0, got ${githubRegistryEntry?.pin?.npm}`);

githubRegistryEntry?.defaultMode === 'read-only'
  ? ok('AC#1 github registry defaultMode is read-only')
  : bad(`AC#1 github registry defaultMode: expected read-only, got ${githubRegistryEntry?.defaultMode}`);

// MCP-007 must NOT have added new entries — only the pre-existing three are expected
const EXPECTED_REGISTRY_IDS = new Set(['contextdevkit', 'github', 'playwright']);
const actualIds   = registryEntries.map((e) => e.id);
const unexpected  = actualIds.filter((id) => !EXPECTED_REGISTRY_IDS.has(id));
unexpected.length === 0
  ? ok('AC#1 registry.json contains exactly the 3 wave-1 entries (no extras added by MCP-007)')
  : bad(`AC#1 registry.json has unexpected new entries: ${unexpected.join(', ')}`);

// ────────────────────────────────────────────────────────────────────────────
// [Suite 2] AC#2 — Profile shape: read-only, read tools present
// ────────────────────────────────────────────────────────────────────────────

console.log('\n[Suite 2] AC#2 — profile read-only mode + read tools present\n');

const profileServer = (profile.servers ?? []).find((s) => s.id === 'github');

profileServer
  ? ok('AC#2 profile.servers contains a github entry')
  : bad('AC#2 profile.servers missing github entry');

profileServer?.mode === 'read-only'
  ? ok('AC#2 profile mode is read-only')
  : bad(`AC#2 profile mode: expected read-only, got ${profileServer?.mode}`);

for (const tool of READ_TOOLS) {
  (profileServer?.allowedTools ?? []).includes(tool)
    ? ok(`AC#2 read tool '${tool}' in profile.allowedTools`)
    : bad(`AC#2 read tool '${tool}' MISSING from profile.allowedTools`);
}

// ────────────────────────────────────────────────────────────────────────────
finish('MCP-007/registry (integration)');
