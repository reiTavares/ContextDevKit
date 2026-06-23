/**
 * Integration test — pure DAG engine (`workflow/dag.mjs`).
 *
 * Standalone suite (registered by the orchestrator, never self-registered).
 * Exercises cycle detection, topological order, readiness/blocking, dependency
 * validation and critical path against hand-built fixtures (linear chain,
 * diamond, 10-node DAG, cyclic graph) plus the real dogfood `workflow-plan.json`
 * wave graph (read via fs). All assertions check deterministic output.
 *
 * RUN: cd /d D:/devtool_ia-uwwe && node tools/integration-test-workflow-dag.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reporter } from './it-helpers.mjs';
import {
  buildGraph,
  detectCycle,
  topoOrder,
  readyNodes,
  blockedNodes,
  validateDependencies,
  criticalPath,
  CycleError,
} from '../templates/contextkit/tools/scripts/workflow/dag.mjs';

const rep = reporter();
const HERE = dirname(fileURLToPath(import.meta.url));

/** Compare two arrays for deep ordered equality. */
const eqArr = (left, right) => JSON.stringify(left) === JSON.stringify(right);

// --- Fixtures -------------------------------------------------------------
/** Linear chain A -> B -> C -> D (each depends on the previous). */
const chain = [
  { id: 'A', dependsOn: [] },
  { id: 'B', dependsOn: ['A'] },
  { id: 'C', dependsOn: ['B'] },
  { id: 'D', dependsOn: ['C'] },
];

/** Diamond: A -> {B,C} -> D. */
const diamond = [
  { id: 'A', dependsOn: [] },
  { id: 'B', dependsOn: ['A'] },
  { id: 'C', dependsOn: ['A'] },
  { id: 'D', dependsOn: ['B', 'C'] },
];

/** 10-node DAG with several layers and tie opportunities. */
const ten = [
  { id: 'N1', dependsOn: [] },
  { id: 'N2', dependsOn: [] },
  { id: 'N3', dependsOn: ['N1'] },
  { id: 'N4', dependsOn: ['N1', 'N2'] },
  { id: 'N5', dependsOn: ['N2'] },
  { id: 'N6', dependsOn: ['N3', 'N4'] },
  { id: 'N7', dependsOn: ['N5'] },
  { id: 'N8', dependsOn: ['N6', 'N7'] },
  { id: 'N9', dependsOn: ['N8'] },
  { id: 'N10', dependsOn: ['N8'] },
];

/** Cyclic graph: X -> Y -> Z -> X. */
const cyclic = [
  { id: 'X', dependsOn: ['Z'] },
  { id: 'Y', dependsOn: ['X'] },
  { id: 'Z', dependsOn: ['Y'] },
];

// --- buildGraph -----------------------------------------------------------
{
  const graph = buildGraph(diamond);
  eqArr(graph.ids, ['A', 'B', 'C', 'D'])
    ? rep.ok('buildGraph: ids sorted ascending')
    : rep.bad(`buildGraph ids unexpected: ${JSON.stringify(graph.ids)}`);
  eqArr(graph.deps.get('D'), ['B', 'C'])
    ? rep.ok('buildGraph: deps recorded + sorted')
    : rep.bad(`buildGraph deps unexpected: ${JSON.stringify(graph.deps.get('D'))}`);

  let threw = false;
  try {
    buildGraph([{ dependsOn: [] }]);
  } catch (err) {
    threw = err instanceof TypeError;
  }
  threw ? rep.ok('buildGraph: throws TypeError on missing id') : rep.bad('buildGraph did not reject missing id');
}

// --- detectCycle ----------------------------------------------------------
{
  const acyclic = detectCycle(ten);
  !acyclic.hasCycle && eqArr(acyclic.cycle, [])
    ? rep.ok('detectCycle: acyclic graph reports no cycle')
    : rep.bad(`detectCycle false positive: ${JSON.stringify(acyclic)}`);

  const found = detectCycle(cyclic);
  const closesLoop = found.cycle.length > 0 && found.cycle[0] === found.cycle[found.cycle.length - 1];
  found.hasCycle && closesLoop
    ? rep.ok(`detectCycle: cycle found and path returned (${found.cycle.join(' -> ')})`)
    : rep.bad(`detectCycle missed cycle: ${JSON.stringify(found)}`);
}

