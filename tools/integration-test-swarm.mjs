#!/usr/bin/env node
/**
 * ContextDevKit integration test — SWARM coordinator engine (ADR-0051).
 *
 * Covers the contracts the ADR locks: planner determinism + refusals (rule 8),
 * test-home expansion (the P0 baseline finding), disjoint partition + caps,
 * manifest atomicity + append-only history, eviction via staleness, the
 * budget-park status path, the `swarm-dispatch` consent area, and the `by`
 * attribution field on state.json events.
 *
 * Run:  node tools/integration-test-swarm.mjs   (exit 0 = healthy)
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reporter } from './it-helpers.mjs';
import { checkEligibility } from '../templates/contextkit/runtime/config/autonomy-eligibility.mjs';
import { resolveAutonomy } from '../templates/contextkit/runtime/config/resolve-autonomy.mjs';
import { appendEvent } from '../templates/contextkit/runtime/state/state-io.mjs';
import { deriveTouchSet, expandWithTestHomes, planSwarm, HARD_MAX_WORKSTREAMS } from '../templates/contextkit/tools/scripts/swarm-plan.mjs';
import { byModel, createRun, evictStale, listRuns, manifestPath, readRun, renderReport, updateWorkstream, WS_STATUSES } from '../templates/contextkit/tools/scripts/swarm-state.mjs';
import { aliasForTier } from '../templates/contextkit/tools/scripts/model-policy.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\n🌀 ContextDevKit integration test — swarm coordinator (ADR-0051)\n');

const root = mkdtempSync(join(tmpdir(), 'ckit-swarm-'));

try {
  // ── swarm-plan: pure planner ─────────────────────────────────────────────
  const repoFiles = ['templates/ctx.mjs', 'templates/INSTRUCTIONS.md.tpl', 'src/auth/login.mjs', 'src/auth/token.mjs', 'docs/guide.md'];
  const tasks = [
    { id: '1', stage: 'backlog', priority: 'P1', type: 'bug', title: 'fix replacement patterns in ctx.mjs output' },
    { id: '2', stage: 'backlog', priority: 'P2', type: 'chore', title: 'INSTRUCTIONS.md.tpl stale facts' },
    { id: '3', stage: 'backlog', priority: 'P2', type: 'feature', title: 'something with no path tokens at all' },
    { id: '4', stage: 'backlog', priority: 'P3', type: 'chore', title: 'rotate keys', paths: '[config/.env.prod]' },
    { id: '5', stage: 'backlog', priority: 'P0', type: 'bug', title: 'auth bug', paths: '[src/auth/]' },
    { id: '6', stage: 'working', priority: 'P0', type: 'bug', title: 'already working — not a candidate', paths: '[docs/guide.md]' },
  ];
  const input = { runId: 'run-a', tasks, repoFiles, config: { swarm: { maxWorkstreams: 3 } } };
  const planA = planSwarm(input);
  const planB = planSwarm(input);
  JSON.stringify(planA) === JSON.stringify(planB)
    ? ok('planner is deterministic (same inputs → byte-identical plan)') : bad('planner output differs across identical calls');

  const accepted = planA.workstreams.map((ws) => ws.taskId);
  accepted.includes('5') && accepted.includes('1') && accepted.includes('2')
    ? ok('planner accepts disjoint candidates ranked by priority') : bad(`unexpected acceptance set: ${accepted.join(',')}`);
  !accepted.includes('6')
    ? ok('non-backlog tasks are never candidates') : bad('planner picked a task already in working/');
  planA.refused.some((r) => r.taskId === '3' && /no derivable touch-set/.test(r.reason))
    ? ok('no derivable touch-set → refused with the fix named (rule 8)') : bad(`task 3 not refused: ${JSON.stringify(planA.refused)}`);
  planA.refused.some((r) => r.taskId === '4' && /secret/.test(r.reason))
    ? ok('secret-path touch-set → refused (floor)') : bad('secret-path task was not refused');

  // P0 finding: ctx.mjs expands into its shared test homes.
  const expanded = expandWithTestHomes(['templates/ctx.mjs']);
  expanded.includes('tools/integration-test-antigravity.mjs') && expanded.includes('tools/selfcheck-source-cases-recent.mjs')
    ? ok('touch-set expands with test-file homes (P0 baseline finding)') : bad(`test homes missing: ${expanded.join(',')}`);

  // Conflict partition: two tasks sharing a test home never run together
  // (ctx.mjs and the antigravity tree both land in integration-test-antigravity.mjs).
  const clash = planSwarm({ runId: 'run-b', repoFiles, config: {}, tasks: [
    { id: '7', stage: 'backlog', priority: 'P1', type: 'bug', title: 'a', paths: '[templates/ctx.mjs]' },
    { id: '8', stage: 'backlog', priority: 'P2', type: 'bug', title: 'b', paths: '[templates/antigravity/skills/x.md]' },
  ] });
  clash.workstreams.length === 1 && clash.deferred.includes('8')
    ? ok('overlapping expanded touch-sets → younger candidate deferred, never parallel') : bad(`expected a deferral: ${JSON.stringify(clash)}`);

  // l5 high-risk without a receipt → refused; with a receipt → accepted.
  const riskyTask = [{ id: '9', stage: 'backlog', priority: 'P1', type: 'chore', title: 'hook tweak', paths: '[contextkit/runtime/hooks/x.mjs]' }];
  const riskyCfg = { l5: { highRiskPaths: ['contextkit/runtime/hooks/'] } };
  planSwarm({ runId: 'run-c', tasks: riskyTask, repoFiles, config: riskyCfg }).refused.some((r) => r.taskId === '9' && /simulate-impact/.test(r.reason))
    ? ok('l5 high-risk without receipt → refused, names the unlock') : bad('high-risk task not gated');
  planSwarm({ runId: 'run-d', tasks: riskyTask, repoFiles, config: riskyCfg, simulations: [{ taskId: '9', coveredPaths: ['contextkit/runtime/hooks/x.mjs'] }] }).workstreams.length === 1
    ? ok('l5 high-risk WITH a /simulate-impact receipt → accepted') : bad('receipt did not unlock the high-risk task');

  // Hard cap is a contract above config.
  const many = Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, stage: 'backlog', priority: 'P2', type: 'chore', title: `t${i}`, paths: `[zone${i}/]` }));
  const capped = planSwarm({ runId: 'run-e', tasks: many, repoFiles: many.map((t, i) => `zone${i}/file.mjs`), config: { swarm: { maxWorkstreams: 99 } } });
  capped.workstreams.length === HARD_MAX_WORKSTREAMS
    ? ok(`config cannot exceed the hard cap (${HARD_MAX_WORKSTREAMS} workstreams)`) : bad(`cap broken: ${capped.workstreams.length}`);
  deriveTouchSet({ id: 'x', title: 'mentions guide.md somewhere' }, repoFiles).includes('docs/guide.md')
    ? ok('touch-set inference resolves unique basenames from the title') : bad('basename inference failed');

  // ── swarm-state: manifest ────────────────────────────────────────────────
  const run = createRun(root, { runId: 'run-a', grade: 3, workstreams: planA.workstreams });
  run.workstreams.every((ws) => ws.status === 'planned' && ws.history.length === 1)
    ? ok('createRun: every workstream starts planned with one history entry') : bad('createRun initial state wrong');
  let threwOnDup = false;
  try { createRun(root, { runId: 'run-a', grade: 3, workstreams: planA.workstreams }); } catch { threwOnDup = true; }
  threwOnDup ? ok('runIds are single-use (duplicate createRun throws)') : bad('duplicate runId accepted');

  updateWorkstream(root, 'run-a', 'ws-5', { status: 'dispatched' });
  updateWorkstream(root, 'run-a', 'ws-5', { status: 'working', tokens: 1234 });
  updateWorkstream(root, 'run-a', 'ws-5', { status: 'parked-budget', note: 'budget-exhausted' });
  const after = readRun(root, 'run-a').workstreams.find((ws) => ws.id === 'ws-5');
  after.status === 'parked-budget' && after.tokens === 1234 && after.history.length === 4 && after.history[0].status === 'planned'
    ? ok('updateWorkstream: status path + tokens recorded, history append-only (budget-park path)') : bad(`workstream record wrong: ${JSON.stringify(after)}`);
  let threwOnBadStatus = false;
  try { updateWorkstream(root, 'run-a', 'ws-5', { status: 'done' }); } catch { threwOnBadStatus = true; }
  threwOnBadStatus ? ok('unknown workstream status throws (refuse-by-default — no "done" in the swarm)') : bad('invalid status accepted');
  !WS_STATUSES.includes('done')
    ? ok('status vocabulary has no terminal "done" — runs finish at parked-testing (ADR-0051 §6)') : bad('WS_STATUSES contains done');

  // Eviction: stale active workstream → evicted; parked ones untouched.
  updateWorkstream(root, 'run-a', 'ws-1', { status: 'working' });
  const manifest = readRun(root, 'run-a');
  manifest.workstreams.find((ws) => ws.id === 'ws-1').heartbeatTs = Date.now() - 90 * 60 * 1000;
  // Direct write to simulate silence (test-only): reuse the atomic writer through createRun's path is not exposed — patch via fs.
  const { writeFileSync } = await import('node:fs');
  writeFileSync(manifestPath(root, 'run-a'), JSON.stringify(manifest, null, 2));
  const evicted = evictStale(root, 'run-a', 30);
  evicted.includes('ws-1') && !evicted.includes('ws-5')
    ? ok('evictStale marks silent ACTIVE workstreams only (parked untouched)') : bad(`eviction wrong: ${JSON.stringify(evicted)}`);
  readRun(root, 'run-a').workstreams.find((ws) => ws.id === 'ws-1').status === 'evicted'
    ? ok('evicted status persisted with a history entry') : bad('eviction not persisted');
  listRuns(root).length === 1 && /Swarm run run-a/.test(renderReport(readRun(root, 'run-a')))
    ? ok('listRuns + renderReport read the manifest back') : bad('list/report broken');

  // ── byModel attribution: the fan-out's true tier mix (ADR-0052 Phase 2) ──
  // The swarm plans by tierHint; the coordinator resolves it to a concrete alias
  // and records it so "were all N agents on opus?" is answered with data.
  const tierRun = createRun(root, { runId: 'run-tiers', grade: 3, workstreams: [
    { id: 'ws-a', taskId: '10', branch: 'b/a', worktree: 'w/a', touchSet: ['x'], model: aliasForTier('fast').model },
    { id: 'ws-b', taskId: '11', branch: 'b/b', worktree: 'w/b', touchSet: ['y'], model: aliasForTier('powerful').model },
  ] });
  tierRun.workstreams.find((ws) => ws.id === 'ws-a').model === 'haiku' && tierRun.workstreams.find((ws) => ws.id === 'ws-b').model === 'sonnet'
    ? ok('createRun records the resolved model alias per workstream (fast→haiku, powerful→sonnet)') : bad('model alias not recorded on the workstream');
  updateWorkstream(root, 'run-tiers', 'ws-a', { status: 'working', tokens: 500 });
  updateWorkstream(root, 'run-tiers', 'ws-b', { status: 'working', tokens: 2000, model: aliasForTier('reasoning').model });
  const mix = byModel(readRun(root, 'run-tiers'));
  const haiku = mix.find((m) => m.model === 'haiku');
  const opus = mix.find((m) => m.model === 'opus');
  haiku?.count === 1 && haiku?.tokens === 500 && opus?.count === 1 && opus?.tokens === 2000
    ? ok('byModel aggregates count + tokens per tier (escalation re-stamps the alias)') : bad(`byModel wrong: ${JSON.stringify(mix)}`);
  /models: /.test(renderReport(readRun(root, 'run-tiers')))
    ? ok('renderReport surfaces the per-model breakdown line') : bad('report missing the models: line');

  // ── consent area + event attribution ────────────────────────────────────
  const at = (grade) => ({ autonomy: { grade }, deliberations: { active: true } });
  const dispatchModes = [1, 2, 3, 4].map((g) => resolveAutonomy('swarm-dispatch', at(g)).mode);
  JSON.stringify(dispatchModes) === JSON.stringify(['manual', 'manual', 'suggest', 'auto'])
    ? ok('swarm-dispatch area row is [manual,manual,suggest,auto] (ADR-0051 §4)') : bad(`area row wrong: ${dispatchModes.join(',')}`);
  resolveAutonomy('swarm-dispatch', at(4), null, { budgetExhausted: true }).mode === 'manual'
    ? ok('grade-4 swarm-dispatch + budget-exhausted → grade-2 behaviour (manual)') : bad('budget downgrade missing on swarm-dispatch');

  const pipeDir = join(root, 'pipe');
  appendEvent(pipeDir, '77', { from: 'backlog', to: 'working', actor: 'auto', by: { runId: 'run-a', workstream: 'ws-5', agent: 'qa-unit', forged: 'dropped' } });
  appendEvent(pipeDir, '77', { from: 'working', to: 'testing', actor: 'qa' });
  const events = JSON.parse(readFileSync(join(pipeDir, 'state', '77', 'state.json'), 'utf-8')).events;
  events[0].by?.runId === 'run-a' && events[0].by?.workstream === 'ws-5' && events[0].by?.agent === 'qa-unit' && !('forged' in events[0].by)
    ? ok('appendEvent records by{runId,workstream,agent}, drops unknown keys (ADR-0051 §5)') : bad(`by field wrong: ${JSON.stringify(events[0])}`);
  events[1].by === undefined
    ? ok('non-swarm events carry no by field (purely additive)') : bad('by leaked into a plain event');

  // ── config schema pins the swarm caps (ADR-0051 §7) ─────────────────────
  // schema.mjs needs the optional zod dep (a devDependency here) — when absent,
  // report SKIPPED, never pass (rule 8: refused-silently-to-false-negative).
  const schemaModule = await import('../templates/contextkit/runtime/config/schema.mjs').catch(() => null);
  if (!schemaModule) {
    console.log('  ⊘ schema cells SKIPPED — zod not installed (devDependency); not counted as pass');
  } else {
    const { validateConfig } = schemaModule;
    const overCap = validateConfig({ swarm: { maxWorkstreams: 9 } });
    !overCap.ok ? ok('schema refuses swarm.maxWorkstreams above the hard cap (5)') : bad('schema accepted maxWorkstreams 9');
    // Runtime defaults live in defaults.mjs (the schema's job is refusal) — so
    // assert valid values pass through and an absent block doesn't fail.
    const atCap = validateConfig({ swarm: { maxWorkstreams: 5, staleMinutes: 45 } });
    atCap.ok && atCap.config.swarm.maxWorkstreams === 5 && atCap.config.swarm.staleMinutes === 45
      ? ok('schema passes valid swarm values through (cap boundary ok)') : bad(`valid swarm config rejected: ${JSON.stringify(atCap)}`);
    validateConfig({}).ok
      ? ok('schema accepts a config with no swarm block (defaults.mjs owns defaults)') : bad('schema rejected an empty config');
  }

  // ── grade-4 eligibility refuses-by-default on an empty root (ADR-0045) ──
  const bareVerdict = checkEligibility(root);
  bareVerdict.eligible === false && bareVerdict.criteria.every((criterion) => typeof criterion.pass === 'boolean')
    ? ok('checkEligibility on a bare root: not eligible, every criterion explicit (rule 8)') : bad(`eligibility leaked a pass: ${JSON.stringify(bareVerdict)}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

rep.finish('swarm coordinator integration');
