#!/usr/bin/env node
/**
 * CDK-070 self-check — lineage-graph pure builders + CLI integration.
 *
 * Asserts five invariants:
 *   (1) buildLineage on seeded fixture returns ≥1 node of each type:
 *       adr, workflow, card, session, receipt.
 *   (2) The edge chain adr→workflow→card, card→receipt, card→session exists.
 *   (3) Fail-open: bare root (no contextkit) returns a graph (no throw) with
 *       all stores in stats.sources.skipped (§8 graceful degradation).
 *   (4) subgraphFrom returns a SUBSET of the full graph when an unrelated
 *       extra ADR node exists.
 *   (5) `node lineage-graph.mjs --json` exits 0 and prints parseable JSON.
 *
 * Standalone runnable: node tools/selfcheck-lineage.mjs
 * Exit 0 on all-pass, exit 1 on any failure.
 * Zero runtime deps — node:* only.
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync, execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dirname, '..');

const CORE_URL = pathToFileURL(resolve(KIT, 'templates/contextkit/tools/scripts/lineage-graph-core.mjs')).href;
const IO_PATH  = resolve(KIT, 'templates/contextkit/tools/scripts/lineage-graph.mjs');
const IO_URL   = pathToFileURL(IO_PATH).href;

let failures = 0;
const ok  = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { console.error(`  ✗ ${msg}`); failures += 1; };

// ---------------------------------------------------------------------------
// Import pure builders
// ---------------------------------------------------------------------------
let buildNodes, buildEdges, computeStats, subgraphFrom;
try {
  ({ buildNodes, buildEdges, computeStats, subgraphFrom } = await import(CORE_URL));
  ok('lineage-graph-core.mjs imports cleanly');
} catch (err) {
  console.error(`FATAL: cannot import lineage-graph-core.mjs: ${err?.message ?? err}`);
  process.exit(1);
}

let buildLineage;
try {
  ({ buildLineage } = await import(IO_URL));
  ok('lineage-graph.mjs imports cleanly');
} catch (err) {
  console.error(`FATAL: cannot import lineage-graph.mjs: ${err?.message ?? err}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const FIXTURE_ADR_NUM = '0072';
const FIXTURE_WF_SLUG = 'lineage';
const FIXTURE_CARD_ID = 'CDK-070';
const FIXTURE_SESS_NUM = '42';
const FIXTURE_CAP     = 'test-run';
const FIXTURE_BRANCH  = 'main';

/** Creates a minimal fixture under `root` and git-inits it. Returns root. */
function buildFixtureRoot() {
  const root = resolve(tmpdir(), `selfcheck-lineage-${Date.now()}`);
  mkdirSync(root, { recursive: true });

  // git init so workflow-pack's currentBranch() works
  try { execSync('git init -b main', { cwd: root, stdio: 'pipe' }); } catch {
    try { execSync('git init', { cwd: root, stdio: 'pipe' }); } catch { /* best-effort */ }
  }

  const ckPath = (rel) => resolve(root, 'contextkit', rel);

  // ADR
  mkdirSync(ckPath('memory/decisions'), { recursive: true });
  writeFileSync(ckPath(`memory/decisions/${FIXTURE_ADR_NUM}-lineage-graph.md`),
    `# ADR-0072 — Lineage Graph\n\n**Status:** Accepted\n\n## Context\n\nWe need lineage.\n\n## Decision\n\nBuild CDK-070.\n\n`);

  // Workflow with a phase ref containing ADR-0072
  mkdirSync(ckPath(`memory/workflows/${FIXTURE_WF_SLUG}`), { recursive: true });
  writeFileSync(ckPath(`memory/workflows/${FIXTURE_WF_SLUG}/index.md`),
    `---\nslug: ${FIXTURE_WF_SLUG}\nkind: feature\nnumber: 0028\n` +
    `started: 2026-01-01T00:00:00.000Z\nbranch: ${FIXTURE_BRANCH}\ncurrentPhase: spec\n` +
    `intake: done\nintake-ref: ADR-${FIXTURE_ADR_NUM}\nprd: done\nprd-ref: \nspec: pending\nspec-ref: \n---\n\n` +
    `# Workflow - ${FIXTURE_WF_SLUG}\n\n`);

  // Pipeline card
  for (const stage of ['backlog', 'working', 'testing', 'conclusion']) {
    mkdirSync(ckPath(`pipeline/${stage}`), { recursive: true });
  }
  writeFileSync(ckPath(`pipeline/working/${FIXTURE_CARD_ID}-lineage-graph.md`),
    `---\nid: ${FIXTURE_CARD_ID}\ntitle: Lineage graph end-to-end\nworkflow: ${FIXTURE_WF_SLUG}\ntype: feature\npriority: P1\n---\n\n# CDK-070\n\n`);

  // State.json with ownerSessionId
  mkdirSync(ckPath(`pipeline/state/${FIXTURE_CARD_ID}`), { recursive: true });
  writeFileSync(ckPath(`pipeline/state/${FIXTURE_CARD_ID}/state.json`), JSON.stringify({
    kind: 'task', id: FIXTURE_CARD_ID, status: 'working',
    ownerSessionId: FIXTURE_SESS_NUM, ownerUser: 'test',
    branch: FIXTURE_BRANCH, startedAt: Date.now(), lastHeartbeat: Date.now(),
    endedAt: null, cycles: {}, events: [],
  }, null, 2));

  // Receipt for the card
  mkdirSync(ckPath(`pipeline/state/${FIXTURE_CARD_ID}/receipts`), { recursive: true });
  writeFileSync(ckPath(`pipeline/state/${FIXTURE_CARD_ID}/receipts/${FIXTURE_CAP}.json`), JSON.stringify({
    version: 1, capability: FIXTURE_CAP, taskId: FIXTURE_CARD_ID,
    sessionId: FIXTURE_SESS_NUM, runId: 'run-001',
    command: 'node', host: 'claude-code', result: 'passed',
    evidence: { exitCode: 0 },
    scope: { branch: FIXTURE_BRANCH },
    fingerprint: 'abc123', createdAt: Date.now(), expiresAt: Date.now() + 86400000,
  }, null, 2));

  // Session directory + file
  mkdirSync(ckPath('memory/sessions'), { recursive: true });
  writeFileSync(ckPath(`memory/sessions/2026-01-01-${FIXTURE_SESS_NUM.padStart(2, '0')}-lineage.md`),
    `# Lineage session\n\nBuilt CDK-070.\n`);

  return root;
}

