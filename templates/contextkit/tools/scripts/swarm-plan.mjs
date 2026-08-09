#!/usr/bin/env node
/**
 * Optional, pure workstream planner over one canonical v4 task scope.
 *
 * Touch hints improve conflict prediction but are never an admission gate.
 * Routing, specialist, and model fields are deliberately absent: the active
 * agent or host may request recommendations after accepting the plan.
 */
import { basename, resolve } from 'node:path';
import { loadConfigSync } from '../../runtime/config/load.mjs';
import { matchHighRisk, matchSecret } from '../../runtime/hooks/path-classification.mjs';
import { listTasks, readTasksDocument } from './tasks-store.mjs';

export const TEST_HOME_RULES = Object.freeze([
  { prefix: 'templates/contextkit/runtime/', homes: ['tools/selfcheck-gates.mjs', 'tools/integration-test-advisory-policy.mjs'] },
  { prefix: 'templates/contextkit/tools/scripts/', homes: ['tools/integration-test-tooling.mjs', 'tools/selfcheck-templates.mjs'] },
  { prefix: 'templates/claude/', homes: ['tools/selfcheck-templates.mjs'] },
  { prefix: 'templates/antigravity/', homes: ['tools/integration-test-antigravity.mjs', 'tools/selfcheck-templates.mjs'] },
  { prefix: 'templates/ctx.mjs', homes: ['tools/integration-test-antigravity.mjs', 'tools/selfcheck-source-cases-recent.mjs'] },
  { prefix: 'templates/INSTRUCTIONS.md.tpl', homes: ['tools/selfcheck-templates.mjs'] },
]);