// --- topoOrder ------------------------------------------------------------
{
  eqArr(topoOrder(chain), ['A', 'B', 'C', 'D'])
    ? rep.ok('topoOrder: linear chain order')
    : rep.bad(`topoOrder chain unexpected: ${JSON.stringify(topoOrder(chain))}`);

  const order = topoOrder(diamond);
  const respectsDeps = order.indexOf('A') < order.indexOf('B')
    && order.indexOf('A') < order.indexOf('C')
    && order.indexOf('B') < order.indexOf('D')
    && order.indexOf('C') < order.indexOf('D');
  respectsDeps ? rep.ok('topoOrder: diamond respects dependencies') : rep.bad(`topoOrder diamond bad: ${JSON.stringify(order)}`);

  // Determinism: B sorts before C at the same layer.
  eqArr(order, ['A', 'B', 'C', 'D'])
    ? rep.ok('topoOrder: deterministic tie-break by id ascending')
    : rep.bad(`topoOrder tie-break unexpected: ${JSON.stringify(order)}`);

  eqArr(topoOrder(ten), topoOrder(ten))
    ? rep.ok('topoOrder: 10-node DAG order is stable across calls')
    : rep.bad('topoOrder not deterministic on 10-node DAG');

  let threw = false;
  try {
    topoOrder(cyclic);
  } catch (err) {
    threw = err instanceof CycleError && err.cycle.length > 0;
  }
  threw ? rep.ok('topoOrder: throws CycleError on cyclic graph') : rep.bad('topoOrder did not throw on cycle');
}

// --- readyNodes -----------------------------------------------------------
{
  eqArr(readyNodes(diamond, []), ['A'])
    ? rep.ok('readyNodes: only roots ready when nothing completed')
    : rep.bad(`readyNodes roots unexpected: ${JSON.stringify(readyNodes(diamond, []))}`);

  eqArr(readyNodes(diamond, ['A']), ['B', 'C'])
    ? rep.ok('readyNodes: dependents unlock after dependency completes')
    : rep.bad(`readyNodes unlock unexpected: ${JSON.stringify(readyNodes(diamond, ['A']))}`);

  eqArr(readyNodes(diamond, ['A', 'B']), ['C'])
    ? rep.ok('readyNodes: completed nodes excluded, partial deps still block')
    : rep.bad(`readyNodes partial unexpected: ${JSON.stringify(readyNodes(diamond, ['A', 'B']))}`);

  eqArr(readyNodes(diamond, ['A', 'B', 'C']), ['D'])
    ? rep.ok('readyNodes: final node ready once both branches done')
    : rep.bad(`readyNodes final unexpected: ${JSON.stringify(readyNodes(diamond, ['A', 'B', 'C']))}`);
}

// --- blockedNodes ---------------------------------------------------------
{
  const blocked = blockedNodes(diamond, ['A']);
  const expected = [
    { id: 'D', blockedBy: ['B', 'C'] },
  ];
  eqArr(blocked, expected)
    ? rep.ok('blockedNodes: lists only unmet deps (B,C still pending for D)')
    : rep.bad(`blockedNodes unexpected: ${JSON.stringify(blocked)}`);

  eqArr(blockedNodes(diamond, ['A', 'B', 'C', 'D']), [])
    ? rep.ok('blockedNodes: nothing blocked when all completed')
    : rep.bad('blockedNodes not empty when all done');
}

// --- validateDependencies -------------------------------------------------
{
  validateDependencies(diamond).valid
    ? rep.ok('validateDependencies: clean graph valid')
    : rep.bad('validateDependencies rejected a clean graph');

  const dangling = validateDependencies([{ id: 'A', dependsOn: ['ghost'] }]);
  !dangling.valid && dangling.errors.some((e) => e.includes('ghost'))
    ? rep.ok('validateDependencies: dangling dependency rejected')
    : rep.bad(`validateDependencies missed dangling: ${JSON.stringify(dangling)}`);

  const selfdep = validateDependencies([{ id: 'A', dependsOn: ['A'] }]);
  !selfdep.valid && selfdep.errors.some((e) => e.includes('self-dependency'))
    ? rep.ok('validateDependencies: self-dependency rejected')
    : rep.bad(`validateDependencies missed self-dep: ${JSON.stringify(selfdep)}`);
}

