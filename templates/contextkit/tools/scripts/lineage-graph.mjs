#!/usr/bin/env node
/**
 * lineage-graph.mjs — I/O orchestration + CLI for CDK-070.
 *
 * Composes existing defensive readers into a typed lineage graph:
 *   ADR → workflow → card → { session, receipt } → telemetry
 *
 * Design decisions:
 *   - Read-only: no writes to any source store.
 *   - Fail-open: every reader is wrapped; a throw or missing store → [] and the
 *     store name goes into stats.sources.skipped (§8: skipped ≠ pass, skipped ≠ present).
 *   - Advisory: the CLI always exits 0. The graph is UNREGISTERED (no gate wires this).
 *   - Paths resolved exclusively via pathsFor() — no 'contextkit/' literals in
 *     resolve()/join() (immutable rule 4).
 *
 * Zero runtime dependencies — node:* + existing kit readers only.
 * ADR-0072 / CDK-070. ≤ 308 lines.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pathsFor } from '../../runtime/config/paths.mjs';
import { parseAdr, ADR_FILENAME_RE } from './adr-digest-core.mjs';
import { listWorkflows } from './workflow-pack.mjs';
import { listTasks } from './pipeline-tasks.mjs';
import { readState } from '../../runtime/state/state-io.mjs';
import { readReceipts } from '../../runtime/execution/receipt-store.mjs';

import {
  buildNodes, buildEdges, computeStats, subgraphFrom, renderDigest,
} from './lineage-graph-core.mjs';

// ---------------------------------------------------------------------------
// Session reader (inline — session-reindex.mjs is a script, not a lib exporter)
// ---------------------------------------------------------------------------

/** ENTRY_PATTERN mirrors session-reindex.mjs — single source of truth for format. */
const ENTRY_PATTERN = /^(\d{4}-\d{2}-\d{2})-(\d{2,})-([a-z0-9._-]+)\.md$/;

/**
 * Lists available sessions by scanning the sessions directory.
 * Never throws; returns [] on any I/O error.
 *
 * @param {string} sessionsDir  absolute path to contextkit/memory/sessions/
 * @returns {Array<{ number: number, slug: string, title: string, date: string }>}
 */
function listSessions(sessionsDir) {
  let files = [];
  try { files = readdirSync(sessionsDir); } catch { return []; }
  const sessions = [];
  for (const filename of files) {
    const match = ENTRY_PATTERN.exec(filename);
    if (!match) continue;
    const [, date, numberStr, slug] = match;
    let title = slug;
    try {
      const content = readFileSync(resolve(sessionsDir, filename), 'utf-8');
      const heading = content.split('\n').find((l) => l.startsWith('# '));
      if (heading) title = heading.slice(2).trim();
    } catch { /* leave title = slug */ }
    sessions.push({ number: Number.parseInt(numberStr, 10), slug, title, date });
  }
  return sessions;
}

// ---------------------------------------------------------------------------
// ADR reader
// ---------------------------------------------------------------------------

/**
 * Lists all parsed ADRs from the decisions directory.
 * Never throws; returns [] on any I/O error.
 *
 * @param {string} decisionsDir  absolute path to contextkit/memory/decisions/
 * @returns {Array<object>}
 */
function listAdrs(decisionsDir) {
  let files = [];
  try { files = readdirSync(decisionsDir); } catch { return []; }
  const adrs = [];
  for (const filename of files) {
    if (!ADR_FILENAME_RE.test(filename) || filename === '_TEMPLATE.md') continue;
    try {
      const text = readFileSync(resolve(decisionsDir, filename), 'utf-8');
      adrs.push(parseAdr(text, filename));
    } catch { /* skip unparseable */ }
  }
  return adrs;
}

// ---------------------------------------------------------------------------
// Source collector
// ---------------------------------------------------------------------------

/**
 * Collects all sources defensively. A missing store → [] + name in skipped.
 * Cards get ownerSessionId attached from state.json.
 * Telemetry is SKIPPED when no on-disk log is discoverable.
 *
 * @param {string} root  project root (absolute)
 * @returns {{ adrs:any[], workflows:any[], cards:any[], receipts:any[], sessions:any[], telemetry:any[], _sources:{ present:string[], skipped:string[] } }}
 */