function cleanFixture(root) {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// (1) buildLineage returns ≥1 node of each type: adr, workflow, card, session, receipt
// ---------------------------------------------------------------------------
console.log('\n(1) buildLineage on seeded fixture — node types present\n');

let fixtureRoot;
let graph;
try {
  fixtureRoot = buildFixtureRoot();
  graph = await buildLineage(fixtureRoot);
  ok('buildLineage completed without throwing');
} catch (err) {
  bad(`buildLineage threw unexpectedly: ${err?.message ?? err}`);
  process.exit(failures > 0 ? 1 : 0);
}

const byType = graph.stats?.byType ?? {};
for (const type of ['adr', 'workflow', 'card', 'session', 'receipt']) {
  (byType[type] ?? 0) >= 1
    ? ok(`≥1 node of type '${type}' present (got ${byType[type]})`)
    : bad(`expected ≥1 node of type '${type}', got ${byType[type] ?? 0}`);
}

// ---------------------------------------------------------------------------
// (2) Edge chain: adr→workflow, workflow→card, card→receipt, card→session
// ---------------------------------------------------------------------------
console.log('\n(2) Edge chain exists for seed data\n');

const expectedEdges = [
  [`adr:${FIXTURE_ADR_NUM}`, `wf:${FIXTURE_WF_SLUG}`, 'drives'],
  [`wf:${FIXTURE_WF_SLUG}`, `card:${FIXTURE_CARD_ID}`, 'ships'],
  [`card:${FIXTURE_CARD_ID}`, `receipt:${FIXTURE_CARD_ID}/${FIXTURE_CAP}`, 'attests'],
  [`card:${FIXTURE_CARD_ID}`, `session:${FIXTURE_SESS_NUM}`, 'workedIn'],
];
for (const [from, to, rel] of expectedEdges) {
  const found = graph.edges.some((e) => e.from === from && e.to === to && e.rel === rel);
  found
    ? ok(`edge: ${from} --${rel}--> ${to}`)
    : bad(`missing edge: ${from} --${rel}--> ${to}`);
}

// ---------------------------------------------------------------------------
// (3) Fail-open: bare root with no contextkit — graph returns, stores in skipped
// ---------------------------------------------------------------------------
console.log('\n(3) Fail-open: bare root (no contextkit) — no throw, stores skipped\n');

let bareGraph;
const bareRoot = resolve(tmpdir(), `selfcheck-lineage-bare-${Date.now()}`);
mkdirSync(bareRoot, { recursive: true });
try { execSync('git init -b main', { cwd: bareRoot, stdio: 'pipe' }); } catch {
  try { execSync('git init', { cwd: bareRoot, stdio: 'pipe' }); } catch { /* best-effort */ }
}

try {
  bareGraph = await buildLineage(bareRoot);
  ok('buildLineage on bare root: no throw (fail-open)');
} catch (err) {
  bad(`buildLineage on bare root threw: ${err?.message ?? err}`);
  bareGraph = null;
}

if (bareGraph) {
  const skipped = bareGraph.stats?.sources?.skipped ?? [];
  const present = bareGraph.stats?.sources?.present ?? [];
  skipped.length > 0
    ? ok(`bare root: ${skipped.length} stores skipped: ${skipped.join(', ')}`)
    : bad('bare root: expected at least one store in skipped, got none');
  !present.some((s) => ['adrs', 'workflows', 'cards', 'sessions'].includes(s))
    ? ok('bare root: no structural stores falsely counted as present (§8)')
    : bad(`bare root: structural stores should not be present, got: ${present.join(', ')}`);
}
cleanFixture(bareRoot);

// ---------------------------------------------------------------------------
// (4) subgraphFrom returns a SUBSET when an unrelated extra ADR exists
// ---------------------------------------------------------------------------
console.log('\n(4) subgraphFrom returns only reachable subset\n');

// Add an extra unrelated ADR node directly using the pure builders
const extraSources = {
  adrs: [
    { number: FIXTURE_ADR_NUM, title: 'Lineage' },
    { number: '9999', title: 'Unrelated ADR' },
  ],
  workflows: [],
  cards: [],
  sessions: [],
  receipts: [],
  telemetry: [],
};
const extraNodes = buildNodes(extraSources);
const extraEdges = buildEdges(extraSources, extraNodes);
const fullGraph  = { nodes: extraNodes, edges: extraEdges, stats: computeStats(extraNodes, extraEdges) };
const sub = subgraphFrom(fullGraph, `adr:${FIXTURE_ADR_NUM}`);

sub.nodes.length < fullGraph.nodes.length
  ? ok(`subgraphFrom: ${sub.nodes.length} nodes < full graph ${fullGraph.nodes.length} nodes`)
  : bad(`subgraphFrom should return fewer nodes than full graph (got ${sub.nodes.length} vs ${fullGraph.nodes.length})`);

sub.nodes.some((n) => n.id === `adr:${FIXTURE_ADR_NUM}`)
  ? ok(`subgraphFrom: root node adr:${FIXTURE_ADR_NUM} is in subgraph`)
  : bad(`subgraphFrom: root node adr:${FIXTURE_ADR_NUM} missing from subgraph`);

!sub.nodes.some((n) => n.id === 'adr:9999')
  ? ok('subgraphFrom: unrelated adr:9999 is NOT in subgraph')
  : bad('subgraphFrom: adr:9999 should not appear in subgraph — no path to root');

// Also verify pure-telemetry path works through pure builders
const teleSources = {
  adrs: [], workflows: [], cards: [], sessions: [{ number: '1', title: 'sess' }],
  receipts: [], telemetry: [{ sessionId: '1', taskId: '', total: 0, buckets: {} }],
};
const teleNodes = buildNodes(teleSources);
const teleEdges = buildEdges(teleSources, teleNodes);
teleEdges.some((e) => e.rel === 'costs')
  ? ok('pure builders: session→telemetry "costs" edge produced from UsageEvent')
  : bad('pure builders: expected session→telemetry "costs" edge, found none');

// ---------------------------------------------------------------------------
// (5) CLI: node lineage-graph.mjs --json exits 0 and prints parseable JSON
// ---------------------------------------------------------------------------
console.log('\n(5) CLI real output: --json exits 0 and is parseable JSON\n');

const cliResult = spawnSync(process.execPath, [IO_PATH, '--json'], {
  cwd: fixtureRoot,
  encoding: 'utf-8',
  timeout: 30_000,
});

cliResult.status === 0
  ? ok('CLI: exit code 0')
  : bad(`CLI: expected exit 0, got ${cliResult.status}; stderr: ${cliResult.stderr?.slice(0, 200)}`);

let parsed = null;
try {
  parsed = JSON.parse(cliResult.stdout);
  ok('CLI: stdout is valid JSON');
} catch (err) {
  bad(`CLI: stdout is not parseable JSON: ${err?.message ?? err}`);
}

if (parsed) {
  Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)
    ? ok(`CLI JSON: nodes array (${parsed.nodes.length}) and edges array (${parsed.edges.length}) present`)
    : bad('CLI JSON: expected nodes[] and edges[] in output');
}

cleanFixture(fixtureRoot);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(
  failures === 0
    ? '\n  PASS — CDK-070 lineage-graph self-check: all checks passed.\n'
    : `\n  FAIL — CDK-070 lineage-graph self-check: ${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
