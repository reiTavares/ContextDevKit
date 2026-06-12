#!/usr/bin/env node
/**
 * swarm-plan — pure workstream planner for the swarm coordinator (ADR-0051 §1).
 *
 * Ranks backlog candidates, derives a predicted touch-set per task, expands it
 * with the task's likely TEST-FILE homes (the P0 baseline finding: rule 3 makes
 * every workstream touch shared test shards — they are the dominant conflict
 * surface), and greedily partitions into K provably disjoint workstreams.
 *
 * Refusals (rule 8, all reported — never silent):
 *   - no derivable touch-set            → refused from auto-swarm
 *   - touch-set hits a secret path      → refused (floor)
 *   - touch-set hits l5.highRiskPaths   → refused unless a /simulate-impact
 *     receipt covers it (the planner consumes receipts, it never grants them)
 *
 * `planSwarm()` is PURE — same inputs, same plan. The CLI gathers I/O
 * (cards via pipeline-tasks, repo files via `git ls-files`) and prints JSON
 * ready for swarm-state `createRun`.
 *
 * CLI: node swarm-plan.mjs --run-id <id> [--top N] [--json]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { matchHighRisk, matchSecret } from '../../runtime/hooks/path-classification.mjs';
import { listTasks } from './pipeline-tasks.mjs';
import { parseInlineArray } from './pipeline-validate.mjs';

/** Hard cap on parallel workstreams — a CONTRACT (ADR-0051 §7), above config. */
export const HARD_MAX_WORKSTREAMS = 5;

/**
 * Shared test shards by touched-area prefix — the P0 finding, encoded. Any
 * workstream predicted to touch `prefix` is assumed to also touch these test
 * homes, so two tasks in the same area never run in parallel blind.
 */
export const TEST_HOME_RULES = Object.freeze([
  { prefix: 'templates/contextkit/runtime/', homes: ['tools/selfcheck-gates.mjs', 'tools/integration-test-autonomy.mjs'] },
  { prefix: 'templates/contextkit/tools/scripts/', homes: ['tools/integration-test-tooling.mjs', 'tools/selfcheck-templates.mjs'] },
  { prefix: 'templates/claude/', homes: ['tools/selfcheck-templates.mjs'] },
  { prefix: 'templates/antigravity/', homes: ['tools/integration-test-antigravity.mjs', 'tools/selfcheck-templates.mjs'] },
  { prefix: 'templates/ctx.mjs', homes: ['tools/integration-test-antigravity.mjs', 'tools/selfcheck-source-cases-recent.mjs'] },
  { prefix: 'templates/INSTRUCTIONS.md.tpl', homes: ['tools/selfcheck-templates.mjs'] }, // P0 measured: 143's guard landed here, not in the antigravity suite
]);

