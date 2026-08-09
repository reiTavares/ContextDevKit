#!/usr/bin/env node
/**
 * Self-test for graph-consumers.mjs (IF2, WF-0072/BIZ-0004) — standalone
 * entrypoint (exit 0/1), sibling-dispatched like the other WF-0072 selfchecks.
 *
 * Writes a real committed projection under a temp root (so loadProjection reads
 * it) and asserts each consumer adapter returns the correct structural result;
 * then asserts EVERY adapter degrades to {available:false} when the projection
 * is absent — never a fabricated caller / consumer / packet / MCP payload.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dir, '..');
const consumersPath = resolve(KIT, 'templates/contextkit/tools/scripts/graph-consumers.mjs');

/** Writes a fixture graph.json under a temp root's projectMap dir; returns the root. */
function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'graph-consumers-'));
  const dir = join(root, 'contextkit', 'memory', 'project-map', 'graph');
  mkdirSync(dir, { recursive: true });
  const projection = {
    schemaVersion: 1, graphSignature: 'abc123',
    nodes: [{ id: 'sym:svc/a.js#target' }, { id: 'sym:svc/b.js#caller' }, { id: 'file:svc/b.js' }, { id: 'sym:svc/c.js#other' }],
    edges: [
      { source: 'sym:svc/b.js#caller', target: 'sym:svc/a.js#target', relation: 'calls' },
      { source: 'file:svc/b.js', target: 'sym:svc/a.js#target', relation: 'imports' },
      { source: 'sym:svc/c.js#other', target: 'sym:svc/b.js#caller', relation: 'calls' },
    ],
  };
  writeFileSync(join(dir, 'graph.json'), JSON.stringify(projection, null, 2) + '\n', 'utf-8');
  return root;
}

function findImportSpecifiers(source) {
  const out = [];
  for (const raw of source.split(String.fromCharCode(10))) {
    const line = raw.trim();
    if (line.indexOf('import ') !== 0 && line.indexOf('} from') === -1) continue;
    const fromAt = line.lastIndexOf('from ');
    if (fromAt === -1) continue;
    const rest = line.slice(fromAt + 5).trim();
    const q = rest.charAt(0);
    if (q !== String.fromCharCode(39) && q !== String.fromCharCode(34)) continue;
    const closeAt = rest.indexOf(q, 1);
    if (closeAt === -1) continue;
    out.push(rest.slice(1, closeAt));
  }
  return out;
}

export async function runGraphConsumersChecks() {
  const results = [];
  const record = (name, pass, detail) => results.push({ name, pass, detail });

  let m;
  try { m = await import(pathToFileURL(consumersPath).href); } catch (err) {
    record('module import', false, 'failed: ' + (err?.message ?? err));
    return results;
  }
  record('module import', true, 'graph-consumers imported');

  const root = fixtureRoot();
  try {
    const impact = m.impactReport(root, 'sym:svc/a.js#target');
    const impactOk = impact.available
      && JSON.stringify(impact.callers) === JSON.stringify(['sym:svc/b.js#caller'])
      && impact.consumers.includes('file:svc/b.js') && impact.consumers.includes('sym:svc/b.js#caller')
      && impact.blastRadius === 2;
    record('impactReport: reverse callers + consumers + blast radius', impactOk,
      'callers=' + JSON.stringify(impact.callers) + ' blast=' + impact.blastRadius);

    const contract = m.contractReverseConsumers(root, 'sym:svc/a.js#target');
    record('contractReverseConsumers: breaks=true with real consumers', contract.available && contract.breaks === true && contract.consumers.length === 2,
      'breaks=' + contract.breaks + ' consumers=' + contract.consumers.length);

    const packet = m.packetNeighborhood(root, 'sym:svc/a.js#target', 40);
    const packetOk = packet.available && packet.nodes.includes('sym:svc/a.js#target') && packet.size > 1;
    record('packetNeighborhood: bounded neighborhood around seed', packetOk, 'size=' + packet.size);

    const gods = m.mcpGraphTool(root, 'god_nodes', { topN: 2 });
    const affected = m.mcpGraphTool(root, 'affected', { id: 'sym:svc/a.js#target' });
    const node = m.mcpGraphTool(root, 'get_node', { id: 'file:svc/b.js' });
    const query = m.mcpGraphTool(root, 'query_graph', { q: 'svc/b.js' });
    const mcpOk = gods.available && gods.godNodes.length === 2
      && affected.available && affected.consumers.length === 2
      && node.available && node.node && node.node.id === 'file:svc/b.js'
      && query.available && query.matches.length >= 1;
    record('mcpGraphTool: god_nodes/affected/get_node/query_graph return structural results', mcpOk,
      'gods=' + gods.godNodes.length + ' affected=' + affected.consumers.length + ' query=' + query.matches.length);

    const unknownTool = m.mcpGraphTool(root, 'not_a_tool');
    record('mcpGraphTool: unknown tool -> {available:false}, never throws', unknownTool.available === false,
      JSON.stringify(unknownTool.reason));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  // Degrade path: a temp root with NO projection.
  const empty = mkdtempSync(join(tmpdir(), 'graph-consumers-empty-'));
  try {
    const degrade = [
      m.impactReport(empty, 'sym:x#f'), m.contractReverseConsumers(empty, 'file:x'),
      m.packetNeighborhood(empty, 'sym:x#f'), m.mcpGraphTool(empty, 'god_nodes'),
      m.mcpGraphTool(empty, 'affected', { id: 'sym:x#f' }),
    ].every((r) => r.available === false && typeof r.reason === 'string');
    record('EVERY adapter degrades to {available:false} on absent projection', degrade,
      degrade ? 'all degrade, no fabrication' : 'an adapter fabricated a result');
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }

  const violations = findImportSpecifiers(readFileSync(consumersPath, 'utf-8'))
    .filter((s) => s.indexOf('node:') !== 0 && s.charAt(0) !== '.');
  record('zero-dep invariant (node:* + relative siblings only)', violations.length === 0,
    violations.length === 0 ? 'clean' : violations.join(', '));

  return results;
}

if (process.argv[1]?.endsWith('selfcheck-graph-consumers.mjs')) {
  const results = await runGraphConsumersChecks();
  let failCount = 0;
  for (const r of results) {
    console.log((r.pass ? '  ok ' : '  XX ') + r.name + ' -- ' + r.detail);
    if (!r.pass) failCount += 1;
  }
  console.log();
  console.log(results.length + ' checks -- ' + (results.length - failCount) + ' pass / ' + failCount + ' fail');
  console.log();
  console.log(failCount > 0 ? 'FAIL' : 'PASS');
  process.exit(failCount > 0 ? 1 : 0);
}
