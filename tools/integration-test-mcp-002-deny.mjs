/**
 * MCP-002 integration test — Suite D: secret-value rejection + resolve-profile (AC-7 + AC-5)
 *
 * Covers:
 *   AC-7: writeManifest rejects GitHub PAT values, OpenAI keys, names with
 *         whitespace, and lowercase env-var names. readManifest also validates
 *         on load (embedded secrets in stored file).
 *   AC-5: resolve-profile.mjs PROPOSAL contract — all 5 profiles succeed,
 *         return correct shape, reference only known registry ids. Write-mode
 *         entries are flagged humanApprovalRequired=true (NOT silently enabled).
 *         Read-only entries are NOT flagged. Failure modes: unknown profile id,
 *         empty profileId, empty registry, profile with unknown server id.
 *
 * Run:  node tools/integration-test-mcp-002-deny.mjs
 * Exits non-zero on any failure.
 */
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  reporter, buildTempTree, importMcpModules,
  assertThrows, assertThrowsAsync,
} from './integration-test-mcp-002-helpers.mjs';

const rep = reporter();
const { ok, bad, finish } = rep;

const { FAKE_ROOT, PLATFORM, PROFILES_DIR } = buildTempTree();
const { loadRegistry, readManifest, writeManifest, manifestPathFor, resolveProfile } =
  await importMcpModules(PLATFORM);

// We need a clean manifest on disk for readManifest corruption tests later.
const baseManifest = {
  version: 1,
  servers: [
    { id: 'contextdevkit', mode: 'read-only', referencedSecrets: [], allowedTools: [] },
    { id: 'github', mode: 'read-only', referencedSecrets: ['GITHUB_PERSONAL_ACCESS_TOKEN'], allowedTools: [] },
  ],
};
await writeManifest(baseManifest, FAKE_ROOT);
const manifestFilePath = manifestPathFor(FAKE_ROOT);

// ---------------------------------------------------------------------------
// AC-7: Secret VALUE rejection — writeManifest throws
// ---------------------------------------------------------------------------
console.log('\n[Suite D] Secret value rejection — writeManifest (AC-7)\n');

await assertThrowsAsync(
  'writeManifest rejects GitHub PAT value (ghp_…)',
  () => writeManifest({ version: 1, servers: [{ id: 'github', referencedSecrets: ['ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcde0123'] }] }, FAKE_ROOT),
  'secret VALUE',
  rep,
);
await assertThrowsAsync(
  'writeManifest rejects OpenAI key (sk-…)',
  () => writeManifest({ version: 1, servers: [{ id: 'x', referencedSecrets: ['sk-abcdefghijklmnopqrstu'] }] }, FAKE_ROOT),
  'secret VALUE',
  rep,
);
await assertThrowsAsync(
  'writeManifest rejects name with whitespace',
  () => writeManifest({ version: 1, servers: [{ id: 'x', referencedSecrets: ['MY SECRET'] }] }, FAKE_ROOT),
  'secret VALUE',
  rep,
);
await assertThrowsAsync(
  'writeManifest rejects lowercase secret name',
  () => writeManifest({ version: 1, servers: [{ id: 'x', referencedSecrets: ['my_token'] }] }, FAKE_ROOT),
  'not a valid environment-variable name',
  rep,
);

// readManifest also validates on load (embedded secret in stored file)
writeFileSync(
  manifestFilePath,
  JSON.stringify({ version: 1, servers: [{ id: 'x', referencedSecrets: ['ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcde0123'] }] }),
  'utf-8',
);
assertThrows('readManifest rejects embedded GitHub PAT on load', () => readManifest(FAKE_ROOT), 'secret VALUE', rep);

// Restore manifest after corruption
await writeManifest(baseManifest, FAKE_ROOT);

// ---------------------------------------------------------------------------
// AC-5: resolve-profile.mjs — PROPOSAL contract, no silent write-mode
// ---------------------------------------------------------------------------
console.log('\n[Suite D] resolve-profile.mjs — proposal contract (AC-5)\n');

const registry = loadRegistry(FAKE_ROOT);
const KNOWN_PROFILE_IDS = ['web-app', 'backend-api', 'supabase', 'product-design', 'regulated'];
const knownIds = new Set(registry.map((e) => e.id));

// All 5 profiles resolve without throwing and return correct shape
for (const profileId of KNOWN_PROFILE_IDS) {
  let proposal;
  try {
    proposal = resolveProfile(profileId, registry, FAKE_ROOT);
    ok(`resolveProfile('${profileId}') succeeds`);
  } catch (err) {
    bad(`resolveProfile('${profileId}') threw unexpectedly: ${err.message}`);
    continue;
  }
  proposal.profileId === profileId
    ? ok(`resolveProfile('${profileId}') returns correct profileId`)
    : bad(`resolveProfile('${profileId}') profileId: ${proposal.profileId}`);
  Array.isArray(proposal.servers)
    ? ok(`resolveProfile('${profileId}') returns servers array`)
    : bad(`resolveProfile('${profileId}') servers is not an array`);
  typeof proposal.reason === 'string' && proposal.reason.length > 0
    ? ok(`resolveProfile('${profileId}') has reason string`)
    : bad(`resolveProfile('${profileId}') reason missing`);
  typeof proposal.requiresHumanApproval === 'boolean'
    ? ok(`resolveProfile('${profileId}') requiresHumanApproval is boolean`)
    : bad(`resolveProfile('${profileId}') requiresHumanApproval not a boolean`);
  proposal.servers.every((s) => knownIds.has(s.id))
    ? ok(`all servers in '${profileId}' reference known registry ids`)
    : bad(`profile '${profileId}' references unknown server ids: ${proposal.servers.filter((s) => !knownIds.has(s.id)).map((s) => s.id).join(', ')}`);
}

