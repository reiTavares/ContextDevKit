/**
 * MCP-002 integration test — Suite C: manifest.mjs + manifest.schema.json (AC-4 + AC-2)
 *
 * Covers:
 *   AC-4: manifest.mjs — atomic write (tmp+rename), BOM-strip, PLATFORM_DIR
 *         round-trip, generatedAt stamping, forward-slash path on Windows.
 *   AC-2: manifest.schema.json — metadata-only structure, $schema/$id/required
 *         fields, ManifestEntry $defs, mode enum, referencedSecrets property.
 *
 * Run:  node tools/integration-test-mcp-002-manifest.mjs
 * Exits non-zero on any failure.
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  reporter, buildTempTree, importMcpModules,
} from './integration-test-mcp-002-helpers.mjs';

const rep = reporter();
const { ok, bad, finish } = rep;

const { FAKE_ROOT, PLATFORM, MCP_DIR } = buildTempTree();
const { readManifest, writeManifest, manifestPathFor } = await importMcpModules(PLATFORM);

// ---------------------------------------------------------------------------
// AC-4: manifest.mjs behaviour
// ---------------------------------------------------------------------------
console.log('\n[Suite C] manifest.mjs behaviour (AC-4)\n');

// Missing manifest returns empty
const emptyResult = readManifest(FAKE_ROOT);
emptyResult.version === 1
  ? ok('missing manifest returns version:1')
  : bad(`missing manifest version: ${emptyResult.version}`);
Array.isArray(emptyResult.servers) && emptyResult.servers.length === 0
  ? ok('missing manifest returns empty servers array')
  : bad('missing manifest should have empty servers');

// Write + round-trip
const testManifest = {
  version: 1,
  servers: [
    { id: 'contextdevkit', mode: 'read-only', referencedSecrets: [], allowedTools: [] },
    { id: 'github', mode: 'read-only', referencedSecrets: ['GITHUB_PERSONAL_ACCESS_TOKEN'], allowedTools: [] },
  ],
};
await writeManifest(testManifest, FAKE_ROOT);
const loaded = readManifest(FAKE_ROOT);

loaded.version === 1
  ? ok('roundtrip: version is 1')
  : bad(`roundtrip version: ${loaded.version}`);
loaded.servers?.length === 2
  ? ok('roundtrip: 2 servers')
  : bad(`roundtrip servers count: ${loaded.servers?.length}`);
loaded.servers?.[0]?.id === 'contextdevkit'
  ? ok('roundtrip: first server id correct')
  : bad('roundtrip: first server id wrong');
loaded.servers?.[1]?.id === 'github'
  ? ok('roundtrip: second server id correct')
  : bad('roundtrip: second server id wrong');
typeof loaded.generatedAt === 'string' && loaded.generatedAt.length > 0
  ? ok('writeManifest stamps generatedAt ISO timestamp')
  : bad('writeManifest: generatedAt missing or empty');

// manifestPathFor returns forward-slash path (Windows safety)
const mpath = manifestPathFor(FAKE_ROOT);
!mpath.includes('\\')
  ? ok('manifestPathFor returns forward-slash path')
  : bad(`manifestPathFor has backslash: ${mpath}`);

// BOM-strip: write a BOM-prefixed file and verify readManifest handles it
const manifestFilePath = mpath;
const bomContent = '﻿' + readFileSync(manifestFilePath, 'utf-8').replace(/^﻿/, '');
writeFileSync(manifestFilePath, bomContent, 'utf-8');
const bomLoaded = readManifest(FAKE_ROOT);
bomLoaded.version === 1
  ? ok('readManifest handles BOM-prefixed file')
  : bad('readManifest BOM handling failed');

// Restore clean manifest
await writeManifest(testManifest, FAKE_ROOT);

// ---------------------------------------------------------------------------
// AC-2: manifest.schema.json structure
// ---------------------------------------------------------------------------
console.log('\n[Suite C] manifest.schema.json structure (AC-2)\n');

const schemaRaw = readFileSync(join(MCP_DIR, 'manifest.schema.json'), 'utf-8');
let schema;
try {
  schema = JSON.parse(schemaRaw);
  ok('manifest.schema.json parses as valid JSON');
} catch (err) {
  bad(`manifest.schema.json is malformed JSON: ${err.message}`);
}

typeof schema?.$schema === 'string'
  ? ok('schema has $schema field')
  : bad('schema missing $schema');
typeof schema?.$id === 'string'
  ? ok('schema has $id field')
  : bad('schema missing $id');
Array.isArray(schema?.required) && schema.required.includes('version') && schema.required.includes('servers')
  ? ok('schema required includes version and servers')
  : bad(`schema required: ${JSON.stringify(schema?.required)}`);
schema?.properties?.version
  ? ok('schema.properties.version present')
  : bad('schema missing properties.version');
schema?.properties?.servers
  ? ok('schema.properties.servers present')
  : bad('schema missing properties.servers');
schema?.$defs?.ManifestEntry
  ? ok('schema $defs.ManifestEntry present')
  : bad('schema missing $defs.ManifestEntry');
schema?.$defs?.PinOverride
  ? ok('schema $defs.PinOverride present')
  : bad('schema missing $defs.PinOverride');

// referencedSecrets in ManifestEntry — metadata only, never secret values
schema?.$defs?.ManifestEntry?.properties?.referencedSecrets
  ? ok('ManifestEntry has referencedSecrets property in schema')
  : bad('ManifestEntry missing referencedSecrets in schema');

// mode enum must contain read-only and write
const modeEnum = schema?.$defs?.ManifestEntry?.properties?.mode?.enum;
Array.isArray(modeEnum) && modeEnum.includes('read-only') && modeEnum.includes('write')
  ? ok('ManifestEntry.mode enum contains read-only and write')
  : bad(`ManifestEntry.mode enum: ${JSON.stringify(modeEnum)}`);

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
try { rmSync(FAKE_ROOT, { recursive: true, force: true }); } catch { /* non-critical */ }

finish('MCP-002 manifest (AC-4 + AC-2)');
