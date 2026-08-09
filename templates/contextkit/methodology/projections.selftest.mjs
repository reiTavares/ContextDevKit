/**
 * In-process self-test for the WF-0089 SA1 structural auto-fill projections
 * (`projections.mjs`, BIZ-0006, ADR-0148 §9/§10).
 *
 * Uses a tiny in-memory fixture projection (never the real repo graph) so the
 * suite stays deterministic and fast. Proves:
 *   [a] deriveScope traces to a real boundedReachability query (fwd-reach)
 *   [b] deriveRisk traces to a real reverseConsumers query (fan-in)
 *   [c] deriveTasks reuses tasks-derive.mjs's deriveWorkflowTasks verbatim
 *   [d] deriveClassification reuses work-classifier.mjs's classifyWork verbatim
 *   [e] deriveKpiSkeleton produces a metric+lever skeleton with baseline=null
 *       (constitution §8 — no invented numbers)
 *   [f] every function is idempotent: same input -> deep-identical output
 *   [g] fail-open: an absent graph projection (or missing inputs) degrades to
 *       available:false, never throws, never fabricates
 *
 * Exit 0 = all held; exit 1 = at least one failed. No wall-clock, no disk I/O.
 */
import {
  deriveScope, deriveRisk, deriveTasks, deriveClassification, deriveKpiSkeleton,
} from './projections.mjs';