// regulated = minimal: 1 server (contextdevkit), read-only, no human approval
const regulatedP = resolveProfile('regulated', registry, FAKE_ROOT);
regulatedP.servers.length === 1
  ? ok('regulated profile has exactly 1 server')
  : bad(`regulated server count: ${regulatedP.servers.length}`);
regulatedP.servers[0]?.id === 'contextdevkit'
  ? ok('regulated sole server is contextdevkit')
  : bad(`regulated sole server: ${regulatedP.servers[0]?.id}`);
regulatedP.servers[0]?.mode === 'read-only'
  ? ok('regulated contextdevkit mode is read-only')
  : bad(`regulated mode: ${regulatedP.servers[0]?.mode}`);
regulatedP.requiresHumanApproval === false
  ? ok('regulated requiresHumanApproval is false')
  : bad(`regulated requiresHumanApproval: ${regulatedP.requiresHumanApproval}`);

// write-mode entries are flagged — NOT silently enabled (AC-5 core contract)
const webAppP = resolveProfile('web-app', registry, FAKE_ROOT);
const pwServer = webAppP.servers.find((s) => s.id === 'playwright');
pwServer
  ? ok('web-app proposal includes playwright')
  : bad('web-app proposal missing playwright');
pwServer?.humanApprovalRequired === true
  ? ok('playwright in web-app marked humanApprovalRequired=true')
  : bad(`playwright humanApprovalRequired: ${pwServer?.humanApprovalRequired}`);
webAppP.requiresHumanApproval === true
  ? ok('web-app requiresHumanApproval is true (write-mode present)')
  : bad(`web-app requiresHumanApproval: ${webAppP.requiresHumanApproval}`);

// read-only servers are NOT flagged
const cdkInWebApp = webAppP.servers.find((s) => s.id === 'contextdevkit');
cdkInWebApp?.humanApprovalRequired === false
  ? ok('contextdevkit in web-app humanApprovalRequired=false (read-only)')
  : bad(`contextdevkit humanApprovalRequired: ${cdkInWebApp?.humanApprovalRequired}`);

// product-design: playwright also write → human approval required
const pdP = resolveProfile('product-design', registry, FAKE_ROOT);
pdP.requiresHumanApproval === true
  ? ok('product-design requiresHumanApproval=true (has playwright)')
  : bad(`product-design requiresHumanApproval: ${pdP.requiresHumanApproval}`);

// backend-api and supabase: all read-only → no human approval
const backendP = resolveProfile('backend-api', registry, FAKE_ROOT);
backendP.requiresHumanApproval === false
  ? ok('backend-api requiresHumanApproval=false (all read-only)')
  : bad(`backend-api requiresHumanApproval: ${backendP.requiresHumanApproval}`);
const supabP = resolveProfile('supabase', registry, FAKE_ROOT);
supabP.requiresHumanApproval === false
  ? ok('supabase requiresHumanApproval=false (all read-only)')
  : bad(`supabase requiresHumanApproval: ${supabP.requiresHumanApproval}`);

// ---------------------------------------------------------------------------
// Failure modes for resolveProfile
// ---------------------------------------------------------------------------
assertThrows('resolveProfile throws on unknown profile id', () => resolveProfile('nonexistent', registry, FAKE_ROOT), 'not found', rep);
assertThrows('resolveProfile throws on empty profileId', () => resolveProfile('', registry, FAKE_ROOT), 'non-empty string', rep);
assertThrows('resolveProfile throws on empty registry', () => resolveProfile('web-app', [], FAKE_ROOT), 'non-empty RegistryEntry array', rep);

// Profile referencing an unknown server id must throw (not silently skip)
const badProfilePath = join(PROFILES_DIR, 'bad-test-id.json');
writeFileSync(badProfilePath, JSON.stringify({ id: 'bad-test-id', servers: [{ id: 'ghost-server' }] }), 'utf-8');
assertThrows('resolveProfile throws on profile with unknown server id', () => resolveProfile('bad-test-id', registry, FAKE_ROOT), 'unknown server id', rep);
rmSync(badProfilePath);

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
try { rmSync(FAKE_ROOT, { recursive: true, force: true }); } catch { /* non-critical */ }

finish('MCP-002 deny (AC-7 + AC-5)');
