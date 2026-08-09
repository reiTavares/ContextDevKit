/**
 * integration-test-mcp-006-catalog.mjs — MCP-006 catalog completeness (AC-1/2/3).
 *
 * Covers:
 *   Suite 1 — Module imports (tools.read.mjs / resources.mjs / prompts.mjs)
 *   Suite 2 — Tool catalog: 10 exports present (AC-1)
 *   Suite 3 — Resource catalog: 6 URIs + required fields (AC-2)
 *   Suite 4 — Prompt catalog: 5 entries + arguments arrays (AC-3)
 *
 * Run:  node tools/integration-test-mcp-006-catalog.mjs
 * Exits non-zero on any failure. Plain node:* — zero framework, zero deps.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { reporter } from './it-helpers.mjs';
import {
  MCP_SERVER_DIR,
  EXPECTED_TOOLS,
  EXPECTED_RESOURCE_URIS,
  EXPECTED_PROMPT_NAMES,
} from './integration-test-mcp-006-helpers.mjs';

const { ok, bad, finish } = reporter();

// ─── Suite 1: Module imports ──────────────────────────────────────────────────

console.log('\n[Suite 1] Module imports\n');

let toolsMod, resourcesMod, promptsMod;

try {
  toolsMod = await import(pathToFileURL(resolve(MCP_SERVER_DIR, 'tools.read.mjs')).href);
  ok('tools.read.mjs imports without error');
} catch (err) {
  bad(`tools.read.mjs import failed: ${err.message}`);
  process.exit(1);
}

try {
  resourcesMod = await import(pathToFileURL(resolve(MCP_SERVER_DIR, 'resources.mjs')).href);
  ok('resources.mjs imports without error');
} catch (err) {
  bad(`resources.mjs import failed: ${err.message}`);
  process.exit(1);
}

try {
  promptsMod = await import(pathToFileURL(resolve(MCP_SERVER_DIR, 'prompts.mjs')).href);
  ok('prompts.mjs imports without error');
} catch (err) {
  bad(`prompts.mjs import failed: ${err.message}`);
  process.exit(1);
}

// ─── Suite 2: Tool catalog completeness (AC-1) ────────────────────────────────

console.log('\n[Suite 2] Tool catalog completeness (AC-1)\n');

for (const name of EXPECTED_TOOLS) {
  typeof toolsMod[name] === 'function'
    ? ok(`export ${name} is a function`)
    : bad(`export ${name} is missing or not a function`);
}

// ─── Suite 3: Resource catalog completeness (AC-2) ────────────────────────────

console.log('\n[Suite 3] Resource catalog completeness (AC-2)\n');

Array.isArray(resourcesMod.RESOURCE_LIST)
  ? ok('RESOURCE_LIST is an array')
  : bad('RESOURCE_LIST is not an array');

resourcesMod.RESOURCE_LIST.length === 6
  ? ok('RESOURCE_LIST has exactly 6 entries')
  : bad(`RESOURCE_LIST count: expected 6, got ${resourcesMod.RESOURCE_LIST.length}`);

for (const uri of EXPECTED_RESOURCE_URIS) {
  resourcesMod.RESOURCE_LIST.some((r) => r.uri === uri)
    ? ok(`resource URI present: ${uri}`)
    : bad(`resource URI missing: ${uri}`);
}

for (const entry of resourcesMod.RESOURCE_LIST) {
  const missing = ['uri', 'name', 'description', 'mimeType'].filter((k) => !entry[k]);
  missing.length === 0
    ? ok(`resource '${entry.uri}' has all required fields`)
    : bad(`resource '${entry.uri}' missing: ${missing.join(', ')}`);
}

typeof resourcesMod.readResource === 'function'
  ? ok('readResource is exported as a function')
  : bad('readResource missing or not a function');

// ─── Suite 4: Prompt catalog completeness (AC-3) ──────────────────────────────

console.log('\n[Suite 4] Prompt catalog completeness (AC-3)\n');

Array.isArray(promptsMod.PROMPT_LIST)
  ? ok('PROMPT_LIST is an array')
  : bad('PROMPT_LIST is not an array');

promptsMod.PROMPT_LIST.length === 5
  ? ok('PROMPT_LIST has exactly 5 entries')
  : bad(`PROMPT_LIST count: expected 5, got ${promptsMod.PROMPT_LIST.length}`);

for (const name of EXPECTED_PROMPT_NAMES) {
  const entry = promptsMod.PROMPT_LIST.find((p) => p.name === name);
  entry
    ? ok(`prompt '${name}' present in PROMPT_LIST`)
    : bad(`prompt '${name}' missing from PROMPT_LIST`);
  if (entry) {
    Array.isArray(entry.arguments)
      ? ok(`prompt '${name}' has arguments array`)
      : bad(`prompt '${name}' arguments is not an array`);
  }
}

typeof promptsMod.getPrompt === 'function'
  ? ok('getPrompt is exported as a function')
  : bad('getPrompt missing or not a function');

// ─── Done ─────────────────────────────────────────────────────────────────────

finish('MCP-006 catalog integration test');
