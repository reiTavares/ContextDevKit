#!/usr/bin/env node
/**
 * MCP-006 self-check — Suite 1 & 2: module imports + catalog completeness.
 *
 * Suite 1: All four server modules import without throwing.
 * Suite 2: resource list has 6 URIs, prompt list has 5 named entries.
 *
 * Standalone-runnable: node tools/selfcheck-mcp-006-imports.mjs
 * Exits non-zero on any failure.
 *
 * @module selfcheck-mcp-006-imports
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MCP_SERVER_DIR, makeReporter } from './selfcheck-mcp-006-helpers.mjs';

const { ok, bad, summary, hasFailed } = makeReporter();

// ─── Suite 1: module imports ─────────────────────────────────────────────────

console.log('\nSuite 1 — module imports');

let tools, resources, prompts;

try {
  tools = await import(pathToFileURL(resolve(MCP_SERVER_DIR, 'tools.read.mjs')).href);
  ok('tools.read.mjs imports');
} catch (err) {
  bad('tools.read.mjs imports', err.message);
  process.exit(1); // fatal — rest of tests depend on it
}

try {
  resources = await import(pathToFileURL(resolve(MCP_SERVER_DIR, 'resources.mjs')).href);
  ok('resources.mjs imports');
} catch (err) {
  bad('resources.mjs imports', err.message);
  process.exit(1);
}

try {
  prompts = await import(pathToFileURL(resolve(MCP_SERVER_DIR, 'prompts.mjs')).href);
  ok('prompts.mjs imports');
} catch (err) {
  bad('prompts.mjs imports', err.message);
  process.exit(1);
}

// ─── Suite 2: catalog completeness ───────────────────────────────────────────

console.log('\nSuite 2 — catalog completeness');

const EXPECTED_RESOURCE_URIS = [
  'contextdevkit://project/map',
  'contextdevkit://workflow/current',
  'contextdevkit://pipeline/working',
  'contextdevkit://memory/latest-session',
  'contextdevkit://decisions/catalog',
  'contextdevkit://business-rules',
];

if (resources.RESOURCE_LIST.length === 6) {
  ok('resource list has 6 entries');
} else {
  bad('resource list count', `expected 6, got ${resources.RESOURCE_LIST.length}`);
}

for (const uri of EXPECTED_RESOURCE_URIS) {
  if (resources.RESOURCE_LIST.some((r) => r.uri === uri)) {
    ok(`resource URI present: ${uri}`);
  } else {
    bad(`resource URI present: ${uri}`, 'not found in RESOURCE_LIST');
  }
}

const EXPECTED_PROMPTS = [
  'plan-feature',
  'review-architecture',
  'prepare-qa',
  'resume-task',
  'analyze-impact',
];

if (prompts.PROMPT_LIST.length === 5) {
  ok('prompt list has 5 entries');
} else {
  bad('prompt list count', `expected 5, got ${prompts.PROMPT_LIST.length}`);
}

for (const name of EXPECTED_PROMPTS) {
  if (prompts.PROMPT_LIST.some((p) => p.name === name)) {
    ok(`prompt present: ${name}`);
  } else {
    bad(`prompt present: ${name}`, 'not found in PROMPT_LIST');
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\nMCP-006/imports: ${summary()}\n`);
process.exit(hasFailed() ? 1 : 0);