const failures = [];
function assert(label, cond, detail = '') {
  process.stdout.write(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}\n`);
  if (!cond) failures.push(label);
}

/**
 * A small fixture graph: `sym:seed` is called by `sym:a`/`sym:b`, imported by
 * `file:x`, and itself calls `sym:downstream`. Mirrors the fixture shape used
 * by `graph-query.mjs`'s own selfcheck (tools/selfcheck-graph-query.mjs).
 */
function fixtureProjection() {
  const nodes = [{ id: 'sym:seed' }, { id: 'sym:downstream' }, { id: 'sym:a' }, { id: 'sym:b' }, { id: 'file:x' }];
  const edges = [
    { source: 'sym:a', target: 'sym:seed', relation: 'calls' },
    { source: 'sym:b', target: 'sym:seed', relation: 'calls' },
    { source: 'file:x', target: 'sym:seed', relation: 'imports' },
    { source: 'sym:seed', target: 'sym:downstream', relation: 'calls' },
  ];
  return { available: true, nodes, edges, layers: [], signature: 'fixture-sig' };
}

const ABSENT = { available: false, reason: 'no committed graph projection', evidenceClass: 'GRAPH_DERIVED' };

// [a] deriveScope traces to a real fwd-reachability query.
{
  const projection = fixtureProjection();
  const result = deriveScope(['sym:seed'], projection, 40);
  assert('[a] deriveScope source is biz0004:fwd-reach', result.source === 'biz0004:fwd-reach');
  assert('[a] deriveScope available on a present graph', result.available === true);
  assert('[a] deriveScope reaches sym:a/sym:b/file:x/sym:downstream from sym:seed',
    ['sym:a', 'sym:b', 'file:x', 'sym:downstream', 'sym:seed'].every((id) => result.value.nodes.includes(id)),
    JSON.stringify(result.value.nodes));
  const empty = deriveScope(['sym:nowhere-connected'], { available: true, nodes: [{ id: 'sym:nowhere-connected' }], edges: [], layers: [] }, 40);
  assert('[a] an isolated seed reaches only itself', empty.value.nodes.length === 1 && empty.value.nodes[0] === 'sym:nowhere-connected', JSON.stringify(empty.value.nodes));
}

// [b] deriveRisk traces to a real reverse-consumers query (fan-in).
{
  const projection = fixtureProjection();
  const result = deriveRisk(['sym:seed'], projection);
  assert('[b] deriveRisk source is biz0004:rev-consumers', result.source === 'biz0004:rev-consumers');
  assert('[b] deriveRisk available on a present graph', result.available === true);
  assert('[b] deriveRisk finds sym:a/sym:b/file:x as consumers of sym:seed',
    result.value.consumers.join(',') === 'file:x,sym:a,sym:b', result.value.consumers.join(','));
  // sym:downstream is only ever a `calls` TARGET (from sym:seed) — it has one real consumer.
  const oneConsumer = deriveRisk(['sym:downstream'], projection);
  assert('[b] sym:downstream has exactly sym:seed as its consumer', oneConsumer.available === true && oneConsumer.value.consumers.join(',') === 'sym:seed', oneConsumer.value.consumers.join(','));
  // A node with no inbound edge at all has zero consumers.
  const noConsumers = deriveRisk(['sym:a'], projection);
  assert('[b] a node with no inbound edge has zero consumers', noConsumers.available === true && noConsumers.value.consumers.length === 0, JSON.stringify(noConsumers.value.consumers));
}

// [c] deriveTasks reuses tasks-derive.mjs's deriveWorkflowTasks.
{
  const plan = { workflowId: '77', createdAt: '2026-01-01T00:00:00.000Z', waves: [{ id: 'W1', tasks: [{ id: 'T1', title: 'Alpha' }, { id: 'T2', title: 'Beta', dependsOn: ['T1'] }] }] };
  const result = deriveTasks(plan);
  assert('[c] deriveTasks source is biz0003:tasks-derive', result.source === 'biz0003:tasks-derive');
  assert('[c] deriveTasks available for a well-formed plan', result.available === true);
  assert('[c] deriveTasks scopeRef is WF-0077 (canonical v4 task authority)', result.value.scopeRef === 'WF-0077', JSON.stringify(result.value.scopeRef));
  assert('[c] deriveTasks carries both planned tasks', result.value.tasks.length === 2, JSON.stringify(result.value.tasks));
  const malformed = deriveTasks({ workflowId: '1', waves: [{ tasks: [{ id: '' }] }] });
  assert('[c] a malformed plan degrades to available:false (never throws)', malformed.available === false && typeof malformed.reason === 'string');
}

// [d] deriveClassification reuses work-classifier.mjs's classifyWork.
{
  const result = deriveClassification('this is a hotfix for the production outage');
  assert('[d] deriveClassification source is work-classifier', result.source === 'work-classifier');
  assert('[d] deriveClassification available always (classifyWork never throws)', result.available === true);
  assert('[d] deriveClassification carries nature/kind/executionMode', result.value.nature === 'operation' && result.value.kind === 'fix', JSON.stringify(result.value));
  assert('[d] deriveClassification carries reasons[] (explainability)', Array.isArray(result.value.reasons) && result.value.reasons.length > 0);
}

// [e] deriveKpiSkeleton: names + levers, baselines null (constitution §8).
{
  const result = deriveKpiSkeleton({ growthLever: 'RELIABILITY' });
  assert('[e] deriveKpiSkeleton source is scaffold', result.source === 'scaffold');
  assert('[e] deriveKpiSkeleton available with a growth lever', result.available === true);
  assert('[e] deriveKpiSkeleton primaryLever matches the input lever', result.value.primaryLever === 'RELIABILITY');
  assert('[e] every KPI has a non-empty metric name', result.value.kpis.every((kpi) => typeof kpi.metric === 'string' && kpi.metric.length > 0));
  assert('[e] every KPI baseline is null (no invented numbers)', result.value.kpis.every((kpi) => kpi.baseline === null));
  const noLever = deriveKpiSkeleton({ growthLever: null });
  assert('[e] no growth lever degrades to available:false', noLever.available === false && noLever.value === null);
  const fromClassification = deriveKpiSkeleton(deriveClassification('this is a hotfix for the production outage').value);
  assert('[e] accepts a deriveClassification value directly (no growthLever on this fixture -> unavailable)', fromClassification.available === false);
}

// [f] idempotency: same input -> byte-identical serialized output.
{
  const projection = fixtureProjection();
  const scopeOnce = JSON.stringify(deriveScope(['sym:seed'], projection, 40));
  const scopeTwice = JSON.stringify(deriveScope(['sym:seed'], projection, 40));
  assert('[f] deriveScope is idempotent', scopeOnce === scopeTwice);

  const riskOnce = JSON.stringify(deriveRisk(['sym:seed'], projection));
  const riskTwice = JSON.stringify(deriveRisk(['sym:seed'], projection));
  assert('[f] deriveRisk is idempotent', riskOnce === riskTwice);

  const plan = { workflowId: '5', createdAt: '2026-01-01T00:00:00.000Z', waves: [{ id: 'W1', tasks: [{ id: 'T1', title: 'Alpha' }] }] };
  const tasksOnce = JSON.stringify(deriveTasks(plan));
  const tasksTwice = JSON.stringify(deriveTasks(plan));
  assert('[f] deriveTasks is idempotent', tasksOnce === tasksTwice);

  const classificationOnce = JSON.stringify(deriveClassification('fix the broken updater rollback'));
  const classificationTwice = JSON.stringify(deriveClassification('fix the broken updater rollback'));
  assert('[f] deriveClassification is idempotent', classificationOnce === classificationTwice);

  const kpiOnce = JSON.stringify(deriveKpiSkeleton({ growthLever: 'QUALITY' }));
  const kpiTwice = JSON.stringify(deriveKpiSkeleton({ growthLever: 'QUALITY' }));
  assert('[f] deriveKpiSkeleton is idempotent', kpiOnce === kpiTwice);
}

// [g] fail-open: an absent graph projection never throws, never fabricates.
{
  let threwScope = false;
  let scopeResult;
  try { scopeResult = deriveScope(['sym:seed'], ABSENT, 40); } catch { threwScope = true; }
  assert('[g] deriveScope never throws on an absent projection', !threwScope);
  assert('[g] deriveScope degrades to available:false on an absent projection', scopeResult?.available === false && scopeResult?.value === null);

  let threwRisk = false;
  let riskResult;
  try { riskResult = deriveRisk(['sym:seed'], ABSENT); } catch { threwRisk = true; }
  assert('[g] deriveRisk never throws on an absent projection', !threwRisk);
  assert('[g] deriveRisk degrades to available:false on an absent projection', riskResult?.available === false && riskResult?.value === null);

  const emptySymbols = deriveRisk([], fixtureProjection());
  assert('[g] deriveRisk degrades to available:false on an empty entry-symbol list', emptySymbols.available === false);

  let threwOnHostile = false;
  try {
    deriveScope(null, ABSENT, 40);
    deriveRisk(undefined, ABSENT);
    deriveTasks(null);
    deriveClassification(null);
    deriveKpiSkeleton(null);
  } catch { threwOnHostile = true; }
  assert('[g] every export is defensive against hostile/null input', !threwOnHostile);
}

process.stdout.write(failures.length ? `\nFAILED (${failures.length})\n` : '\nPASSED\n');
process.exit(failures.length ? 1 : 0);
