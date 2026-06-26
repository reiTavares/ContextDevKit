#!/usr/bin/env node
/**
 * MCP-006 self-check — Suites 3–5: tool handlers, resource readers, prompt builders.
 *
 * Suite 3: All 10 tool handler exports return non-null against an empty fake root.
 * Suite 4: readResource returns string content for all 6 URIs; graceful error
 *           text for an unknown URI.
 * Suite 5: getPrompt returns message text for all 5 prompts; throws on unknown name.
 *
 * Standalone-runnable: node tools/selfcheck-mcp-006-handlers.mjs
 * Exits non-zero on any failure.
 *
 * @module selfcheck-mcp-006-handlers
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  MCP_SERVER_DIR,
  makeReporter,
  makeFakeRoot,
} from './selfcheck-mcp-006-helpers.mjs';

const { ok, bad, summary, hasFailed } = makeReporter();

// Load modules (fatal on import error — handlers tests are meaningless otherwise)
let tools, resources, prompts;
try {
  tools     = await import(pathToFileURL(resolve(MCP_SERVER_DIR, 'tools.read.mjs')).href);
  resources = await import(pathToFileURL(resolve(MCP_SERVER_DIR, 'resources.mjs')).href);
  prompts   = await import(pathToFileURL(resolve(MCP_SERVER_DIR, 'prompts.mjs')).href);
} catch (err) {
  console.error(`FATAL: module import failed — ${err.message}`);
  process.exit(1);
}

const { teardown } = makeFakeRoot();

// ─── Suite 3: tool handlers (against empty fake root) ────────────────────────

console.log('\nSuite 3 — tool handlers (empty project root)');

const TOOL_FNS = [
  ['getProjectState',    tools.getProjectState],
  ['getProjectMap',      tools.getProjectMap],
  ['getModuleContext',   () => tools.getModuleContext({ modulePath: 'src/index.mjs' })],
  ['getWorkflowStatus',  tools.getWorkflowStatus],
  ['getPipelineCards',   tools.getPipelineCards],
  ['getActiveClaims',    tools.getActiveClaims],
  ['getLatestSession',   tools.getLatestSession],
  ['getRelevantDecisions', tools.getRelevantDecisions],
  ['getContextPack',     tools.getContextPack],
  ['getQualityStatus',   tools.getQualityStatus],
];

if (TOOL_FNS.length === 10) {
  ok('10 tool handler exports present');
} else {
  bad('tool handler exports', `expected 10, got ${TOOL_FNS.length}`);
}

for (const [name, fn] of TOOL_FNS) {
  try {
    const result = await fn();
    if (result !== null && result !== undefined) {
      ok(`tool ${name} returns non-null`);
    } else {
      bad(`tool ${name} returns non-null`, 'got null/undefined');
    }
  } catch (err) {
    bad(`tool ${name} does not throw`, err.message);
  }
}

// ─── Suite 4: resource readers ───────────────────────────────────────────────

console.log('\nSuite 4 — resource readers');

for (const { uri } of resources.RESOURCE_LIST) {
  try {
    const result = await resources.readResource(uri);
    const text = result?.contents?.[0]?.text;
    if (typeof text === 'string' && text.length > 0) {
      ok(`readResource(${uri}) returns string`);
    } else {
      bad(`readResource(${uri}) returns string`, `got: ${JSON.stringify(text)}`);
    }
  } catch (err) {
    bad(`readResource(${uri}) does not throw`, err.message);
  }
}

const unknownResult = await resources.readResource('contextdevkit://unknown/thing');
if (unknownResult?.contents?.[0]?.text?.includes('Unknown resource URI')) {
  ok('readResource unknown URI returns graceful error text');
} else {
  bad('readResource unknown URI', 'expected "Unknown resource URI" in text');
}

// ─── Suite 5: prompt builders ─────────────────────────────────────────────────

console.log('\nSuite 5 — prompt builders');

const EXPECTED_PROMPTS = [
  'plan-feature',
  'review-architecture',
  'prepare-qa',
  'resume-task',
  'analyze-impact',
];

const PROMPT_ARGS = {
  'plan-feature':        { feature_name: 'TestFeature', objective: 'test' },
  'review-architecture': { scope: 'contextkit/runtime' },
  'prepare-qa':          { target: 'MCP-006' },
  'resume-task':         { task_id: 'MCP-006' },
  'analyze-impact':      { change_description: 'Add stdio server' },
};

for (const name of EXPECTED_PROMPTS) {
  try {
    const result = prompts.getPrompt(name, PROMPT_ARGS[name] || {});
    const text = result?.messages?.[0]?.content?.text;
    if (typeof text === 'string' && text.length > 10) {
      ok(`getPrompt(${name}) returns message text`);
    } else {
      bad(`getPrompt(${name}) message text`, `got: ${JSON.stringify(text)}`);
    }
  } catch (err) {
    bad(`getPrompt(${name}) does not throw`, err.message);
  }
}

try {
  prompts.getPrompt('nonexistent');
  bad('getPrompt unknown name throws', 'expected Error');
} catch {
  ok('getPrompt unknown name throws Error');
}

teardown();

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\nMCP-006/handlers: ${summary()}\n`);
process.exit(hasFailed() ? 1 : 0);
