/**
 * MCP-002 integration test — Suite A: Curated registry seed (AC-6 + AC-1)
 *
 * Covers:
 *   AC-1: RegistryEntry schema validation (all required fields, valid enums)
 *   AC-6: Curated seed entries (contextdevkit R0/R1, github R2, playwright R3)
 *         with provenance, capabilities sub-schema, and pinning.
 *
 * Run:  node tools/integration-test-mcp-002-seed.mjs
 * Exits non-zero on any failure.
 */
import { rmSync } from 'node:fs';
import { reporter, buildTempTree, importMcpModules } from './integration-test-mcp-002-helpers.mjs';

const rep = reporter();
const { ok, bad, finish } = rep;

const { FAKE_ROOT, PLATFORM } = buildTempTree();

const { loadRegistry } = await importMcpModules(PLATFORM);

// ---------------------------------------------------------------------------
// AC-6: Curated seed — 3 entries, correct content
// ---------------------------------------------------------------------------
console.log('\n[Suite A] Curated registry seed (AC-6 + AC-1)\n');

const entries = loadRegistry(FAKE_ROOT);
Array.isArray(entries) && entries.length === 3
  ? ok('loadRegistry returns exactly 3 curated entries')
  : bad(`loadRegistry: expected 3 entries, got ${entries?.length}`);

// contextdevkit — R0, read-only, stdio, auto
const cdk = entries.find((e) => e.id === 'contextdevkit');
cdk ? ok('contextdevkit entry present') : bad('contextdevkit entry missing');
cdk?.risk === 'R0' ? ok('contextdevkit risk is R0') : bad(`contextdevkit risk: expected R0, got ${cdk?.risk}`);
cdk?.defaultMode === 'read-only' ? ok('contextdevkit defaultMode is read-only') : bad(`contextdevkit defaultMode: ${cdk?.defaultMode}`);
cdk?.transport === 'stdio' ? ok('contextdevkit transport is stdio') : bad(`contextdevkit transport: ${cdk?.transport}`);
cdk?.approval === 'auto' ? ok('contextdevkit approval is auto') : bad(`contextdevkit approval: ${cdk?.approval}`);
cdk?.versionPolicy === 'pinned' ? ok('contextdevkit versionPolicy is pinned') : bad(`contextdevkit versionPolicy: ${cdk?.versionPolicy}`);
typeof cdk?.pin?.npm === 'string' ? ok('contextdevkit pin.npm is a string') : bad('contextdevkit pin.npm missing');
cdk?.requiredSecrets?.length === 0 ? ok('contextdevkit requiredSecrets is empty') : bad(`contextdevkit requiredSecrets: ${JSON.stringify(cdk?.requiredSecrets)}`);
cdk?.provenance?.publisher === 'reiTavares' ? ok('contextdevkit provenance.publisher correct') : bad(`contextdevkit provenance.publisher: ${cdk?.provenance?.publisher}`);
cdk?.provenance?.license === 'MIT' ? ok('contextdevkit provenance.license is MIT') : bad(`contextdevkit provenance.license: ${cdk?.provenance?.license}`);
typeof cdk?.provenance?.url === 'string' && cdk.provenance.url.length > 0 ? ok('contextdevkit provenance.url set') : bad('contextdevkit provenance.url missing');
Array.isArray(cdk?.provenance?.requestedPermissions) ? ok('contextdevkit provenance.requestedPermissions is array') : bad('contextdevkit provenance.requestedPermissions missing');

// github — R2, read-only, requires GITHUB_PERSONAL_ACCESS_TOKEN
const gh = entries.find((e) => e.id === 'github');
gh ? ok('github entry present') : bad('github entry missing');
gh?.risk === 'R2' ? ok('github risk is R2') : bad(`github risk: expected R2, got ${gh?.risk}`);
gh?.defaultMode === 'read-only' ? ok('github defaultMode is read-only') : bad(`github defaultMode: ${gh?.defaultMode}`);
gh?.requiredSecrets?.includes('GITHUB_PERSONAL_ACCESS_TOKEN')
  ? ok('github requiredSecrets contains GITHUB_PERSONAL_ACCESS_TOKEN')
  : bad(`github requiredSecrets: ${JSON.stringify(gh?.requiredSecrets)}`);
gh?.approval === 'auto' ? ok('github approval is auto') : bad(`github approval: ${gh?.approval}`);
typeof gh?.provenance?.url === 'string' ? ok('github provenance.url set') : bad('github provenance.url missing');

// playwright — R3, write, human approval
const pw = entries.find((e) => e.id === 'playwright');
pw ? ok('playwright entry present') : bad('playwright entry missing');
pw?.risk === 'R3' ? ok('playwright risk is R3') : bad(`playwright risk: expected R3, got ${pw?.risk}`);
pw?.defaultMode === 'write' ? ok('playwright defaultMode is write') : bad(`playwright defaultMode: ${pw?.defaultMode}`);
pw?.approval === 'human' ? ok('playwright approval is human') : bad(`playwright approval: ${pw?.approval}`);
pw?.versionPolicy === 'pinned' ? ok('playwright versionPolicy is pinned') : bad(`playwright versionPolicy: ${pw?.versionPolicy}`);
typeof pw?.pin?.npm === 'string' ? ok('playwright pin.npm is a string') : bad('playwright pin.npm missing');
pw?.requiredSecrets?.length === 0 ? ok('playwright requiredSecrets is empty') : bad(`playwright requiredSecrets: ${JSON.stringify(pw?.requiredSecrets)}`);

// AC-1: All entries have required schema fields + capabilities/provenance sub-schemas
const REQ_FIELDS = ['id', 'displayName', 'publisher', 'source', 'transport', 'risk',
  'capabilities', 'requiredSecrets', 'allowedHosts', 'defaultMode',
  'versionPolicy', 'pin', 'approval', 'provenance'];
const PROV_FIELDS = ['publisher', 'url', 'version', 'hash', 'license', 'verifiedAt', 'transport', 'requestedPermissions'];

for (const entry of entries) {
  const missing = REQ_FIELDS.filter((f) => entry[f] === undefined || entry[f] === null);
  missing.length === 0
    ? ok(`entry '${entry.id}' has all required RegistryEntry fields`)
    : bad(`entry '${entry.id}' missing fields: ${missing.join(', ')}`);

  const caps = entry.capabilities;
  ['tools', 'resources', 'prompts'].every((k) => Array.isArray(caps?.[k]))
    ? ok(`entry '${entry.id}' capabilities has tools/resources/prompts arrays`)
    : bad(`entry '${entry.id}' capabilities malformed: ${JSON.stringify(caps)}`);

  const prov = entry.provenance;
  const provMissing = PROV_FIELDS.filter((f) => !(f in prov));
  provMissing.length === 0
    ? ok(`entry '${entry.id}' provenance has all required fields`)
    : bad(`entry '${entry.id}' provenance missing: ${provMissing.join(', ')}`);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
try { rmSync(FAKE_ROOT, { recursive: true, force: true }); } catch { /* non-critical */ }

finish('MCP-002 seed (AC-6 + AC-1)');
