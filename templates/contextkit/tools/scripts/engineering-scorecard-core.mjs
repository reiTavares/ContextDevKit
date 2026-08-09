/**
 * Pure advisory engineering scorecard for ContextDevKit 4.
 *
 * Missing inputs are skipped with a null score and never enter the overall
 * mean. The scorecard reads canonical task fields and graph relations; it does
 * not recreate capability receipts or any parallel evidence store.
 */

/** @param {number} score @returns {'strong'|'fair'|'weak'} */
function scoreToBand(score) {
  if (score >= 80) return 'strong';
  if (score >= 60) return 'fair';
  return 'weak';
}

/** @param {number} count @returns {'high'|'medium'|'low'|'none'} */
function countToConfidence(count) {
  if (count >= 5) return 'high';
  if (count >= 3) return 'medium';
  if (count >= 1) return 'low';
  return 'none';
}

/** @param {string} key @param {string} reason @returns {object} */
function skipped(key, reason) {
  return { key, score: null, band: null, status: 'skipped', detail: reason };
}

/** @param {string} key @param {number} rawScore @param {string} detail @returns {object} */
function scored(key, rawScore, detail) {
  const score = Math.max(0, Math.min(100, rawScore));
  return { key, score, band: scoreToBand(score), status: 'scored', detail };
}

/**
 * Scores factual evidence/report references stored on canonical done tasks.
 *
 * @param {object|null} graph lineage graph
 * @returns {object}
 */
function scoreTaskEvidenceCoverage(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const doneTasks = nodes.filter((node) => node.type === 'card' && node.ref?.status === 'done');
  if (doneTasks.length === 0) return skipped('task-evidence-coverage', 'no done tasks in canonical authority');
  const evidenced = doneTasks.filter((task) =>
    (task.ref?.evidenceRefs?.length ?? 0) > 0 || (task.ref?.reportRefs?.length ?? 0) > 0,
  ).length;
  return scored(
    'task-evidence-coverage',
    (evidenced / doneTasks.length) * 100,
    `${evidenced}/${doneTasks.length} done tasks retain evidenceRefs/reportRefs`,
  );
}

/**
 * Scores workflow-scoped tasks that are linked to their canonical workflow.
 *
 * @param {object|null} graph lineage graph
 * @returns {object}
 */
function scoreWorkflowLinkage(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const workflowTasks = nodes.filter((node) =>
    node.type === 'card' && /^WF-\d{4}$/.test(String(node.ref?.scopeRef ?? '')),
  );
  if (workflowTasks.length === 0) return skipped('workflow-linkage', 'no workflow-scoped tasks in canonical authority');
  const linkedTaskIds = new Set(edges.filter((edge) => edge.rel === 'ships').map((edge) => edge.to));
  const linked = workflowTasks.filter((task) => linkedTaskIds.has(task.id)).length;
  return scored('workflow-linkage', (linked / workflowTasks.length) * 100,
    `${linked}/${workflowTasks.length} workflow tasks link to their workflow`);
}

/** @param {object|null} rulesResult @returns {object} */
function scoreRuleHealth(rulesResult) {
  const summary = rulesResult?.summary;
  const pass = typeof summary?.pass === 'number' ? summary.pass : 0;
  const fail = typeof summary?.fail === 'number' ? summary.fail : 0;
  const evaluated = pass + fail;
  if (evaluated === 0) return skipped('rule-health', 'no lineage rules evaluated');
  return scored('rule-health', (pass / evaluated) * 100,
    `${pass} pass / ${fail} fail out of ${evaluated} rules evaluated`);
}

/** @param {object|null} complianceSummary @returns {object} */
function scoreCapabilityCompliance(complianceSummary) {
  const total = typeof complianceSummary?.total === 'number' ? complianceSummary.total : 0;
  if (total === 0) return skipped('capability-compliance', 'capability registry empty or unavailable');
  const parity = typeof complianceSummary.parity === 'number' ? complianceSummary.parity : 0;
  return scored('capability-compliance', (parity / total) * 100,
    `${parity}/${total} capabilities at full host parity`);
}

/** @param {object|null} calibrationResult @returns {object} */
function scoreCalibration(calibrationResult) {
  const accuracy = calibrationResult?.overall?.accuracy;
  if (typeof accuracy !== 'number') return skipped('calibration', 'no reviewed predictions');
  const percentage = accuracy * 100;
  return scored('calibration', percentage, `prediction calibration accuracy: ${percentage.toFixed(1)}%`);
}

/** @param {object|null} benchmarkSummary @returns {object} */
function scoreBenchmarkCompletion(benchmarkSummary) {
  const total = typeof benchmarkSummary?.count === 'number' ? benchmarkSummary.count : 0;
  if (total === 0) return skipped('benchmark-completion', 'no benchmark records');
  const completed = typeof benchmarkSummary.completedCount === 'number' ? benchmarkSummary.completedCount : 0;
  return scored('benchmark-completion', (completed / total) * 100,
    `${completed}/${total} benchmark tasks completed`);
}

/**
 * Scores available advisory dimensions and computes their honest mean.
 *
 * @param {{lineageGraph?:object|null,calibration?:object|null,rules?:object|null,compliance?:object|null,benchmark?:object|null}} inputs
 * @returns {{dimensions:object[],overall:{score:number|null,band:string|null,scoredCount:number,totalCount:number,confidence:string}}}
 */
export function scoreDimensions(inputs) {
  const source = inputs && typeof inputs === 'object' ? inputs : {};
  const dimensions = [
    scoreTaskEvidenceCoverage(source.lineageGraph ?? null),
    scoreWorkflowLinkage(source.lineageGraph ?? null),
    scoreRuleHealth(source.rules ?? null),
    scoreCapabilityCompliance(source.compliance ?? null),
    scoreCalibration(source.calibration ?? null),
    scoreBenchmarkCompletion(source.benchmark ?? null),
  ];
  const scoredDimensions = dimensions.filter((dimension) => dimension.status === 'scored');
  const scoredCount = scoredDimensions.length;
  const overallScore = scoredCount === 0
    ? null
    : Math.round((scoredDimensions.reduce((sum, dimension) => sum + dimension.score, 0) / scoredCount) * 10) / 10;
  return {
    dimensions,
    overall: {
      score: overallScore,
      band: overallScore === null ? null : scoreToBand(overallScore),
      scoredCount,
      totalCount: dimensions.length,
      confidence: countToConfidence(scoredCount),
    },
  };
}
