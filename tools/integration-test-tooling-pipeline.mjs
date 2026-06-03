#!/usr/bin/env node
/**
 * VibeDevKit integration test — TOOLING / DevPipeline.
 *
 * Sibling of `integration-test-tooling.mjs`. Extracted as a responsibility
 * seam (ADR-0016 H1 fix) because the DevPipeline test chain is internally
 * coupled (add → ingest → idempotent → prioritize → wsjf → bugs share fixture
 * state) and was the natural unit to split out when the tooling file crossed
 * the line-budget RED zone. Each sibling installs its own fixture — the cost
 * is one extra install; the benefit is a focused, under-budget file per
 * responsibility.
 *
 * Run:  node tools/integration-test-tooling-pipeline.mjs   (exit 0 = healthy)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KIT, run, reporter, installFixture } from './it-helpers.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\n🌀 VibeDevKit integration test — tooling / DevPipeline\n');
const fx = installFixture(rep);
const { proj, script } = fx;

try {
  // DevPipeline: add → move → sync reflects in devpipeline.md.
  script('pipeline.mjs', 'add', '--type', 'bug', '--priority', 'P1', '--title', 'login crash');
  const board1 = readFileSync(join(proj, 'vibekit', 'pipeline', 'devpipeline.md'), 'utf-8');
  board1.includes('login crash') && /Backlog \*\*1\*\*/.test(board1) ? ok('pipeline add → backlog on board') : bad('pipeline add not reflected');
  script('pipeline.mjs', 'move', '001', 'testing');
  const board2 = readFileSync(join(proj, 'vibekit', 'pipeline', 'devpipeline.md'), 'utf-8');
  /Testing \*\*1\*\*/.test(board2) ? ok('pipeline move → testing on board') : bad('pipeline move not reflected');

  // DevPipeline ingest: analysis findings flow into the backlog, auto-prioritized.
  writeFileSync(join(proj, 'findings.json'), JSON.stringify({ findings: [
    { kind: 'line-budget', severity: 5, path: 'src/big.js', line: 400, message: 'too big' },
    { kind: 'todo-marker', severity: 1, path: 'src/x.js', line: 3, message: 'leftover TODO' },
  ] }));
  script('pipeline.mjs', 'ingest', 'findings.json', '--type', 'chore');
  const ingested = JSON.parse(script('pipeline.mjs', 'list', '--json').stdout || '[]')
    .filter((t) => /^line-budget|^todo-marker/.test(t.source || ''));
  ingested.length === 2 && ingested.some((t) => t.priority === 'P1') && ingested.some((t) => t.priority === 'P3')
    ? ok('pipeline ingest creates auto-prioritized tasks from findings') : bad(`ingest failed: ${JSON.stringify(ingested)}`);
  /Ingested 0 finding/.test(script('pipeline.mjs', 'ingest', 'findings.json', '--type', 'chore').stdout || '')
    ? ok('pipeline ingest is idempotent (no duplicates)') : bad('ingest re-added duplicates');
  const lb = ingested.find((t) => /^line-budget/.test(t.source));
  script('pipeline.mjs', 'prioritize', lb.id, 'P0');
  JSON.parse(script('pipeline.mjs', 'list', '--json').stdout || '[]').find((t) => t.id === lb.id)?.priority === 'P0'
    ? ok('pipeline prioritize overrides the auto priority (user-editable)') : bad('prioritize did not change priority');

  // WSJF (SAFe) → priority + bug severity (S1-S4) → priority + SLA due date.
  script('pipeline.mjs', 'add', '--type', 'feature', '--title', 'wsjf item', '--wsjf', '8,9,5,3');
  script('pipeline.mjs', 'add', '--type', 'bug', '--title', 'sev bug', '--severity', 'S1');
  const prio = JSON.parse(script('pipeline.mjs', 'list', '--json').stdout || '[]');
  const wsjfT = prio.find((t) => t.title === 'wsjf item');
  const sevT = prio.find((t) => t.title === 'sev bug');
  wsjfT?.priority === 'P1' && Number(wsjfT.wsjf) > 0 && sevT?.priority === 'P0' && sevT?.sla
    ? ok('pipeline WSJF→priority, bug severity→priority, SLA due date') : bad(`WSJF/severity failed: ${JSON.stringify({ wsjfT, sevT })}`);

  // Known-bugs map: bug tasks grouped + a map file generated.
  script('pipeline.mjs', 'bugs');
  existsSync(join(proj, 'vibekit', 'pipeline', 'known-bugs.md')) &&
    readFileSync(join(proj, 'vibekit', 'pipeline', 'known-bugs.md'), 'utf-8').includes('sev bug')
    ? ok('known-bugs map generated + groups bug tasks') : bad('known-bugs map missing/empty');

  // ─ Ticket 040: task metadata v2 (DAG dependencies + complexity + spike/docs) ─
  script('pipeline.mjs', 'add', '--type', 'spike', '--title', 'spike-test', '--complexity', 'L', '--depends-on', '[001, 002]');
  const meta = JSON.parse(script('pipeline.mjs', 'list', '--json').stdout || '[]').find((t) => t.title === 'spike-test');
  meta?.type === 'spike' && meta?.complexity === 'L' && Array.isArray(meta?.dependencies) && meta.dependencies.length === 2
    ? ok('pipeline add accepts --type spike + --complexity + --depends-on (ticket 040)') : bad(`metadata v2 wrong: ${JSON.stringify(meta)}`);
  const boardV2 = readFileSync(join(proj, 'vibekit', 'pipeline', 'devpipeline.md'), 'utf-8');
  boardV2.includes('blocked by') ? ok('board renders "blocked by N" hint when dependencies are open (ticket 040)') : bad('blocked-by hint missing from board');
  // validate command: clean graph passes.
  const validClean = script('pipeline.mjs', 'validate');
  validClean.status === 0 ? ok('pipeline validate exits 0 on acyclic graph') : bad(`validate failed clean: ${validClean.stdout}${validClean.stderr}`);
  // Manually inject a cycle and prove validate refuses.
  const spikeFile = join(proj, 'vibekit', 'pipeline', 'backlog', `${meta.id}-spike-test.md`);
  writeFileSync(spikeFile, readFileSync(spikeFile, 'utf-8').replace(/^dependencies:.*$/m, `dependencies: [${meta.id}]`));
  const validCycle = script('pipeline.mjs', 'validate');
  validCycle.status !== 0 && /cycle/i.test(validCycle.stdout + validCycle.stderr)
    ? ok('pipeline validate refuses on dependency cycle (ticket 040)') : bad(`validate did not refuse cycle: status=${validCycle.status}`);

  // ─ ADR-0015 §B: working/ stage + tasks[] in workspace record + stale eviction ─
  existsSync(join(proj, 'vibekit', 'pipeline', 'working'))
    ? ok('working/ folder seeded post-install (ADR-0015 §B)')
    : bad('working/ folder missing');
  // Add a fresh task to start from a known state.
  script('pipeline.mjs', 'add', '--type', 'chore', '--title', 'wip-test');
  const wipTask = JSON.parse(script('pipeline.mjs', 'list', '--json').stdout || '[]').find((t) => t.title === 'wip-test');
  // Bootstrap the session pointer so claim.mjs can identify "this session".
  mkdirSync(join(proj, '.claude', '.sessions'), { recursive: true });
  writeFileSync(join(proj, '.claude', '.sessions', '.last-touched'), JSON.stringify({ sessionId: 'it-039', at: Date.now() }));
  // /pipeline start → moves to working/ + attaches to workspace.
  script('pipeline.mjs', 'start', wipTask.id);
  const afterStart = JSON.parse(script('pipeline.mjs', 'list', '--json').stdout || '[]').find((t) => t.id === wipTask.id);
  afterStart?.stage === 'working' ? ok('pipeline start → task moves to working/') : bad(`task stage after start = ${afterStart?.stage}`);
  const wsFile = join(proj, '.claude', '.workspace', 'it-039.json');
  const ws = existsSync(wsFile) ? JSON.parse(readFileSync(wsFile, 'utf-8')) : {};
  Array.isArray(ws.tasks) && ws.tasks.some((t) => t.id === wipTask.id)
    ? ok('claim.attachTask appends task to workspace tasks[]') : bad(`workspace tasks[] wrong: ${JSON.stringify(ws.tasks)}`);
  const workingBoard = readFileSync(join(proj, 'vibekit', 'pipeline', 'devpipeline.md'), 'utf-8');
  /Working \*\*\d+\*\*/.test(workingBoard) && /## 🔵 Working/.test(workingBoard)
    ? ok('pipeline-board renders Working count + section') : bad('working stage missing from board');
  // /pipeline stop → moves BACK to backlog (not testing), detaches.
  script('pipeline.mjs', 'stop', wipTask.id);
  const afterStop = JSON.parse(script('pipeline.mjs', 'list', '--json').stdout || '[]').find((t) => t.id === wipTask.id);
  afterStop?.stage === 'backlog' ? ok('pipeline stop → task moves BACK to backlog (not testing)') : bad(`task stage after stop = ${afterStop?.stage}`);
  const wsAfter = JSON.parse(readFileSync(wsFile, 'utf-8'));
  !wsAfter.tasks?.some((t) => t.id === wipTask.id) ? ok('claim.detachTask removes task from workspace tasks[]') : bad('task still attached after stop');
  // Stale eviction: artificially age a task's heartbeat past the configured threshold.
  script('pipeline.mjs', 'start', wipTask.id);
  const wsStale = JSON.parse(readFileSync(wsFile, 'utf-8'));
  wsStale.tasks[0].lastHeartbeat = Date.now() - (91 * 60 * 1000);
  wsStale.lastHeartbeat = Date.now(); // session itself stays alive
  writeFileSync(wsFile, JSON.stringify(wsStale, null, 2));
  script('workspace-sync.mjs');
  const afterEvict = JSON.parse(script('pipeline.mjs', 'list', '--json').stdout || '[]').find((t) => t.id === wipTask.id);
  afterEvict?.stage === 'backlog' ? ok('workspace-sync auto-evicts stale task back to backlog/') : bad(`stale evict failed: stage=${afterEvict?.stage}`);

  // ─ ADR-0015 §C: canonical state.json substrate (per-task + per-pipeline-run) ─
  script('pipeline.mjs', 'add', '--type', 'chore', '--title', 'state-test');
  const stTask = JSON.parse(script('pipeline.mjs', 'list', '--json').stdout || '[]').find((t) => t.title === 'state-test');
  script('pipeline.mjs', 'start', stTask.id);
  const stateFile = join(proj, 'vibekit', 'pipeline', stTask.id, 'state.json');
  existsSync(stateFile) ? ok('start writes state.json (ADR-0015 §C)') : bad('state.json not written on start');
  const state1 = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf-8')) : {};
  state1.kind === 'task' && state1.status === 'working' && typeof state1.startedAt === 'number'
    ? ok('state.json shape correct (kind=task, status=working, timestamps)') : bad(`state shape wrong: ${JSON.stringify(state1)}`);
  script('pipeline.mjs', 'stop', stTask.id);
  const state2 = JSON.parse(readFileSync(stateFile, 'utf-8'));
  state2.status === 'backlog' && typeof state2.endedAt === 'number'
    ? ok('stop stamps endedAt + flips status to backlog') : bad(`stop did not update state: ${JSON.stringify(state2)}`);
  script('pipeline.mjs', 'start', stTask.id);
  script('pipeline.mjs', 'move', stTask.id, 'conclusion');
  // The move's state.json mirror is fire-and-forget; poll briefly.
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && JSON.parse(readFileSync(stateFile, 'utf-8')).status !== 'done') { /* spin */ }
  const state3 = JSON.parse(readFileSync(stateFile, 'utf-8'));
  state3.status === 'done' && typeof state3.endedAt === 'number'
    ? ok('move conclusion mirrors into state.json (status=done, endedAt set)') : bad(`conclusion state wrong: ${JSON.stringify(state3)}`);

  // ─ ADR-0015 §C follow-up: /runs command reads state.json substrate ─
  const runsOut = script('runs.mjs').stdout || '';
  runsOut.includes('tasks') && runsOut.includes(stTask.id)
    ? ok('/runs lists tasks from state.json') : bad(`/runs output missing tasks: ${runsOut.slice(0, 200)}`);
  const runsJson = JSON.parse(script('runs.mjs', '--json').stdout || '{}');
  Array.isArray(runsJson.states) && runsJson.total >= 1
    ? ok('/runs --json returns machine-readable shape') : bad(`/runs --json shape wrong: ${JSON.stringify(runsJson).slice(0, 200)}`);
  const runsKindTask = JSON.parse(script('runs.mjs', '--json', '--kind', 'task').stdout || '{}');
  runsKindTask.states?.every((s) => s.kind === 'task')
    ? ok('/runs --kind task filters correctly') : bad('/runs --kind task did not filter');
  // No-state refusal: run from a sibling dir that has no vibekit/pipeline/*/state.json.
  const emptyDir = join(proj, 'apps', 'web');
  mkdirSync(emptyDir, { recursive: true });
  const noStateOut = run([join(KIT, 'templates/vibekit/tools/scripts/runs.mjs')], { cwd: emptyDir });
  String(noStateOut?.stdout || '').includes('No runs yet')
    ? ok('/runs prints clean refusal when no state files exist') : bad(`/runs no-state output: ${noStateOut?.stdout || noStateOut?.stderr}`);
} catch (err) {
  bad(`crashed: ${err?.stack || err}`);
} finally {
  fx.cleanup();
}

rep.finish('Integration (tooling — DevPipeline)');