const normalize = (path) => String(path).replaceAll('\\', '/').replace(/^\.\//, '');

/**
 * Derives an advisory conflict set from canonical touch hints, an optional
 * simulation, or unambiguous filename tokens in the title.
 *
 * @param {object} task canonical task
 * @param {string[]} repoFiles optional repository file catalogue
 * @param {Array<{taskId?:string,coveredPaths?:string[]}>} simulations optional observations
 * @returns {string[]}
 */
export function deriveTouchSet(task, repoFiles = [], simulations = []) {
  if (Array.isArray(task?.touchHints)) {
    const explicit = task.touchHints.map(normalize).filter(Boolean);
    if (explicit.length > 0) return [...new Set(explicit)].sort();
  }
  const simulation = simulations.find((entry) => String(entry.taskId ?? '') === String(task?.id ?? ''));
  if (Array.isArray(simulation?.coveredPaths) && simulation.coveredPaths.length > 0) {
    return [...new Set(simulation.coveredPaths.map(normalize).filter(Boolean))].sort();
  }
  const tokens = String(task?.title ?? '').match(/[\w./-]+\.[a-z0-9]{1,8}|[\w-]+\//gi) ?? [];
  const found = new Set();
  for (const rawToken of tokens) {
    const token = normalize(rawToken);
    const exact = repoFiles.filter((file) => normalize(file) === token);
    const byBasename = exact.length > 0
      ? exact
      : repoFiles.filter((file) => basename(normalize(file)) === basename(token) && token.includes('.'));
    if (byBasename.length === 1) found.add(normalize(byBasename[0]));
    else if (token.endsWith('/')) {
      for (const file of repoFiles.map(normalize)) if (file.startsWith(token)) found.add(file);
    }
  }
  return [...found].sort();
}

/** @param {string[]} touchSet @returns {string[]} */
export function expandWithTestHomes(touchSet) {
  const expanded = new Set(touchSet.map(normalize));
  for (const path of touchSet) {
    for (const rule of TEST_HOME_RULES) {
      if (normalize(path).startsWith(rule.prefix)) for (const home of rule.homes) expanded.add(home);
    }
  }
  return [...expanded].sort();
}

const PRIORITY_ORDER = Object.freeze({ P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 });

/** @param {object[]} tasks @returns {object[]} */
export function rankCandidates(tasks) {
  return [...tasks].sort((left, right) =>
    (PRIORITY_ORDER[left.priority] ?? 9) - (PRIORITY_ORDER[right.priority] ?? 9)
    || String(left.id).localeCompare(String(right.id), 'en', { numeric: true }));
}

/** @param {object} task @param {Map<string,object>} tasksById @returns {boolean} */
function dependenciesReady(task, tasksById) {
  return (task.dependsOn ?? []).every((dependencyId) => tasksById.get(String(dependencyId))?.status === 'done');
}

/**
 * Plans independent workstreams without granting or denying dispatch authority.
 *
 * @param {{runId:string,tasks:object[],repoFiles?:string[],config?:object,
 * simulations?:object[],repoName?:string,requestedTop?:number|null,
 * hostTechnicalLimit?:number|null}} input
 * @returns {{runId:string,workstreams:object[],deferred:string[],diagnostics:string[]}}
 */
export function planSwarm({
  runId,
  tasks,
  repoFiles = [],
  config = {},
  simulations = [],
  repoName = 'repo',
  requestedTop = null,
  hostTechnicalLimit = config?.swarm?.hostTechnicalLimit ?? null,
}) {
  if (!runId) throw new Error('swarm-plan: runId is required');
  if (!Array.isArray(tasks)) throw new TypeError('swarm-plan: tasks must be an array');
  const ownerLimit = Number.isInteger(Number(requestedTop)) && Number(requestedTop) > 0
    ? Number(requestedTop)
    : Number.POSITIVE_INFINITY;
  const technicalLimit = Number.isInteger(Number(hostTechnicalLimit)) && Number(hostTechnicalLimit) > 0
    ? Number(hostTechnicalLimit)
    : Number.POSITIVE_INFINITY;
  const maximum = Math.min(ownerLimit, technicalLimit);
  const tasksById = new Map(tasks.map((task) => [String(task.id), task]));
  const candidates = rankCandidates(tasks.filter((task) => task.status === 'backlog'));
  const workstreams = [];
  const deferred = [];
  const diagnostics = [];
  const claimed = new Set();
  const highRiskPaths = config?.l5?.highRiskPaths ?? [];
  const extraSecretPaths = config?.riskAcknowledgement?.extraSecretPaths ?? [];

  for (const task of candidates) {
    if (!dependenciesReady(task, tasksById)) {
      deferred.push(String(task.id));
      diagnostics.push(`${task.id}: dependencies are not done`);
      continue;
    }
    const observed = deriveTouchSet(task, repoFiles, simulations);
    const warnings = [];
    if (observed.length === 0) warnings.push('conflict-prediction-unavailable');
    const secret = observed.map((path) => matchSecret(path, extraSecretPaths)).find(Boolean);
    if (secret) warnings.push(`secret-path-observed:${secret}`);
    const highRisk = observed.find((path) => matchHighRisk(path, highRiskPaths));
    if (highRisk) warnings.push(`high-risk-path-observed:${highRisk}`);
    const touchSet = expandWithTestHomes(observed);
    if (workstreams.length >= maximum || touchSet.some((path) => claimed.has(path))) {
      deferred.push(String(task.id));
      continue;
    }
    for (const path of touchSet) claimed.add(path);
    workstreams.push({
      id: `ws-${task.id}`,
      taskId: String(task.id),
      branch: `swarm/${runId}/${task.id}`,
      worktree: `../${repoName}-sw-${task.id}`,
      touchSet,
      title: task.title,
      warnings,
    });
  }
  return { runId, workstreams, deferred, diagnostics };
}

if (process.argv[1] && resolve(process.argv[1]).endsWith('swarm-plan.mjs')) {
  const argv = process.argv.slice(2);
  const argument = (flag) => { const index = argv.indexOf(flag); return index >= 0 ? argv[index + 1] : null; };
  const runId = argument('--run-id');
  const target = argument('--tasks');
  if (!runId || !target) {
    console.error('Usage: swarm-plan.mjs --run-id <id> --tasks <scope-or-tasks.json> [--top N]');
    process.exit(1);
  }
  const top = Number(argument('--top'));
  const document = readTasksDocument(target);
  const plan = planSwarm({
    runId,
    tasks: listTasks(document),
    config: loadConfigSync(process.cwd()),
    repoName: basename(process.cwd()),
    requestedTop: top > 0 ? top : null,
  });
  console.log(JSON.stringify(plan, null, 2));
}
