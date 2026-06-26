/**
 * MCP-002 self-check — Suite 1: registry.mjs
 *
 * Validates loadRegistry, findEntry, fail-fast on malformed JSON, and the
 * curated seed entries (contextdevkit / github / playwright). Wired into
 * selfcheck.mjs via runMcp002RegistryChecks.
 *
 * @module selfcheck-mcp-002-registry
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * @param {{ ok: Function, bad: Function }} rep
 * @param {{ PLATFORM: string, MCP_DIR: string, loadRegistry: Function, findEntry: Function }} ctx
 */
export async function runMcp002RegistryChecks({ ok, bad }, { PLATFORM, MCP_DIR, loadRegistry, findEntry }) {
  console.log('  [MCP-002/1] registry.mjs');

  const entries = loadRegistry(join(PLATFORM, '..'));
  Array.isArray(entries) && entries.length === 3
    ? ok('mcp-002/registry: loadRegistry returns 3 curated entries')
    : bad(`mcp-002/registry: expected 3 entries, got ${entries?.length}`);

  // contextdevkit
  const cdk = entries.find((e) => e.id === 'contextdevkit');
  cdk ? ok('mcp-002/registry: contextdevkit present') : bad('mcp-002/registry: contextdevkit missing');
  cdk?.risk === 'R0' ? ok('mcp-002/registry: contextdevkit risk=R0') : bad(`mcp-002/registry: contextdevkit risk ${cdk?.risk}`);
  cdk?.defaultMode === 'read-only' ? ok('mcp-002/registry: contextdevkit defaultMode=read-only') : bad(`mcp-002/registry: contextdevkit defaultMode ${cdk?.defaultMode}`);
  cdk?.transport === 'stdio' ? ok('mcp-002/registry: contextdevkit transport=stdio') : bad(`mcp-002/registry: contextdevkit transport ${cdk?.transport}`);
  cdk?.approval === 'auto' ? ok('mcp-002/registry: contextdevkit approval=auto') : bad(`mcp-002/registry: contextdevkit approval ${cdk?.approval}`);
  typeof cdk?.pin?.npm === 'string' ? ok('mcp-002/registry: contextdevkit pin.npm set') : bad('mcp-002/registry: contextdevkit pin.npm missing');
  cdk?.provenance?.publisher === 'reiTavares' ? ok('mcp-002/registry: contextdevkit provenance.publisher') : bad(`mcp-002/registry: provenance.publisher ${cdk?.provenance?.publisher}`);
  cdk?.provenance?.license === 'MIT' ? ok('mcp-002/registry: contextdevkit provenance.license=MIT') : bad(`mcp-002/registry: provenance.license ${cdk?.provenance?.license}`);
  cdk?.requiredSecrets?.length === 0 ? ok('mcp-002/registry: contextdevkit requiredSecrets empty') : bad(`mcp-002/registry: requiredSecrets ${JSON.stringify(cdk?.requiredSecrets)}`);

  // github
  const gh = entries.find((e) => e.id === 'github');
  gh?.risk === 'R2' ? ok('mcp-002/registry: github risk=R2') : bad(`mcp-002/registry: github risk ${gh?.risk}`);
  gh?.defaultMode === 'read-only' ? ok('mcp-002/registry: github defaultMode=read-only') : bad(`mcp-002/registry: github defaultMode ${gh?.defaultMode}`);
  gh?.requiredSecrets?.includes('GITHUB_PERSONAL_ACCESS_TOKEN')
    ? ok('mcp-002/registry: github requiredSecrets has PAT')
    : bad('mcp-002/registry: github requiredSecrets missing PAT');
  gh?.approval === 'auto' ? ok('mcp-002/registry: github approval=auto') : bad(`mcp-002/registry: github approval ${gh?.approval}`);

  // playwright
  const pw = entries.find((e) => e.id === 'playwright');
  pw?.risk === 'R3' ? ok('mcp-002/registry: playwright risk=R3') : bad(`mcp-002/registry: playwright risk ${pw?.risk}`);
  pw?.defaultMode === 'write' ? ok('mcp-002/registry: playwright defaultMode=write') : bad(`mcp-002/registry: playwright defaultMode ${pw?.defaultMode}`);
  pw?.approval === 'human' ? ok('mcp-002/registry: playwright approval=human') : bad(`mcp-002/registry: playwright approval ${pw?.approval}`);
  pw?.versionPolicy === 'pinned' ? ok('mcp-002/registry: playwright versionPolicy=pinned') : bad(`mcp-002/registry: playwright versionPolicy ${pw?.versionPolicy}`);

  // findEntry
  findEntry('contextdevkit', join(PLATFORM, '..'))?.id === 'contextdevkit'
    ? ok('mcp-002/registry: findEntry returns entry by id')
    : bad('mcp-002/registry: findEntry failed for contextdevkit');
  findEntry('nonexistent', join(PLATFORM, '..')) === null
    ? ok('mcp-002/registry: findEntry returns null for unknown id')
    : bad('mcp-002/registry: findEntry should return null');

  // Fail-fast paths
  const registryPath = join(MCP_DIR, 'registry.json');
  const goodRegistry = readFileSync(registryPath, 'utf-8');
  const fakeRoot = join(PLATFORM, '..');

  writeFileSync(registryPath, '{ bad json ]', 'utf-8');
  try {
    loadRegistry(fakeRoot);
    bad('mcp-002/registry: loadRegistry should throw on malformed JSON');
  } catch (err) {
    err?.message?.includes('malformed JSON')
      ? ok('mcp-002/registry: loadRegistry throws on malformed JSON')
      : bad(`mcp-002/registry: wrong error on malformed JSON: ${err?.message?.slice(0, 80)}`);
  }

  writeFileSync(registryPath, JSON.stringify({ version: 1 }), 'utf-8');
  try {
    loadRegistry(fakeRoot);
    bad('mcp-002/registry: loadRegistry should throw on missing entries array');
  } catch (err) {
    err?.message?.includes('"entries" array')
      ? ok('mcp-002/registry: loadRegistry throws on missing entries array')
      : bad(`mcp-002/registry: wrong error on missing entries: ${err?.message?.slice(0, 80)}`);
  }

  // Provenance sub-field validation (AC#1 + AC#3 fail-fast contract)
  writeFileSync(registryPath, JSON.stringify({ entries: [{
    id: 'x', displayName: 'X', publisher: 'p', source: 'npm:x',
    transport: 'stdio', risk: 'R0',
    capabilities: { tools: [], resources: [], prompts: [] },
    requiredSecrets: [], allowedHosts: ['*'], defaultMode: 'read-only',
    versionPolicy: 'pinned', pin: { npm: '1.0.0' }, approval: 'auto',
    provenance: {},
  }] }), 'utf-8');
  try {
    loadRegistry(fakeRoot);
    bad('mcp-002/registry: loadRegistry should throw on empty provenance{}');
  } catch (err) {
    err?.message?.toLowerCase().includes('provenance')
      ? ok('mcp-002/registry: loadRegistry throws on empty provenance{}')
      : bad(`mcp-002/registry: wrong error on empty provenance: ${err?.message?.slice(0, 100)}`);
  }

  writeFileSync(registryPath, goodRegistry, 'utf-8');
}
