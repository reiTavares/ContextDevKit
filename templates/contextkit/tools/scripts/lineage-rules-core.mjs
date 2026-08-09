/**
 * lineage-rules-core.mjs — Pure business-rule engine over the CDK-070 lineage graph.
 *
 * No I/O. Exports DEFAULT_RULES (array of rule descriptors) and evaluateRules().
 * Each rule returns { status: 'pass'|'fail'|'skipped', detail, offenders: [] }.
 * Rules always return 'skipped' when their prerequisite node-type is absent — this
 * prevents false-positives when the graph is populated from an empty or bare root
 * (§8: skipped ≠ pass, skipped ≠ false-negative).
 *
 * ADR-0072 / CDK-073.
 *
 * @typedef {'pass'|'fail'|'skipped'} RuleStatus
 * @typedef {{ id: string, description: string, severity: string, check: (graph: Graph) => RuleResult }} Rule
 * @typedef {{ status: RuleStatus, detail: string, offenders: string[] }} RuleResult
 * @typedef {{ nodes: object[], edges: object[] }} Graph
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns all nodes of a specific type from the graph.
 * @param {Graph} graph
 * @param {string} type
 * @returns {object[]}
 */
function nodesOfType(graph, type) {
  return (graph.nodes ?? []).filter((n) => n.type === type);
}

/**
 * Returns all outgoing edges from a node with a specific relation.
 * @param {Graph} graph
 * @param {string} fromId
 * @param {string} rel
 * @returns {object[]}
 */
function outEdges(graph, fromId, rel) {
  return (graph.edges ?? []).filter((e) => e.from === fromId && e.rel === rel);
}

/**
 * Returns all incoming edges to a node with a specific relation.
 * @param {Graph} graph
 * @param {string} toId
 * @param {string} rel
 * @returns {object[]}
 */
function inEdges(graph, toId, rel) {
  return (graph.edges ?? []).filter((edge) => edge.to === toId && edge.rel === rel);
}

// ---------------------------------------------------------------------------
// Rule definitions
// ---------------------------------------------------------------------------

/**
 * R1 — accepted-adr-drives-workflow
 * Every accepted ADR must have at least one outgoing 'drives' edge to a workflow.
 * Skipped when no ADR nodes are present.
 * @param {Graph} graph
 * @returns {RuleResult}
 */
function ruleAcceptedAdrDrivesWorkflow(graph) {
  const adrNodes = nodesOfType(graph, 'adr');
  if (adrNodes.length === 0) {
    return { status: 'skipped', detail: 'No ADR nodes in graph.', offenders: [] };
  }
  const acceptedAdrs = adrNodes.filter(
    (n) => typeof n.ref?.status === 'string' && n.ref.status.toLowerCase().startsWith('accepted'),
  );
  if (acceptedAdrs.length === 0) {
    return { status: 'skipped', detail: 'No accepted ADR nodes found.', offenders: [] };
  }
  const orphans = acceptedAdrs.filter((n) => outEdges(graph, n.id, 'drives').length === 0);
  if (orphans.length === 0) {
    return { status: 'pass', detail: `All ${acceptedAdrs.length} accepted ADR(s) drive at least one workflow.`, offenders: [] };
  }
  return {
    status: 'fail',
    detail: `${orphans.length} accepted ADR(s) have no outgoing 'drives' edge.`,
    offenders: orphans.map((n) => n.id),
  };
}

/**
 * R2 — done-task-has-evidence-reference
 * Every canonical task with status `done` must retain at least one factual
 * evidence or report reference in its own task record.
 * Skipped when no task nodes are present or none is done.
 *
 * @param {Graph} graph
 * @returns {RuleResult}
 */
function ruleDoneTaskHasEvidenceReference(graph) {
  const cardNodes = nodesOfType(graph, 'card');
  if (cardNodes.length === 0) {
    return { status: 'skipped', detail: 'No card nodes in graph.', offenders: [] };
  }
  const doneTasks = cardNodes.filter((node) => node.ref?.status === 'done');
  if (doneTasks.length === 0) {
    return { status: 'skipped', detail: 'No done task nodes found.', offenders: [] };
  }

  const offenders = doneTasks.filter((task) =>
    (task.ref?.evidenceRefs?.length ?? 0) === 0 && (task.ref?.reportRefs?.length ?? 0) === 0,
  );

  if (offenders.length === 0) {
    return {
      status: 'pass',
      detail: `All ${doneTasks.length} done task(s) retain factual evidence or report references.`,
      offenders: [],
    };
  }
  return {
    status: 'fail',
    detail: `${offenders.length} done task(s) lack evidenceRefs/reportRefs.`,
    offenders: offenders.map((node) => node.id),
  };
}

