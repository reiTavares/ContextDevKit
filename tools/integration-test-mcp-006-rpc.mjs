/**
 * integration-test-mcp-006-rpc.mjs — MCP-006 resource/prompt readers + stdio JSON-RPC (AC-2/3/4).
 *
 * Covers:
 *   Suite 6 — Resource readers: readResource happy + unknown URI graceful error (AC-2)
 *   Suite 7 — Prompt builders: happy path + empty args + unknown name throws (AC-3)
 *   Suite 8 — stdio JSON-RPC end-to-end handshake:
 *               initialize / tools/list / resources/list / prompts/list /
 *               tools/call / resources/read / prompts/get / ping /
 *               unknown method (-32601) / unknown tool (-32601) /
 *               missing uri (-32602) / missing name (-32602) / malformed JSON (-32700)
 *
 * Run:  node tools/integration-test-mcp-006-rpc.mjs
 * Exits non-zero on any failure. Plain node:* — zero framework, zero deps.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { reporter } from './it-helpers.mjs';
import {
  MCP_SERVER_DIR,
  SERVER_PATH,
  EXPECTED_RESOURCE_URIS,
  EXPECTED_PROMPT_NAMES,
} from './integration-test-mcp-006-helpers.mjs';

const { ok, bad, finish } = reporter();

// ─── Import modules (bail on failure) ─────────────────────────────────────────

let resourcesMod, promptsMod;
try {
  resourcesMod = await import(pathToFileURL(resolve(MCP_SERVER_DIR, 'resources.mjs')).href);
} catch (err) {
  bad(`resources.mjs import failed: ${err.message}`);
  process.exit(1);
}
try {
  promptsMod = await import(pathToFileURL(resolve(MCP_SERVER_DIR, 'prompts.mjs')).href);
} catch (err) {
  bad(`prompts.mjs import failed: ${err.message}`);
  process.exit(1);
}

// ─── Suite 6: Resource readers — happy + failure modes (AC-2) ─────────────────

console.log('\n[Suite 6] Resource readers — graceful degradation (AC-2)\n');

for (const { uri } of resourcesMod.RESOURCE_LIST) {
  try {
    const result = await resourcesMod.readResource(uri);
    const text = result?.contents?.[0]?.text;
    typeof text === 'string' && text.length > 0
      ? ok(`readResource(${uri}) returns non-empty text`)
      : bad(`readResource(${uri}): expected non-empty text, got ${JSON.stringify(text)}`);
    result?.contents?.[0]?.uri === uri
      ? ok(`readResource(${uri}) echoes URI in contents`)
      : bad(`readResource(${uri}): contents[0].uri should be ${uri}`);
    typeof result?.contents?.[0]?.mimeType === 'string'
      ? ok(`readResource(${uri}) includes mimeType`)
      : bad(`readResource(${uri}): missing mimeType`);
  } catch (err) {
    bad(`readResource(${uri}) threw: ${err.message}`);
  }
}

const unknownResult = await resourcesMod.readResource('contextdevkit://unknown/thing');
typeof unknownResult?.contents?.[0]?.text === 'string' &&
  unknownResult.contents[0].text.includes('Unknown resource URI')
  ? ok('readResource(unknown URI) returns "Unknown resource URI" text')
  : bad(`readResource(unknown URI): expected "Unknown resource URI" text, got ${JSON.stringify(unknownResult)}`);

// ─── Suite 7: Prompt builders — happy + failure modes (AC-3) ─────────────────

console.log('\n[Suite 7] Prompt builders — behavior (AC-3)\n');

const PROMPT_ARGS = {
  'plan-feature': { feature_name: 'MCP-006', objective: 'expose kit as MCP server' },
  'review-architecture': { scope: 'contextkit/mcp-server', focus: 'zero-dep contract' },
  'prepare-qa': { target: 'MCP-006', risk_level: 'high' },
  'resume-task': { task_id: 'MCP-006' },
  'analyze-impact': { change_description: 'add stdio server', paths: 'mcp-server/server.mjs' },
};

for (const name of EXPECTED_PROMPT_NAMES) {
  try {
    const result = promptsMod.getPrompt(name, PROMPT_ARGS[name] ?? {});
    Array.isArray(result?.messages) && result.messages.length > 0
      ? ok(`getPrompt(${name}) returns messages array`)
      : bad(`getPrompt(${name}): expected messages array, got ${JSON.stringify(result)}`);
    const text = result?.messages?.[0]?.content?.text;
    typeof text === 'string' && text.length > 20
      ? ok(`getPrompt(${name}) messages[0] has non-trivial text`)
      : bad(`getPrompt(${name}): text too short or missing`);
    result?.messages?.[0]?.role === 'user'
      ? ok(`getPrompt(${name}) messages[0].role is "user"`)
      : bad(`getPrompt(${name}): expected role "user", got ${result?.messages?.[0]?.role}`);
    result?.messages?.[0]?.content?.type === 'text'
      ? ok(`getPrompt(${name}) content.type is "text"`)
      : bad(`getPrompt(${name}): expected content.type "text"`);
  } catch (err) {
    bad(`getPrompt(${name}) threw: ${err.message}`);
  }
}

try {
  const minimal = promptsMod.getPrompt('plan-feature', {});
  typeof minimal?.messages?.[0]?.content?.text === 'string'
    ? ok('getPrompt(plan-feature, {}) handles missing args with defaults')
    : bad('getPrompt(plan-feature, {}) returned unexpected shape');
} catch (err) {
  bad(`getPrompt(plan-feature, {}) threw on empty args: ${err.message}`);
}

try {
  promptsMod.getPrompt('not-a-real-prompt', {});
  bad('getPrompt(unknown) did not throw');
} catch (_err) {
  ok('getPrompt(unknown name) throws Error');
}

// ─── Suite 8: stdio JSON-RPC end-to-end handshake (AC-4) ─────────────────────

console.log('\n[Suite 8] stdio JSON-RPC end-to-end (AC-4)\n');

await new Promise((resolveTest) => {
  const child = spawn(process.execPath, [SERVER_PATH], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  const rl = createInterface({ input: child.stdout, terminal: false });
  const responses = [];
  rl.on('line', (line) => {
    try { responses.push(JSON.parse(line.trim())); } catch { /* skip non-JSON */ }
  });

  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', clientInfo: { name: 'test-harness', version: '0.0.0' }, capabilities: {} } },
    { jsonrpc: '2.0', method: 'initialized', params: {} },
    { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} },
    { jsonrpc: '2.0', id: 4, method: 'resources/list', params: {} },
    { jsonrpc: '2.0', id: 5, method: 'prompts/list', params: {} },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'get_project_state', arguments: {} } },
    { jsonrpc: '2.0', id: 7, method: 'resources/read', params: { uri: 'contextdevkit://memory/latest-session' } },
    { jsonrpc: '2.0', id: 8, method: 'prompts/get', params: { name: 'prepare-qa', arguments: { target: 'MCP-006' } } },
    { jsonrpc: '2.0', id: 9, method: 'ping', params: {} },
    { jsonrpc: '2.0', id: 10, method: 'totally/unknown', params: {} },
    { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'does_not_exist', arguments: {} } },
    { jsonrpc: '2.0', id: 12, method: 'resources/read', params: {} },
    { jsonrpc: '2.0', id: 13, method: 'prompts/get', params: {} },
  ];

  for (const req of requests) child.stdin.write(JSON.stringify(req) + '\n');
  child.stdin.write('{ this is not json }\n');
  setTimeout(() => { child.stdin.end(); }, 3000);

  child.on('close', () => {
    const byId = Object.fromEntries(
      responses.filter((r) => r.id != null).map((r) => [r.id, r])
    );

    byId[1]?.result?.protocolVersion === '2024-11-05'
      ? ok('initialize: protocolVersion is 2024-11-05')
      : bad(`initialize: bad protocolVersion — ${JSON.stringify(byId[1])}`);
    byId[1]?.result?.serverInfo?.name === 'contextdevkit'
      ? ok('initialize: serverInfo.name is contextdevkit')
      : bad(`initialize: serverInfo.name wrong — ${byId[1]?.result?.serverInfo?.name}`);
    byId[1]?.result?.capabilities?.tools !== undefined
      ? ok('initialize: capabilities.tools present')
      : bad('initialize: capabilities.tools missing');

    const toolNames = (byId[3]?.result?.tools || []).map((t) => t.name);
    toolNames.length === 10
      ? ok('tools/list: 10 tools returned')
      : bad(`tools/list: expected 10, got ${toolNames.length} — [${toolNames.join(', ')}]`);
    for (const name of ['get_project_state', 'get_project_map', 'get_module_context',
      'get_workflow_status', 'get_pipeline_cards', 'get_active_claims',
      'get_latest_session', 'get_relevant_decisions', 'get_context_pack', 'get_quality_status']) {
      toolNames.includes(name)
        ? ok(`tools/list includes ${name}`)
        : bad(`tools/list missing ${name}`);
    }

    const resUris = (byId[4]?.result?.resources || []).map((r) => r.uri);
    resUris.length === 6
      ? ok('resources/list: 6 resources returned')
      : bad(`resources/list: expected 6, got ${resUris.length}`);
    for (const uri of EXPECTED_RESOURCE_URIS) {
      resUris.includes(uri)
        ? ok(`resources/list includes ${uri}`)
        : bad(`resources/list missing ${uri}`);
    }

    const promptNames = (byId[5]?.result?.prompts || []).map((p) => p.name);
    promptNames.length === 5
      ? ok('prompts/list: 5 prompts returned')
      : bad(`prompts/list: expected 5, got ${promptNames.length}`);
    for (const name of EXPECTED_PROMPT_NAMES) {
      promptNames.includes(name)
        ? ok(`prompts/list includes ${name}`)
        : bad(`prompts/list missing ${name}`);
    }

    const toolCallRes = byId[6]?.result;
    Array.isArray(toolCallRes?.content) && toolCallRes.content.length > 0
      ? ok('tools/call get_project_state: content array present')
      : bad(`tools/call get_project_state: unexpected result — ${JSON.stringify(byId[6])}`);
    toolCallRes?.content?.[0]?.type === 'text'
      ? ok('tools/call get_project_state: content[0].type is "text"')
      : bad('tools/call get_project_state: content[0].type wrong');
    typeof toolCallRes?.content?.[0]?.text === 'string'
      ? ok('tools/call get_project_state: content[0].text is a string')
      : bad('tools/call get_project_state: content[0].text missing');

    typeof byId[7]?.result?.contents?.[0]?.text === 'string'
      ? ok('resources/read latest-session: contents[0].text is a string')
      : bad(`resources/read latest-session: bad result — ${JSON.stringify(byId[7])}`);

    Array.isArray(byId[8]?.result?.messages) && byId[8].result.messages.length > 0
      ? ok('prompts/get prepare-qa: messages array returned')
      : bad(`prompts/get: bad result — ${JSON.stringify(byId[8])}`);

    JSON.stringify(byId[9]?.result) === '{}'
      ? ok('ping: returns empty object {}')
      : bad(`ping: expected {}, got ${JSON.stringify(byId[9]?.result)}`);

    byId[10]?.error?.code === -32601
      ? ok('unknown method: error code -32601')
      : bad(`unknown method: expected -32601, got ${byId[10]?.error?.code}`);
    byId[11]?.error?.code === -32601
      ? ok('unknown tool call: error code -32601')
      : bad(`unknown tool: expected -32601, got ${byId[11]?.error?.code}`);
    byId[12]?.error?.code === -32602
      ? ok('resources/read missing uri: error code -32602')
      : bad(`resources/read missing uri: expected -32602, got ${byId[12]?.error?.code}`);
    byId[13]?.error?.code === -32602
      ? ok('prompts/get missing name: error code -32602')
      : bad(`prompts/get missing name: expected -32602, got ${byId[13]?.error?.code}`);

    const parseErrResp = responses.find((r) => r.id === null && r.error?.code === -32700);
    parseErrResp
      ? ok('malformed JSON line: parse error -32700 with null id')
      : bad('malformed JSON line: expected response with id:null and code -32700');

    resolveTest();
  });

  child.on('error', (err) => {
    bad(`child process spawn failed: ${err.message}`);
    resolveTest();
  });
});

// ─── Done ─────────────────────────────────────────────────────────────────────

finish('MCP-006 rpc integration test');
