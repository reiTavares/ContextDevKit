/**
 * MCP server — tool catalog (JSON Schema descriptors advertised to the client).
 *
 * Cohesion note: pure data, extracted from server.mjs so the server entry stays
 * under the 308-line RED ceiling (constitution section 1). The handler map (which
 * binds these names to implementations) stays in server.mjs next to its imports.
 * node:* only — zero runtime deps.
 *
 * @module tool-catalog
 */

/** @type {Array<object>} MCP read-tool descriptors in JSON Schema format. */
export const TOOL_LIST = [
  {
    name: 'get_project_state',
    description: 'Returns the ContextDevKit config, level, and ADR count for the current project.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_project_map',
    description: 'Returns the saved project-map manifest (modules, deps, insights). Run /project-map first.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_module_context',
    description: 'Returns structural info for a specific module path from the project map.',
    inputSchema: {
      type: 'object',
      properties: {
        modulePath: { type: 'string', description: 'Relative path (or substring) of the module' },
      },
      required: ['modulePath'],
    },
  },
  {
    name: 'get_workflow_status',
    description: 'Lists all workflows and their current phase. Optionally filter by slug.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Workflow slug to filter (optional)' },
      },
      required: [],
    },
  },
  {
    name: 'get_pipeline_cards',
    description: 'Returns DevPipeline tasks. Optionally filter by stage (backlog/working/testing/conclusion).',
    inputSchema: {
      type: 'object',
      properties: {
        stage: { type: 'string', enum: ['backlog', 'working', 'testing', 'conclusion'], description: 'Pipeline stage' },
      },
      required: [],
    },
  },
  {
    name: 'get_active_claims',
    description: 'Returns active workspace path and task claims across all sessions.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_latest_session',
    description: 'Returns the content of the most recently registered session log.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_relevant_decisions',
    description: 'Searches the ADR catalog by keyword and returns matching records.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword(s) to match against ADR titles and decisions' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
      required: [],
    },
  },
  {
    name: 'get_context_pack',
    description: 'Returns the bounded start-of-work context bundle (session + changelog + ADRs + backlog).',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_quality_status',
    description: 'Returns QA gate receipts and quality snapshot if available.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  // Structural knowledge graph (WF-0108 / ADR-0155). `mcpGraphTool` already
  // implemented these traversals; before this they were unreachable over MCP
  // because the catalog never advertised them. Locating code through the graph is
  // MANDATORY (graph-first), so the graph must be reachable on every surface —
  // an absent projection returns `{available:false}`, never a fabricated answer.
  {
    name: 'query_graph',
    description: 'GRAPH-FIRST: find nodes (files/symbols) by substring before any broad text search. Returns matching node ids from the committed structural graph.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Substring to match against node ids (e.g. a symbol or file name)' },
      },
      required: ['q'],
    },
  },
  {
    name: 'get_node',
    description: 'Returns one structural-graph node by exact id (e.g. "sym:src/a.ts#doThing" or "file:src/a.ts").',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Exact node id' } },
      required: ['id'],
    },
  },
  {
    name: 'get_neighbors',
    description: 'Returns a bounded, hub-avoiding neighborhood of a node — the cheap way to understand local structure.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Node id to expand from' },
        budget: { type: 'number', description: 'Max nodes to return (default 40)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'shortest_path',
    description: 'Returns the shortest structural path between two graph nodes.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Source node id' },
        to: { type: 'string', description: 'Target node id' },
      },
      required: ['id', 'to'],
    },
  },
  {
    name: 'affected',
    description: 'Returns reverse consumers of a node — who breaks if it changes (blast radius).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Node id to analyse' } },
      required: ['id'],
    },
  },
  {
    name: 'god_nodes',
    description: 'Returns the most-connected graph nodes — structural hotspots worth reviewing.',
    inputSchema: {
      type: 'object',
      properties: { topN: { type: 'number', description: 'How many to return (default 10)' } },
      required: [],
    },
  },
];
