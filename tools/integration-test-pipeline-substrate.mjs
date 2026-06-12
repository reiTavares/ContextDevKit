#!/usr/bin/env node
/**
 * ContextDevKit integration test — TOOLING / DevPipeline execution substrate.
 *
 * Sibling of `integration-test-tooling-pipeline.mjs`, split out of it for the
 * line budget (the parent crossed the RED zone). This file owns the ADR-0015
 * execution-substrate chain: working/ stage + stale eviction (§B), the canonical
 * state.json substrate (§C), ADR-0053 legacy-state migration, /runs, plan-week
 * ranking (ticket 073), start-refuses-open-dependency (072), ship resume (074),
 * gh-triage watermark/dedupe (075), qa-reject legality (task 110), and the
 * consent-gated auto-transition + qa-approve sign-off (task 111 / ADR-0055).
 *
 * Each sibling installs its OWN fresh fixture — the cost is one extra install;
 * the benefit is a focused, under-budget file per responsibility.
 *
 * Run:  node tools/integration-test-pipeline-substrate.mjs   (exit 0 = healthy)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KIT, run, reporter, installFixture } from './it-helpers.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\n🌀 ContextDevKit integration test — tooling / DevPipeline substrate\n');
const fx = installFixture(rep);
const { proj, script } = fx;

try {
  // ─ ADR-0015 §B: working/ stage + tasks[] in workspace record + stale eviction ─
  existsSync(join(proj, 'contextkit', 'pipeline', 'working'))
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
  const workingBoard = readFileSync(join(proj, 'contextkit', 'pipeline', 'devpipeline.md'), 'utf-8');
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
  // ADR-0043 §3/§5: the eviction must be ON THE EVENT LOG (actor=evict) so the
  // audit trail is complete ("if it isn't an event, it didn't happen").
  const evictState = JSON.parse(readFileSync(join(proj, 'contextkit', 'pipeline', 'state', wipTask.id, 'state.json'), 'utf-8'));
  (evictState.events || []).some((e) => e.actor === 'evict' && e.from === 'working' && e.to === 'backlog')
    ? ok('stale eviction appends an actor=evict event (ADR-0043 §5)') : bad(`eviction left no evict event: ${JSON.stringify(evictState.events)}`);

  // ─ ADR-0015 §C: canonical state.json substrate (per-task + per-pipeline-run) ─
  script('pipeline.mjs', 'add', '--type', 'chore', '--title', 'state-test');
  const stTask = JSON.parse(script('pipeline.mjs', 'list', '--json').stdout || '[]').find((t) => t.title === 'state-test');
  script('pipeline.mjs', 'start', stTask.id);
  const stateFile = join(proj, 'contextkit', 'pipeline', 'state', stTask.id, 'state.json');
  existsSync(stateFile) ? ok('start writes state.json under pipeline/state/ (ADR-0015 §C / ADR-0053)') : bad('state.json not written on start');
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

  // ─ ADR-0053: a pre-existing flat state dir is migrated into pipeline/state/ ─
  const legacyDir = join(proj, 'contextkit', 'pipeline', '987');
  mkdirSync(legacyDir, { recursive: true });
  writeFileSync(join(legacyDir, 'state.json'), JSON.stringify({ kind: 'task', id: '987', status: 'working', startedAt: 1 }), 'utf-8');
  script('pipeline.mjs', 'sync'); // sync self-heals the layout (migrateStateLayout)
  existsSync(join(proj, 'contextkit', 'pipeline', 'state', '987', 'state.json')) && !existsSync(join(legacyDir, 'state.json'))
    ? ok('legacy flat state dir migrates into pipeline/state/ on sync (ADR-0053)') : bad('legacy state dir was not migrated under state/');

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
  // No-state refusal: run from a sibling dir that has no contextkit/pipeline/*/state.json.
  const emptyDir = join(proj, 'apps', 'web');
  mkdirSync(emptyDir, { recursive: true });
  const noStateOut = run([join(KIT, 'templates/contextkit/tools/scripts/runs.mjs')], { cwd: emptyDir });
  String(noStateOut?.stdout || '').includes('No runs yet')
    ? ok('/runs prints clean refusal when no state files exist') : bad(`/runs no-state output: ${noStateOut?.stdout || noStateOut?.stderr}`);

  const idByTitle = (title) => JSON.parse(script('pipeline.mjs', 'list', '--json').stdout || '[]').find((t) => t.title === title)?.id;

  // ─ Ticket 073: /plan-week ranks the backlog by priority × SLA × lane ─
  script('pipeline.mjs', 'add', '--type', 'chore', '--priority', 'P3', '--title', 'plan-low');
  script('pipeline.mjs', 'add', '--type', 'bug', '--priority', 'P0', '--severity', 'S1', '--title', 'plan-high');
  const plan = JSON.parse(script('plan-next.mjs', '--json').stdout || '[]');
  const hi = plan.findIndex((p) => p.title === 'plan-high');
  const lo = plan.findIndex((p) => p.title === 'plan-low');
  hi >= 0 && lo >= 0 && hi < lo ? ok('plan-next ranks P0 above P3 (ticket 073)') : bad(`plan-next ranking wrong: hi=${hi} lo=${lo}`);
  plan[0] && typeof plan[0].score === 'number' && plan[0].rationale ? ok('plan-next emits score + rationale per ticket (073)') : bad('plan-next missing score/rationale');

  // ─ Ticket 072: start refuses a task with an open dependency ─
  script('pipeline.mjs', 'add', '--type', 'chore', '--title', 'dep-blocker');
  const blockerId = idByTitle('dep-blocker');
  script('pipeline.mjs', 'add', '--type', 'chore', '--title', 'dep-blocked', '--depends-on', `[${blockerId}]`);
  const blockedId = idByTitle('dep-blocked');
  const refused = script('pipeline.mjs', 'start', blockedId);
  refused.status !== 0 && /blocked by/i.test(refused.stdout + refused.stderr)
    ? ok('pipeline start refuses a task with an open dependency (ticket 072)') : bad(`start did not refuse blocked task: status=${refused.status}`);
  script('pipeline.mjs', 'move', blockerId, 'conclusion');
  const allowed = script('pipeline.mjs', 'start', blockedId);
  allowed.status === 0 ? ok('pipeline start succeeds once the dependency is concluded (ticket 072)') : bad(`start failed after dep concluded: ${allowed.stdout}${allowed.stderr}`);

  // ─ Ticket 074: /ship resume — begin → step → current → end ─
  script('ship-state.mjs', 'begin', 'ship a thing');
  const ship1 = JSON.parse(script('ship-state.mjs', 'current', '--json').stdout || '[]');
  ship1.length === 1 && ship1[0].step?.current === 'scope' ? ok('ship-state begin opens a run at scope (ticket 074)') : bad(`ship begin wrong: ${JSON.stringify(ship1)}`);
  script('ship-state.mjs', 'step', 'implement');
  const ship2 = JSON.parse(script('ship-state.mjs', 'current', '--json').stdout || '[]');
  ship2[0]?.step?.current === 'implement' ? ok('ship-state step advances the live stage (ticket 074)') : bad(`ship step wrong: ${JSON.stringify(ship2)}`);
  script('ship-state.mjs', 'end', 'done');
  JSON.parse(script('ship-state.mjs', 'current', '--json').stdout || '[]').length === 0
    ? ok('ship-state end closes the run — nothing to resume (ticket 074)') : bad('ship end did not close the run');

  // ─ Ticket 075: gh-triage incremental watermark + dedupe ─
  writeFileSync(join(proj, 'issues.json'), JSON.stringify([
    { number: 201, title: 'old issue', createdAt: '2026-01-01T00:00:00Z' },
    { number: 202, title: 'new issue', createdAt: '2026-12-01T00:00:00Z' },
  ]));
  const sel = JSON.parse(script('gh-triage.mjs', 'select', 'issues.json', '--since', '2026-06-01T00:00:00Z').stdout || '{}');
  sel.new?.length === 1 && sel.new[0].number === 202 && sel.skipped?.old === 1
    ? ok('gh-triage select drops issues before the watermark (ticket 075)') : bad(`gh-triage filter wrong: ${JSON.stringify(sel)}`);
  script('pipeline.mjs', 'add', '--type', 'bug', '--source', 'gh#202', '--title', 'already-tracked-issue');
  const sel2 = JSON.parse(script('gh-triage.mjs', 'select', 'issues.json', '--since', '2026-06-01T00:00:00Z').stdout || '{}');
  sel2.new?.length === 0 && sel2.skipped?.duplicate === 1
    ? ok('gh-triage select dedupes against tracked gh# tasks (ticket 075)') : bad(`gh-triage dedupe wrong: ${JSON.stringify(sel2)}`);
  script('gh-triage.mjs', 'commit', '2026-12-01T00:00:00Z');
  (script('gh-triage.mjs', 'watermark').stdout || '').trim() === '2026-12-01T00:00:00Z'
    ? ok('gh-triage commit persists the watermark (ticket 075)') : bad('gh-triage watermark did not persist');

  // ─ Task 110 (ADR-0043 legality): qa-reject — the ONLY testing→working path ─
  script('pipeline.mjs', 'add', '--type', 'bug', '--title', 'qa-bounce-target');
  const bounceId = idByTitle('qa-bounce-target');
  const early = script('pipeline.mjs', 'qa-reject', bounceId, 'not even in testing');
  early.status !== 0 && /not 'testing'/.test(early.stdout + early.stderr)
    ? ok('qa-reject refuses a card outside testing (legality, ADR-0043)') : bad(`qa-reject accepted an illegal stage: ${early.stdout}${early.stderr}`);
  script('pipeline.mjs', 'move', bounceId, 'testing');
  script('pipeline.mjs', 'qa-reject', bounceId, 'stack trace: expected X got Y');
  const bounced = JSON.parse(script('pipeline.mjs', 'list', '--json').stdout || '[]').find((t) => t.id === bounceId);
  const bouncedBody = readFileSync(join(proj, 'contextkit', 'pipeline', 'working', bounced?.file ?? ''), 'utf-8');
  bounced?.stage === 'working' && bouncedBody.includes('## QA Feedback') && bouncedBody.includes('expected X got Y')
    ? ok('qa-reject bounces testing→working with the feedback block on the card (task 110)') : bad('qa-reject bounce missing stage move or feedback');
  // ─ Task 111 (ADR-0043): auto-transition — consent-gated, conclusion-fenced, evented ─
  script('pipeline.mjs', 'add', '--type', 'chore', '--title', 'auto-move-target');
  const autoId = idByTitle('auto-move-target');
  const cfgPath = join(proj, 'contextkit', 'config.json');
  // Below grade 3 the consent gate refuses an auto-transition. Pin grade 2
  // explicitly now that grade 3 is the default (ADR-0058).
  const cfgG2 = JSON.parse(readFileSync(cfgPath, 'utf-8'));
  cfgG2.autonomy = { grade: 2 };
  writeFileSync(cfgPath, JSON.stringify(cfgG2, null, 2));
  const atGrade2 = script('pipeline.mjs', 'auto-transition', autoId, 'working');
  atGrade2.status !== 0 && /grade 2/.test(atGrade2.stdout + atGrade2.stderr)
    ? ok('auto-transition refuses at grade 2 (consent gate, ADR-0042)') : bad(`auto-transition ran without consent: ${atGrade2.stdout}${atGrade2.stderr}`);
  const cfgRaw = JSON.parse(readFileSync(cfgPath, 'utf-8'));
  cfgRaw.autonomy = { grade: 3 };
  writeFileSync(cfgPath, JSON.stringify(cfgRaw, null, 2));
  script('pipeline.mjs', 'auto-transition', autoId, 'working');
  const autoState = JSON.parse(readFileSync(join(proj, 'contextkit', 'pipeline', 'state', autoId, 'state.json'), 'utf-8'));
  const autoEvent = (autoState.events || []).at(-1);
  autoEvent?.actor === 'auto' && autoEvent?.inverse === 'backlog' && autoEvent?.to === 'working'
    ? ok('auto-transition at grade 3 appends an actor=auto event with its inverse (ADR-0043)') : bad(`auto event wrong: ${JSON.stringify(autoState.events)}`);
  const toConclusion = script('pipeline.mjs', 'auto-transition', autoId, 'conclusion');
  toConclusion.status !== 0
    ? ok('auto-transition never enters conclusion (legality fence, ADR-0043)') : bad('auto-transition crossed into conclusion');
  script('pipeline.mjs', 'move', autoId, 'testing');
  const movedState = JSON.parse(readFileSync(join(proj, 'contextkit', 'pipeline', 'state', autoId, 'state.json'), 'utf-8'));
  movedState.events?.at(-1)?.actor === 'human' && movedState.events.length === 2
    ? ok('human move appends its event — log is append-only across actors') : bad(`event log broken: ${JSON.stringify(movedState.events)}`);
  // ADR-0043 §3: auto may NOT do the testing→working bounce (that is qa-reject's
  // monopoly and must carry feedback). autoId is in `testing` now, grade still 3.
  const illegalBounce = script('pipeline.mjs', 'auto-transition', autoId, 'working');
  illegalBounce.status !== 0 && /qa-reject/.test(illegalBounce.stdout + illegalBounce.stderr)
    ? ok('auto-transition refuses testing→working — that bounce is qa-reject only (ADR-0043 §3)') : bad(`auto-transition performed the qa-reject bounce: ${illegalBounce.stdout}${illegalBounce.stderr}`);
  delete cfgRaw.autonomy;
  writeFileSync(cfgPath, JSON.stringify(cfgRaw, null, 2));

  // ─ ADR-0055: qa-approve — deterministic testing→conclusion sign-off ─
  // autoId sits in `testing` with the add-template's empty "- [ ]" checkbox.
  const noEvidence = script('pipeline.mjs', 'qa-approve', autoId);
  noEvidence.status !== 0 && /--evidence/.test(noEvidence.stdout + noEvidence.stderr)
    ? ok('qa-approve refuses without evidence (ADR-0055)') : bad(`qa-approve ran without evidence: ${noEvidence.stdout}${noEvidence.stderr}`);
  const unchecked = script('pipeline.mjs', 'qa-approve', autoId, '--evidence', 'suite exit 0');
  unchecked.status !== 0 && /unchecked/.test(unchecked.stdout + unchecked.stderr)
    ? ok('qa-approve refuses a card with unchecked acceptance boxes (ADR-0055)') : bad(`qa-approve waved through an incomplete card: ${unchecked.stdout}${unchecked.stderr}`);
  const wrongStage = script('pipeline.mjs', 'qa-approve', bounceId, '--evidence', 'suite exit 0');
  wrongStage.status !== 0 && /not 'testing'/.test(wrongStage.stdout + wrongStage.stderr)
    ? ok('qa-approve refuses a card outside testing (legality)') : bad(`qa-approve accepted a non-testing card: ${wrongStage.stdout}${wrongStage.stderr}`);
  const autoCard = JSON.parse(script('pipeline.mjs', 'list', '--json').stdout || '[]').find((t) => t.id === autoId);
  const autoCardPath = join(proj, 'contextkit', 'pipeline', 'testing', autoCard.file);
  writeFileSync(autoCardPath, readFileSync(autoCardPath, 'utf-8').replace('- [ ]', '- [x] verified by suite'));
  script('pipeline.mjs', 'qa-approve', autoId, '--evidence', 'npm test exit 0 @fixture');
  const approved = JSON.parse(script('pipeline.mjs', 'list', '--json').stdout || '[]').find((t) => t.id === autoId);
  const approvedBody = readFileSync(join(proj, 'contextkit', 'pipeline', 'conclusion', approved?.file ?? ''), 'utf-8');
  const approvedState = JSON.parse(readFileSync(join(proj, 'contextkit', 'pipeline', 'state', autoId, 'state.json'), 'utf-8'));
  approved?.stage === 'conclusion' && approvedBody.includes('## QA Sign-off') && approvedBody.includes('npm test exit 0')
    ? ok('qa-approve closes testing→conclusion with the evidence block on the card (ADR-0055)') : bad('qa-approve sign-off missing move or evidence');
  approvedState.events?.at(-1)?.actor === 'qa' && approvedState.status === 'done' && typeof approvedState.endedAt === 'number'
    ? ok('qa-approve event carries actor=qa; state closed with endedAt') : bad(`qa-approve state wrong: ${JSON.stringify(approvedState)}`);

  // ADR-0047 A3 — board --digest: compact lane summary instead of N task files.
  const digest = script('pipeline.mjs', 'board', '--digest').stdout || '';
  // (auto-move-target was qa-approved into conclusion above — assert on the in-flight bounce card instead)
  /DevPipeline digest — Backlog \*\*\d+\*\*/.test(digest) && digest.includes('qa-bounce-target') && !digest.includes('| ID |')
    ? ok('pipeline board --digest emits the bounded lane summary, not the full table (ADR-0047 A3)')
    : bad(`board --digest wrong: ${digest.slice(0, 200)}`);
} catch (err) {
  bad(`crashed: ${err?.stack || err}`);
} finally {
  fx.cleanup();
}

rep.finish('Integration (tooling — DevPipeline substrate)');
