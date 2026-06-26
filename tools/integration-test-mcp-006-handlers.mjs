/**
 * integration-test-mcp-006-handlers.mjs — MCP-006 tool handler behavior (AC-1, AC-5).
 *
 * Covers Suite 5 from the original monolith:
 *   - Every exported tool handler is callable and returns non-null (happy path)
 *   - getModuleContext() without args returns { error: 'modulePath is required' }
 *   - getModuleContext() with unknown path returns { error } (graceful degradation)
 *   - getProjectMap on empty root returns an object with string .error (graceful)
 *   - getLatestSession on empty root returns an object with string .error (graceful)
 *   - getWorkflowStatus on empty root returns { workflows: [] }
 *   - getPipelineCards returns { tasks: [] }
 *   - getActiveClaims returns { sessions: [] }
 *   - getQualityStatus returns { receipts: [] }
 *
 * Run:  node tools/integration-test-mcp-006-handlers.mjs
 * Exits non-zero on any failure. Plain node:* — zero framework, zero deps.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { reporter } from './it-helpers.mjs';
import { MCP_SERVER_DIR } from './integration-test-mcp-006-helpers.mjs';

const { ok, bad, finish } = reporter();

console.log('\n[Suite 5] Tool handlers — behavior on empty project root (AC-1 + AC-5)\n');

// Import tools module — bail immediately if the module itself is broken.
let toolsMod;
try {
  toolsMod = await import(pathToFileURL(resolve(MCP_SERVER_DIR, 'tools.read.mjs')).href);
  ok('tools.read.mjs imports without error');
} catch (err) {
  bad(`tools.read.mjs import failed: ${err.message}`);
  process.exit(1);
}

// ─── 5a: Every handler callable, returns non-null ─────────────────────────────

const TOOL_CALLS = [
  ['getProjectState', () => toolsMod.getProjectState()],
  ['getProjectMap', () => toolsMod.getProjectMap()],
  ['getModuleContext (no args)', () => toolsMod.getModuleContext()],
  ['getModuleContext (with path)', () => toolsMod.getModuleContext({ modulePath: 'src/index.mjs' })],
  ['getWorkflowStatus', () => toolsMod.getWorkflowStatus()],
  ['getWorkflowStatus (slug)', () => toolsMod.getWorkflowStatus({ slug: 'test' })],
  ['getPipelineCards', () => toolsMod.getPipelineCards()],
  ['getPipelineCards (stage)', () => toolsMod.getPipelineCards({ stage: 'backlog' })],
  ['getActiveClaims', () => toolsMod.getActiveClaims()],
  ['getLatestSession', () => toolsMod.getLatestSession()],
  ['getRelevantDecisions', () => toolsMod.getRelevantDecisions()],
  ['getRelevantDecisions (query)', () => toolsMod.getRelevantDecisions({ query: 'stdio' })],
  ['getContextPack', () => toolsMod.getContextPack()],
  ['getQualityStatus', () => toolsMod.getQualityStatus()],
];

for (const [label, fn] of TOOL_CALLS) {
  try {
    const result = await fn();
    result !== null && result !== undefined
      ? ok(`${label} returns non-null`)
      : bad(`${label} returned null/undefined`);
  } catch (err) {
    bad(`${label} threw unexpectedly: ${err.message}`);
  }
}

// ─── 5b: getModuleContext failure modes ───────────────────────────────────────

const noPathResult = await toolsMod.getModuleContext();
noPathResult?.error === 'modulePath is required'
  ? ok('getModuleContext() without args returns { error: "modulePath is required" }')
  : bad(`getModuleContext() no-args error: expected "modulePath is required", got ${JSON.stringify(noPathResult)}`);

const noModResult = await toolsMod.getModuleContext({ modulePath: '__nonexistent_path_xyzzy__' });
typeof noModResult?.error === 'string'
  ? ok('getModuleContext() for unknown module returns { error }')
  : bad(`getModuleContext() for unknown module: expected { error }, got ${JSON.stringify(noModResult)}`);

// ─── 5c: Graceful degradation per-tool on empty project root ─────────────────

const mapResult = await toolsMod.getProjectMap();
typeof mapResult === 'object' && mapResult !== null
  ? ok('getProjectMap returns an object (artifact or graceful error)')
  : bad(`getProjectMap: expected object, got ${JSON.stringify(mapResult)}`);
if (mapResult?.error !== undefined) {
  typeof mapResult.error === 'string'
    ? ok('getProjectMap graceful error is a string')
    : bad(`getProjectMap error is not a string: ${JSON.stringify(mapResult.error)}`);
}

const sessionResult = await toolsMod.getLatestSession();
typeof sessionResult === 'object' && sessionResult !== null
  ? ok('getLatestSession returns an object (session data or graceful error)')
  : bad(`getLatestSession: expected object, got ${JSON.stringify(sessionResult)}`);
if (sessionResult?.error !== undefined) {
  typeof sessionResult.error === 'string'
    ? ok('getLatestSession graceful error is a string')
    : bad(`getLatestSession error is not a string: ${JSON.stringify(sessionResult.error)}`);
}

const wfResult = await toolsMod.getWorkflowStatus();
Array.isArray(wfResult?.workflows)
  ? ok('getWorkflowStatus on empty root returns workflows array')
  : bad(`getWorkflowStatus on empty root: expected { workflows: [] }, got ${JSON.stringify(wfResult)}`);

const pcResult = await toolsMod.getPipelineCards();
Array.isArray(pcResult?.tasks)
  ? ok('getPipelineCards returns tasks array')
  : bad(`getPipelineCards: expected { tasks: [] }, got ${JSON.stringify(pcResult)}`);

const claimsResult = await toolsMod.getActiveClaims();
Array.isArray(claimsResult?.sessions)
  ? ok('getActiveClaims returns sessions array')
  : bad(`getActiveClaims: expected { sessions: [] }, got ${JSON.stringify(claimsResult)}`);

const qsResult = await toolsMod.getQualityStatus();
Array.isArray(qsResult?.receipts)
  ? ok('getQualityStatus returns receipts array')
  : bad(`getQualityStatus: expected { receipts: [] }, got ${JSON.stringify(qsResult)}`);

// ─── Done ─────────────────────────────────────────────────────────────────────

finish('MCP-006 handlers integration test');
