#!/usr/bin/env node
/** Canonical v4 lineage graph self-check. */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const directory = dirname(fileURLToPath(import.meta.url));
const kitRoot = resolve(directory, '..');
const importSource = (path) => import(pathToFileURL(resolve(kitRoot, path)).href);
const lineagePath = resolve(kitRoot, 'templates/contextkit/tools/scripts/lineage-graph.mjs');

let failures = 0;
const ok = (message) => console.log(`  ✓ ${message}`);
const bad = (message) => { console.error(`  ✗ ${message}`); failures += 1; };
const check = (condition, message) => condition ? ok(message) : bad(message);

const { buildLineage } = await importSource('templates/contextkit/tools/scripts/lineage-graph.mjs');
const { buildNodes, buildEdges, computeStats, subgraphFrom } = await importSource(
  'templates/contextkit/tools/scripts/lineage-graph-core.mjs',
);
const { createWaveWorkflow } = await importSource('templates/contextkit/tools/scripts/workflow/create.mjs');
const { addTask } = await importSource('templates/contextkit/tools/scripts/tasks-store.mjs');

const ADR_NUMBER = '0072';
const WORKFLOW_ID = 'WF-0028';
const WORKFLOW_SLUG = 'lineage';
const TASK_ID = 'CDK-070';
const SESSION_NUMBER = '42';
const NOW = '2026-01-01T00:00:00.000Z';

/** Creates a real v4 workflow/task authority plus authored ADR/session evidence. */
function buildFixtureRoot() {
  const root = resolve(tmpdir(), `selfcheck-lineage-${Date.now()}`);
  const decisions = resolve(root, 'contextkit', 'memory', 'decisions');
  const sessions = resolve(root, 'contextkit', 'memory', 'sessions');
  mkdirSync(decisions, { recursive: true });
  mkdirSync(sessions, { recursive: true });
  writeFileSync(resolve(decisions, `${ADR_NUMBER}-lineage-graph.md`), [
    '# ADR-0072 — Lineage Graph', '', '**Status:** Accepted', '', '## Decision', '',
    'Use canonical workflow and task JSON as lineage authority.', '',
  ].join('\n'));
  const workflow = createWaveWorkflow(root, WORKFLOW_SLUG, {
    id: WORKFLOW_ID,
    title: 'Lineage graph',
    objective: 'Trace canonical v4 work to ADR-0072.',
    acceptance: ['ADR-0072'],
    now: NOW,
  });
  addTask(workflow.dir, {
    id: TASK_ID,
    title: 'Build canonical lineage',
    status: 'working',
    evidenceRefs: ['reports/lineage.md'],
  }, 0, { now: NOW });
  writeFileSync(resolve(sessions, `2026-01-01-${SESSION_NUMBER}-lineage.md`),
    `# Lineage session\n\nWorked on ${TASK_ID}.\n`);
  return root;
}

const fixtureRoot = buildFixtureRoot();
const graph = await buildLineage(fixtureRoot);
for (const type of ['adr', 'workflow', 'card', 'session']) {
  check((graph.stats?.byType?.[type] ?? 0) >= 1, `canonical graph contains ${type}`);
}
check(!graph.nodes.some((node) => node.type === 'receipt'), 'retired receipt nodes are absent');

for (const [from, to, relation] of [
  [`adr:${ADR_NUMBER}`, `wf:${WORKFLOW_SLUG}`, 'drives'],
  [`wf:${WORKFLOW_SLUG}`, `card:${TASK_ID}`, 'ships'],
  [`card:${TASK_ID}`, `session:${SESSION_NUMBER}`, 'workedIn'],
]) {
  check(graph.edges.some((edge) => edge.from === from && edge.to === to && edge.rel === relation),
    `${from} --${relation}--> ${to}`);
}

const bareRoot = resolve(tmpdir(), `selfcheck-lineage-bare-${Date.now()}`);
mkdirSync(bareRoot, { recursive: true });
const bareGraph = await buildLineage(bareRoot);
check(bareGraph.nodes.length === 0, 'bare root returns an empty graph');
check((bareGraph.stats?.sources?.skipped?.length ?? 0) > 0, 'bare root reports skipped sources');

const extraSources = {
  adrs: [{ number: ADR_NUMBER, title: 'Lineage' }, { number: '9999', title: 'Unrelated' }],
  workflows: [], cards: [], sessions: [], telemetry: [],
};
const extraNodes = buildNodes(extraSources);
const extraEdges = buildEdges(extraSources, extraNodes);
const fullGraph = { nodes: extraNodes, edges: extraEdges, stats: computeStats(extraNodes, extraEdges) };
const subgraph = subgraphFrom(fullGraph, `adr:${ADR_NUMBER}`);
check(subgraph.nodes.some((node) => node.id === `adr:${ADR_NUMBER}`), 'subgraph retains requested root');
check(!subgraph.nodes.some((node) => node.id === 'adr:9999'), 'subgraph excludes unrelated node');

const cli = spawnSync(process.execPath, [lineagePath, '--json'], {
  cwd: fixtureRoot, encoding: 'utf8', timeout: 30_000,
});
check(cli.status === 0, 'lineage CLI exits zero');
try {
  const parsed = JSON.parse(cli.stdout);
  check(Array.isArray(parsed.nodes) && Array.isArray(parsed.edges), 'lineage CLI emits graph JSON');
} catch (error) {
  bad(`lineage CLI JSON parse failed: ${error.message}`);
}

rmSync(fixtureRoot, { recursive: true, force: true });
rmSync(bareRoot, { recursive: true, force: true });
console.log(failures === 0
  ? '\n  PASS — canonical v4 lineage graph\n'
  : `\n  FAIL — canonical v4 lineage graph: ${failures}\n`);
process.exit(failures === 0 ? 0 : 1);
