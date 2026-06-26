#!/usr/bin/env node
/**
 * ContextDevKit MCP Server — stdio transport (read-only). [MCP-006, ADR-0073]
 *
 * Cohesion note (constitution §1 +10% tolerance): this file is a pure
 * transport/dispatch layer. Every handler section (tool, resource, prompt,
 * lifecycle) belongs to the same responsibility — "route a JSON-RPC message
 * to the right module and write back the response." Splitting would scatter
 * the routing table across files with no real seam benefit.
 *
 * Implements the Model Context Protocol over JSON-RPC 2.0 on stdin/stdout.
 * Zero npm dependencies — pure node:* only. Every I/O is defensive; the
 * process exits 0 only on clean shutdown (stdin close). Errors are reported
 * as JSON-RPC error responses, never as unhandled rejections.
 *
 * Streamable HTTP is a clean seam: see the `transport` option comment below.
 *
 * Process contract:
 *   - stdin: newline-delimited JSON-RPC 2.0 requests
 *   - stdout: newline-delimited JSON-RPC 2.0 responses
 *   - stderr: optional diagnostic lines (never used on the happy path)
 *
 * Usage:
 *   node contextkit/mcp-server/server.mjs
 */
import { createInterface } from 'node:readline';

// Tool, resource, and prompt registries

import {
  getProjectState,
  getProjectMap,
  getModuleContext,
  getWorkflowStatus,
  getPipelineCards,
  getActiveClaims,
  getLatestSession,
  getRelevantDecisions,
  getContextPack,
  getQualityStatus,
} from './tools.read.mjs';
import { RESOURCE_LIST, readResource } from './resources.mjs';
import { PROMPT_LIST, getPrompt } from './prompts.mjs';

import { TOOL_LIST } from './tool-catalog.mjs';

// Tool dispatcher

/** Maps tool name → implementation function. */
const TOOL_HANDLERS = {
  get_project_state: () => getProjectState(),
  get_project_map: () => getProjectMap(),
  get_module_context: (args) => getModuleContext(args),
  get_workflow_status: (args) => getWorkflowStatus(args),
  get_pipeline_cards: (args) => getPipelineCards(args),
  get_active_claims: () => getActiveClaims(),
  get_latest_session: () => getLatestSession(),
  get_relevant_decisions: (args) => getRelevantDecisions(args),
  get_context_pack: () => getContextPack(),
  get_quality_status: () => getQualityStatus(),
};

// JSON-RPC helpers

const JSONRPC = '2.0';

/** Serialises a JSON-RPC 2.0 success response to stdout. */
function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: JSONRPC, id, result }) + '\n');
}

/** Serialises a JSON-RPC 2.0 error response to stdout. */
function replyError(id, code, message, data) {
  const error = data !== undefined ? { code, message, data } : { code, message };
  process.stdout.write(JSON.stringify({ jsonrpc: JSONRPC, id, error }) + '\n');
}

// MCP request router

/**
 * Routes an incoming JSON-RPC request to the appropriate MCP handler.
 * Returns a promise that resolves when the response has been written.
 *
 * @param {{ jsonrpc: string, id: number|string|null, method: string, params?: object }} req
 * @returns {Promise<void>}
 */
async function handleRequest(req) {
  const id = req.id ?? null;
  const method = req.method;
  const params = req.params ?? {};

  try {
    switch (method) {
      // MCP lifecycle
      case 'initialize': {
        reply(id, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
            prompts: { listChanged: false },
          },
          serverInfo: { name: 'contextdevkit', version: '1.0.0' },
        });
        break;
      }

      case 'notifications/initialized': {
        // Post-handshake notification (MCP 2024-11-05 spec) — no response required
        break;
      }

      case 'ping': {
        reply(id, {});
        break;
      }

      // Tools
      case 'tools/list': {
        reply(id, { tools: TOOL_LIST });
        break;
      }

      case 'tools/call': {
        const toolName = params.name;
        const toolArgs = params.arguments ?? {};
        const handler = TOOL_HANDLERS[toolName];
        if (!handler) {
          replyError(id, -32601, `Unknown tool: ${toolName}`);
          break;
        }
        const toolResult = await handler(toolArgs);
        reply(id, {
          content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }],
          isError: toolResult?.error != null,
        });
        break;
      }

      // Resources
      case 'resources/list': {
        reply(id, { resources: RESOURCE_LIST });
        break;
      }

      case 'resources/read': {
        const uri = params.uri;
        if (!uri) { replyError(id, -32602, 'Missing uri parameter'); break; }
        const resourceResult = await readResource(uri);
        reply(id, resourceResult);
        break;
      }

      // Prompts
      case 'prompts/list': {
        reply(id, { prompts: PROMPT_LIST });
        break;
      }

      case 'prompts/get': {
        const promptName = params.name;
        if (!promptName) { replyError(id, -32602, 'Missing name parameter'); break; }
        const promptArgs = params.arguments ?? {};
        let promptResult;
        try {
          promptResult = getPrompt(promptName, promptArgs);
        } catch (err) {
          replyError(id, -32601, String(err.message));
          break;
        }
        reply(id, promptResult);
        break;
      }

      // Streamable HTTP seam — NOT built. When wired, dispatch 'transport/http'
      // here. Zero impact on stdio. [MCP-006 AC4: "clean seam, NOT built"]

      default: {
        // Unknown method — per JSON-RPC 2.0 spec, reply with -32601
        if (id !== null) replyError(id, -32601, `Method not found: ${method}`);
        break;
      }
    }
  } catch (err) {
    // Internal error — always reply so the client is not left hanging
    replyError(id, -32603, 'Internal error', { message: err.message });
  }
}

// Stdin read loop
/**
 * Starts the MCP stdio server. Reads newline-delimited JSON-RPC messages from
 * stdin, processes them one at a time, and writes responses to stdout.
 * Exits cleanly when stdin closes (client disconnected).
 */
function startStdioServer() {
  const rl = createInterface({ input: process.stdin, terminal: false });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return; // ignore blank lines
    let req;
    try {
      req = JSON.parse(trimmed);
    } catch {
      // Malformed JSON — respond with parse error (id unknown → null)
      replyError(null, -32700, 'Parse error');
      return;
    }
    // Process asynchronously but do not await — allows pipelining while
    // maintaining single-thread ordering for each message's writes.
    handleRequest(req).catch((err) => {
      replyError(req?.id ?? null, -32603, 'Unhandled error', { message: err.message });
    });
  });

  rl.on('close', () => {
    // stdin closed — client disconnected; exit cleanly
    process.exit(0);
  });

  // Unhandled rejection guard — log to stderr, never crash (hook contract)
  process.on('unhandledRejection', (reason) => {
    process.stderr.write(`[contextdevkit-mcp] unhandledRejection: ${reason}\n`);
  });
}

// Entry point
startStdioServer();
