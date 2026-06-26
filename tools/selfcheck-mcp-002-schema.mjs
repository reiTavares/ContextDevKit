/**
 * MCP-002 self-check — Suite 4: manifest.schema.json structure
 *
 * Validates the JSON Schema file ships the required fields and enumerations.
 * Wired into selfcheck.mjs via runMcp002SchemaChecks.
 *
 * @module selfcheck-mcp-002-schema
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param {{ ok: Function, bad: Function }} rep
 * @param {{ MCP_DIR: string }} ctx
 */
export function runMcp002SchemaChecks({ ok, bad }, { MCP_DIR }) {
  console.log('  [MCP-002/4] manifest.schema.json');

  const raw = readFileSync(join(MCP_DIR, 'manifest.schema.json'), 'utf-8');
  let schema;
  try {
    schema = JSON.parse(raw);
    ok('mcp-002/schema: manifest.schema.json parses as valid JSON');
  } catch (err) {
    bad(`mcp-002/schema: manifest.schema.json malformed JSON: ${err?.message}`);
    return;
  }

  typeof schema?.$schema === 'string' ? ok('mcp-002/schema: has $schema') : bad('mcp-002/schema: missing $schema');
  typeof schema?.$id === 'string' ? ok('mcp-002/schema: has $id') : bad('mcp-002/schema: missing $id');

  Array.isArray(schema?.required) && schema.required.includes('version') && schema.required.includes('servers')
    ? ok('mcp-002/schema: required includes version + servers')
    : bad(`mcp-002/schema: required: ${JSON.stringify(schema?.required)}`);

  schema?.properties?.version ? ok('mcp-002/schema: properties.version present') : bad('mcp-002/schema: missing properties.version');
  schema?.properties?.servers ? ok('mcp-002/schema: properties.servers present') : bad('mcp-002/schema: missing properties.servers');
  schema?.$defs?.ManifestEntry ? ok('mcp-002/schema: $defs.ManifestEntry present') : bad('mcp-002/schema: missing $defs.ManifestEntry');
  schema?.$defs?.PinOverride ? ok('mcp-002/schema: $defs.PinOverride present') : bad('mcp-002/schema: missing $defs.PinOverride');

  schema?.$defs?.ManifestEntry?.properties?.referencedSecrets
    ? ok('mcp-002/schema: ManifestEntry has referencedSecrets property')
    : bad('mcp-002/schema: ManifestEntry missing referencedSecrets');

  const modeEnum = schema?.$defs?.ManifestEntry?.properties?.mode?.enum;
  Array.isArray(modeEnum) && modeEnum.includes('read-only') && modeEnum.includes('write')
    ? ok('mcp-002/schema: ManifestEntry.mode enum has read-only + write')
    : bad(`mcp-002/schema: ManifestEntry.mode enum: ${JSON.stringify(modeEnum)}`);
}