/**
 * R3 — task-traces-to-workflow
 * Every workflow task must have an incoming canonical `ships` relation.
 * Batch tasks are excluded because the lineage graph currently models workflow
 * definitions only.
 * @param {Graph} graph
 * @returns {RuleResult}
 */
function ruleTaskTracesToWorkflow(graph) {
  const cardNodes = nodesOfType(graph, 'card');
  if (cardNodes.length === 0) {
    return { status: 'skipped', detail: 'No card nodes in graph.', offenders: [] };
  }
  const workflowTasks = cardNodes.filter((node) => /^WF-\d{4}$/.test(String(node.ref?.scopeRef ?? '')));
  if (workflowTasks.length === 0) {
    return { status: 'skipped', detail: 'No workflow-scoped task nodes found.', offenders: [] };
  }
  const offenders = workflowTasks.filter((node) => inEdges(graph, node.id, 'ships').length === 0);
  if (offenders.length === 0) {
    return { status: 'pass', detail: `All ${workflowTasks.length} workflow task(s) trace to their workflow.`, offenders: [] };
  }
  return {
    status: 'fail',
    detail: `${offenders.length} workflow task(s) have no incoming 'ships' edge.`,
    offenders: offenders.map((node) => node.id),
  };
}

/**
 * R4 — workflow-ships-at-least-one-card
 * Every workflow node must have at least one outgoing 'ships' edge.
 * Skipped when no workflow nodes are present.
 * @param {Graph} graph
 * @returns {RuleResult}
 */
function ruleWorkflowShipsAtLeastOneCard(graph) {
  const wfNodes = nodesOfType(graph, 'workflow');
  if (wfNodes.length === 0) {
    return { status: 'skipped', detail: 'No workflow nodes in graph.', offenders: [] };
  }
  const emptyWorkflows = wfNodes.filter((n) => outEdges(graph, n.id, 'ships').length === 0);
  if (emptyWorkflows.length === 0) {
    return { status: 'pass', detail: `All ${wfNodes.length} workflow(s) ship at least one card.`, offenders: [] };
  }
  return {
    status: 'fail',
    detail: `${emptyWorkflows.length} workflow(s) have no outgoing 'ships' edge.`,
    offenders: emptyWorkflows.map((n) => n.id),
  };
}

// ---------------------------------------------------------------------------
// Default rule registry
// ---------------------------------------------------------------------------

/** @type {Rule[]} */
export const DEFAULT_RULES = [
  {
    id: 'R1',
    description: 'accepted-adr-drives-workflow',
    severity: 'warning',
    check: ruleAcceptedAdrDrivesWorkflow,
  },
  {
    id: 'R2',
    description: 'done-task-has-evidence-reference',
    severity: 'warning',
    check: ruleDoneTaskHasEvidenceReference,
  },
  {
    id: 'R3',
    description: 'task-traces-to-workflow',
    severity: 'info',
    check: ruleTaskTracesToWorkflow,
  },
  {
    id: 'R4',
    description: 'workflow-ships-at-least-one-card',
    severity: 'warning',
    check: ruleWorkflowShipsAtLeastOneCard,
  },
];

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

/**
 * Runs all rules against the graph and returns a result set + summary counts.
 *
 * @param {Graph} graph
 * @param {Rule[]} [rules]
 * @returns {{ results: Array<{ id:string, description:string, severity:string, status:RuleStatus, detail:string, offenders:string[] }>, summary: { pass:number, fail:number, skipped:number } }}
 */
export function evaluateRules(graph, rules = DEFAULT_RULES) {
  const results = [];
  let pass = 0;
  let fail = 0;
  let skipped = 0;

  for (const rule of rules) {
    let ruleResult;
    try {
      ruleResult = rule.check(graph);
    } catch {
      ruleResult = { status: 'skipped', detail: 'Rule threw unexpectedly; skipped for safety.', offenders: [] };
    }
    const status = ruleResult.status ?? 'skipped';
    if (status === 'pass') pass += 1;
    else if (status === 'fail') fail += 1;
    else skipped += 1;

    results.push({
      id: rule.id,
      description: rule.description,
      severity: rule.severity,
      status,
      detail: ruleResult.detail ?? '',
      offenders: Array.isArray(ruleResult.offenders) ? ruleResult.offenders : [],
    });
  }

  return { results, summary: { pass, fail, skipped } };
}