export async function collectSources(root) {
  const p = pathsFor(root);
  const present = [];
  const skipped = [];

  function wrap(name, fn) {
    try {
      const result = fn();
      if (Array.isArray(result) && result.length > 0) present.push(name);
      else skipped.push(name);
      return Array.isArray(result) ? result : [];
    } catch {
      skipped.push(name);
      return [];
    }
  }

  // ADRs
  const adrs = wrap('adrs', () => listAdrs(p.decisions));

  // Workflows
  const workflows = wrap('workflows', () => listWorkflows(root));

  // Cards — attach ownerSessionId from state.json
  const rawCards = wrap('cards', () => listTasks(p.pipeline));
  const cards = rawCards.map((card) => {
    let ownerSessionId = null;
    try {
      const state = readState(p.pipeline, card.id);
      ownerSessionId = state?.ownerSessionId ?? null;
    } catch { /* leave null */ }
    return { ...card, ownerSessionId };
  });
  // Re-count cards accurately (rawCards counted above; cards is same length)

  // Receipts — one readReceipts call per card id
  let allReceipts = [];
  try {
    const cardIds = rawCards.map((c) => c.id).filter(Boolean);
    for (const cardId of cardIds) {
      const receipts = readReceipts(root, cardId);
      if (Array.isArray(receipts)) allReceipts.push(...receipts);
    }
    if (allReceipts.length > 0) {
      if (!present.includes('receipts')) present.push('receipts');
    } else {
      if (!skipped.includes('receipts')) skipped.push('receipts');
    }
  } catch {
    if (!skipped.includes('receipts')) skipped.push('receipts');
  }

  // Sessions
  const sessions = wrap('sessions', () => listSessions(p.sessions));

  // Telemetry — attempt to read an optional JSONL log; mark skipped if absent
  const telemetry = [];
  const teleLogPath = resolve(p.scripts, 'telemetry', 'usage.jsonl');
  if (existsSync(teleLogPath)) {
    try {
      const lines = readFileSync(teleLogPath, 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        try { telemetry.push(JSON.parse(line)); } catch { /* skip malformed */ }
      }
      if (telemetry.length > 0) present.push('telemetry');
      else skipped.push('telemetry');
    } catch {
      skipped.push('telemetry');
    }
  } else {
    skipped.push('telemetry');
  }

  return { adrs, workflows, cards, receipts: allReceipts, sessions, telemetry, _sources: { present, skipped } };
}

// ---------------------------------------------------------------------------
// Public builder
// ---------------------------------------------------------------------------

/**
 * Builds the complete lineage graph (or a subgraph) for the given root.
 *
 * @param {string} root  absolute project root
 * @param {{ cardId?: string, adr?: string }} [opts]
 * @returns {Promise<{ nodes: object[], edges: object[], stats: object }>}
 */
export async function buildLineage(root, opts) {
  const sources = await collectSources(root);
  const nodes = buildNodes(sources);
  const edges = buildEdges(sources, nodes);
  const coreStats = computeStats(nodes, edges);
  const graph = {
    nodes,
    edges,
    stats: { ...coreStats, sources: sources._sources },
  };
  if (opts?.cardId) return subgraphFrom(graph, `card:${opts.cardId}`);
  if (opts?.adr) return subgraphFrom(graph, `adr:${opts.adr}`);
  return graph;
}

// ---------------------------------------------------------------------------
// CLI — advisory, always exits 0
// ---------------------------------------------------------------------------

/**
 * Determines if this module is the direct entrypoint.
 * Guards CLI code so imports don't trigger the CLI.
 */
function isMain() {
  if (!process.argv[1]) return false;
  try {
    return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
  } catch { return false; }
}

if (isMain()) {
  const args = process.argv.slice(2);
  const jsonFlag = args.includes('--json');
  const cardIdx = args.indexOf('--card');
  const adrIdx = args.indexOf('--adr');
  const cardId = cardIdx >= 0 ? args[cardIdx + 1] : undefined;
  const adrNum = adrIdx >= 0 ? args[adrIdx + 1] : undefined;

  const root = process.cwd();
  buildLineage(root, { cardId, adr: adrNum })
    .then((graph) => {
      if (jsonFlag) {
        console.log(JSON.stringify(graph, null, 2));
      } else {
        console.log(renderDigest(graph));
      }
      process.exit(0);
    })
    .catch((err) => {
      // Fail-open: log to stderr, exit 0 (advisory tool, never breaks real work)
      process.stderr.write(`[lineage-graph] unexpected error: ${err?.message ?? err}\n`);
      process.exit(0);
    });
}