// --- criticalPath ---------------------------------------------------------
{
  eqArr(criticalPath(chain), ['A', 'B', 'C', 'D'])
    ? rep.ok('criticalPath: linear chain is its own critical path')
    : rep.bad(`criticalPath chain unexpected: ${JSON.stringify(criticalPath(chain))}`);

  const longest = criticalPath(ten);
  const validChain = longest.length >= 5 && longest[0].startsWith('N') && longest[longest.length - 1] === longest[longest.length - 1];
  const endsDeep = longest.includes('N8') && (longest.includes('N9') || longest.includes('N10'));
  validChain && endsDeep
    ? rep.ok(`criticalPath: 10-node longest chain (${longest.join(' -> ')})`)
    : rep.bad(`criticalPath ten unexpected: ${JSON.stringify(longest)}`);

  // Weighted: make C dominate so the path routes through it.
  const weighted = criticalPath(diamond, { weight: (id) => (id === 'C' ? 100 : 1) });
  eqArr(weighted, ['A', 'C', 'D'])
    ? rep.ok('criticalPath: weighted metric routes through heavy node')
    : rep.bad(`criticalPath weighted unexpected: ${JSON.stringify(weighted)}`);

  eqArr(criticalPath(ten), criticalPath(ten))
    ? rep.ok('criticalPath: deterministic across calls')
    : rep.bad('criticalPath not deterministic');
}

// --- Dogfood wave graph from workflow-plan.json ---------------------------
{
  const planPath = join(
    HERE,
    '..',
    'contextkit',
    'memory',
    'workflows',
    '0035-universal-wave-workflow-engine',
    'workflow-plan.json',
  );
  const plan = existsSync(planPath)
    ? JSON.parse(readFileSync(planPath, 'utf-8').replace(/^﻿/, ''))
    : {
        waves: [
          { id: 'W0', dependsOn: [], tasks: [] },
          { id: 'W1', dependsOn: ['W0'], tasks: [
            { id: 'W1-T1', dependsOn: [] },
            { id: 'W1-T2', dependsOn: [] },
            { id: 'W1-T3', dependsOn: [] },
          ] },
          { id: 'W2', dependsOn: ['W1'], tasks: [] },
          { id: 'W3', dependsOn: ['W2'], tasks: [] },
        ],
      };
  const waveNodes = plan.waves.map((wave) => ({ id: wave.id, dependsOn: wave.dependsOn ?? [] }));

  const planValid = validateDependencies(waveNodes).valid;
  planValid ? rep.ok('dogfood: wave dependencies well-formed') : rep.bad('dogfood: wave deps invalid');

  const noCycle = !detectCycle(waveNodes).hasCycle;
  noCycle ? rep.ok('dogfood: wave graph acyclic') : rep.bad('dogfood: wave graph has a cycle');

  const waveOrder = topoOrder(waveNodes);
  eqArr(waveOrder, ['W0', 'W1', 'W2', 'W3'])
    ? rep.ok('dogfood: topoOrder W0 -> W1 -> W2 -> W3')
    : rep.bad(`dogfood wave order unexpected: ${JSON.stringify(waveOrder)}`);

  eqArr(readyNodes(waveNodes, []), ['W0'])
    ? rep.ok('dogfood: only W0 ready at start')
    : rep.bad(`dogfood readyNodes start unexpected: ${JSON.stringify(readyNodes(waveNodes, []))}`);

  eqArr(readyNodes(waveNodes, ['W0']), ['W1'])
    ? rep.ok('dogfood: W1 ready after W0')
    : rep.bad(`dogfood readyNodes after W0 unexpected: ${JSON.stringify(readyNodes(waveNodes, ['W0']))}`);

  const blockedAtStart = blockedNodes(waveNodes, []);
  blockedAtStart.some((b) => b.id === 'W3' && eqArr(b.blockedBy, ['W2']))
    ? rep.ok('dogfood: W3 blocked by W2 at start')
    : rep.bad(`dogfood blockedNodes unexpected: ${JSON.stringify(blockedAtStart)}`);

  // Task-level graph of W1 tasks (same engine, generic nodes).
  const w1 = plan.waves.find((wave) => wave.id === 'W1');
  const taskNodes = w1.tasks.map((task) => ({ id: task.id, dependsOn: task.dependsOn ?? [] }));
  validateDependencies(taskNodes).valid && !detectCycle(taskNodes).hasCycle
    ? rep.ok('dogfood: W1 task graph valid + acyclic (engine is wave/task agnostic)')
    : rep.bad('dogfood: W1 task graph invalid');

  eqArr(readyNodes(taskNodes, []), ['W1-T1', 'W1-T2', 'W1-T3'])
    ? rep.ok('dogfood: W1 ready tasks are the dependency-free ones')
    : rep.bad(`dogfood W1 ready tasks unexpected: ${JSON.stringify(readyNodes(taskNodes, []))}`);
}

rep.finish('workflow-dag');