const normalize = (path) => String(path).replaceAll('\\', '/').replace(/^\.\//, '');

/**
 * Derives the predicted touch-set for one task card (ADR-0051 §1 order):
 * explicit `paths:` frontmatter → /simulate-impact receipt coverage →
 * basename/path-token inference from the title against the repo file list.
 * Returns [] when nothing is derivable (the caller refuses the task).
 */
export function deriveTouchSet(task, repoFiles, simulations = []) {
  if (task.paths) {
    const explicit = parseInlineArray(task.paths).map(normalize).filter(Boolean);
    if (explicit.length > 0) return explicit;
  }
  const receipt = simulations.find((sim) => (sim.taskId != null && String(sim.taskId) === String(task.id)));
  if (receipt && Array.isArray(receipt.coveredPaths) && receipt.coveredPaths.length > 0) return receipt.coveredPaths.map(normalize);
  // Inference: any token in the title that names a repo file (by exact path or
  // unique basename) or a directory prefix. Deterministic; ambiguity = skip token.
  const tokens = String(task.title || '').match(/[\w./-]+\.[a-z]{2,4}|[\w-]+\//gi) ?? [];
  const found = new Set();
  for (const rawToken of tokens) {
    const token = normalize(rawToken);
    const exact = repoFiles.filter((file) => file === token);
    const byBase = exact.length > 0 ? exact : repoFiles.filter((file) => basename(file) === basename(token) && token.includes('.'));
    if (byBase.length === 1) found.add(byBase[0]);
    else if (token.endsWith('/')) for (const file of repoFiles) { if (file.startsWith(token)) found.add(file); }
  }
  return [...found];
}

/** Expands a touch-set with its likely test-file homes (P0 finding). */
export function expandWithTestHomes(touchSet) {
  const expanded = new Set(touchSet.map(normalize));
  for (const path of touchSet) {
    for (const rule of TEST_HOME_RULES) {
      if (normalize(path).startsWith(rule.prefix)) for (const home of rule.homes) expanded.add(home);
    }
  }
  return [...expanded];
}

const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };
/** Deterministic candidate ranking: priority, then wsjf desc, then id asc. */
export function rankCandidates(tasks) {
  return [...tasks].sort((a, b) =>
    (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9)
    || (Number(b.wsjf) || 0) - (Number(a.wsjf) || 0)
    || String(a.id).localeCompare(String(b.id), 'en', { numeric: true }));
}

/**
 * The pure planner. Greedy disjoint partition over ranked backlog candidates.
 *
 * @param {{ runId: string, tasks: object[], repoFiles: string[], config?: object,
 *           simulations?: Array<{ taskId?: string, coveredPaths?: string[] }>,
 *           repoName?: string }} input
 * @returns {{ runId: string, workstreams: object[], refused: Array<{ taskId: string, reason: string }>, deferred: string[] }}
 */
export function planSwarm({ runId, tasks, repoFiles, config = {}, simulations = [], repoName = 'repo' }) {
  if (!runId) throw new Error('swarm-plan: runId is required (determinism — the caller names the run)');
  const maxWorkstreams = Math.min(Number(config?.swarm?.maxWorkstreams) || 3, HARD_MAX_WORKSTREAMS);
  const highRiskPaths = config?.l5?.highRiskPaths ?? [];
  const extraSecretPaths = config?.autonomy?.extraSecretPaths ?? [];
  const candidates = rankCandidates(tasks.filter((task) => task.stage === 'backlog'));
  const workstreams = [];
  const refused = [];
  const deferred = [];
  const claimed = new Set();
  for (const task of candidates) {
    const rawSet = deriveTouchSet(task, repoFiles, simulations);
    if (rawSet.length === 0) { refused.push({ taskId: task.id, reason: 'no derivable touch-set (add paths: to the card or run /simulate-impact)' }); continue; }
    const secret = rawSet.map((path) => matchSecret(path, extraSecretPaths)).find(Boolean);
    if (secret) { refused.push({ taskId: task.id, reason: `floor: secret path (${secret})` }); continue; }
    const highRisk = rawSet.find((path) => matchHighRisk(path, highRiskPaths));
    const receiptCovers = simulations.some((sim) => String(sim.taskId ?? '') === String(task.id));
    if (highRisk && !receiptCovers) { refused.push({ taskId: task.id, reason: `l5 high-risk path (${highRisk}) without a /simulate-impact receipt` }); continue; }
    const touchSet = expandWithTestHomes(rawSet);
    if (workstreams.length >= maxWorkstreams) { deferred.push(task.id); continue; }
    if (touchSet.some((path) => claimed.has(path))) { deferred.push(task.id); continue; }
    for (const path of touchSet) claimed.add(path);
    workstreams.push({
      id: `ws-${task.id}`,
      taskId: String(task.id),
      branch: `swarm/${runId}/${task.id}`,
      worktree: `../${repoName}-sw-${task.id}`,
      touchSet,
      tierHint: task.type === 'chore' ? 'fast' : 'powerful', // ADR-0052 — the orchestrator may override per think/execute rules
      title: task.title,
    });
  }
  return { runId, workstreams, refused, deferred };
}

// ---------------------------------------------------------------- thin CLI
const isMain = process.argv[1] && resolve(process.argv[1]).endsWith('swarm-plan.mjs');
if (isMain) {
  const argv = process.argv.slice(2);
  const arg = (flag) => { const at = argv.indexOf(flag); return at >= 0 ? argv[at + 1] : null; };
  const runId = arg('--run-id');
  if (!runId) { console.error('Usage: swarm-plan.mjs --run-id <id> [--top N]'); process.exit(1); }
  const root = process.cwd();
  const paths = pathsFor(root);
  const repoFiles = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf-8' }).split('\n').filter(Boolean).map(normalize);
  let config = {};
  try { config = JSON.parse(readFileSync(paths.config, 'utf-8').replace(/^﻿/, '')); } catch { /* defaults apply */ }
  const top = Number(arg('--top'));
  if (top > 0) config = { ...config, swarm: { ...config.swarm, maxWorkstreams: Math.min(top, config?.swarm?.maxWorkstreams ?? top) } };
  const plan = planSwarm({ runId, tasks: listTasks(paths.pipeline), repoFiles, config, repoName: basename(root) });
  console.log(JSON.stringify(plan, null, 2));
}
