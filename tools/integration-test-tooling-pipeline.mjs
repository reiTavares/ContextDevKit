#!/usr/bin/env node
/**
 * ContextDevKit integration test — TOOLING / DevPipeline.
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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { reporter, installFixture } from './it-helpers.mjs';
import { renderDigest } from '../templates/contextkit/tools/scripts/pipeline-board.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\n🌀 ContextDevKit integration test — tooling / DevPipeline\n');
const fx = installFixture(rep);
const { proj, script } = fx;

try {
  // Audit 136: the token-light digest is a never-crash summary (ADR-0027) — a
  // malformed card with no title must coerce, not throw.
  (() => { try { return typeof renderDigest([{ id: '900', priority: 'P1', type: 'bug', stage: 'backlog' }]) === 'string'; } catch { return false; } })()
    ? ok('pipeline-board digest survives a titleless task (defensive, audit 136)') : bad('renderDigest threw on a task with no title');
  // DevPipeline: add → move → sync reflects in devpipeline.md.
  script('pipeline.mjs', 'add', '--type', 'bug', '--priority', 'P1', '--title', 'login crash');
  const board1 = readFileSync(join(proj, 'contextkit', 'pipeline', 'devpipeline.md'), 'utf-8');
  board1.includes('login crash') && /Backlog \*\*1\*\*/.test(board1) ? ok('pipeline add → backlog on board') : bad('pipeline add not reflected');
  script('pipeline.mjs', 'move', '001', 'testing');
  const board2 = readFileSync(join(proj, 'contextkit', 'pipeline', 'devpipeline.md'), 'utf-8');
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
  existsSync(join(proj, 'contextkit', 'pipeline', 'known-bugs.md')) &&
    readFileSync(join(proj, 'contextkit', 'pipeline', 'known-bugs.md'), 'utf-8').includes('sev bug')
    ? ok('known-bugs map generated + groups bug tasks') : bad('known-bugs map missing/empty');

  // ─ Ticket 040: task metadata v2 (DAG dependencies + complexity + spike/docs) ─
  script('pipeline.mjs', 'add', '--type', 'spike', '--title', 'spike-test', '--complexity', 'L', '--depends-on', '[001, 002]');
  const meta = JSON.parse(script('pipeline.mjs', 'list', '--json').stdout || '[]').find((t) => t.title === 'spike-test');
  meta?.type === 'spike' && meta?.complexity === 'L' && Array.isArray(meta?.dependencies) && meta.dependencies.length === 2
    ? ok('pipeline add accepts --type spike + --complexity + --depends-on (ticket 040)') : bad(`metadata v2 wrong: ${JSON.stringify(meta)}`);
  const boardV2 = readFileSync(join(proj, 'contextkit', 'pipeline', 'devpipeline.md'), 'utf-8');
  boardV2.includes('blocked by') ? ok('board renders "blocked by N" hint when dependencies are open (ticket 040)') : bad('blocked-by hint missing from board');
  // ADR-0057: workflow spec-pack metadata stays optional and does not break old cards.
  script('pipeline.mjs', 'add', '--type', 'feature', '--title', 'workflow-linked', '--workflow', 'demo', '--spec', 'contextkit/memory/workflows/demo/spec.md');
  const workflowLinked = JSON.parse(script('pipeline.mjs', 'list', '--json').stdout || '[]').find((t) => t.title === 'workflow-linked');
  const workflowLinkedBody = readFileSync(join(proj, 'contextkit', 'pipeline', 'backlog', workflowLinked.file), 'utf-8');
  workflowLinked?.workflow === 'demo' && workflowLinked?.spec === 'contextkit/memory/workflows/demo/spec.md' &&
    workflowLinkedBody.includes('**Spec references:**') && workflowLinkedBody.includes('**Diff summary:**')
    ? ok('pipeline add records workflow/spec metadata and spec-report sections (ADR-0057)') : bad(`workflow metadata wrong: ${JSON.stringify(workflowLinked)}`);
  const workflowBoard = readFileSync(join(proj, 'contextkit', 'pipeline', 'devpipeline.md'), 'utf-8');
  workflowBoard.includes('| Workflow |') && workflowBoard.includes('| demo |')
    ? ok('pipeline board renders workflow links (ADR-0057)') : bad('workflow column missing from board');
  // ADR-0051: listTasks must surface `paths:` so the swarm planner can read an
  // explicit touch-set. Regression guard — swarm-plan.mjs reads task.paths, but
  // listTasks previously dropped the field, leaving deriveTouchSet's explicit
  // branch dead via the CLI (the unit test fed paths in by hand and masked it).
  const pathsCardFile = join(proj, 'contextkit', 'pipeline', 'backlog', workflowLinked.file);
  writeFileSync(pathsCardFile, readFileSync(pathsCardFile, 'utf-8').replace(/^source:.*$/m, '$&\npaths: [templates/ctx.mjs, tools/foo.mjs]'));
  const pathsTask = JSON.parse(script('pipeline.mjs', 'list', '--json').stdout || '[]').find((t) => t.id === workflowLinked.id);
  pathsTask?.paths === '[templates/ctx.mjs, tools/foo.mjs]'
    ? ok('listTasks surfaces paths: for the swarm planner (ADR-0051 regression)') : bad(`paths not surfaced by listTasks: ${JSON.stringify(pathsTask?.paths)}`);
  script('pipeline.mjs', 'move', workflowLinked.id, 'testing');
  const implementedTask = JSON.parse(script('pipeline.mjs', 'list', '--json').stdout || '[]').find((t) => t.id === workflowLinked.id);
  implementedTask?.stage === 'testing' && implementedTask?.implemented === new Date().toISOString().slice(0, 10)
    ? ok('pipeline move to testing stamps implemented date (ADR-0057)') : bad(`implemented date missing: ${JSON.stringify(implementedTask)}`);
  // validate command: clean graph passes.
  const validClean = script('pipeline.mjs', 'validate');
  validClean.status === 0 ? ok('pipeline validate exits 0 on acyclic graph') : bad(`validate failed clean: ${validClean.stdout}${validClean.stderr}`);
  // Manually inject a cycle and prove validate refuses.
  const spikeFile = join(proj, 'contextkit', 'pipeline', 'backlog', `${meta.id}-spike-test.md`);
  writeFileSync(spikeFile, readFileSync(spikeFile, 'utf-8').replace(/^dependencies:.*$/m, `dependencies: [${meta.id}]`));
  const validCycle = script('pipeline.mjs', 'validate');
  validCycle.status !== 0 && /cycle/i.test(validCycle.stdout + validCycle.stderr)
    ? ok('pipeline validate refuses on dependency cycle (ticket 040)') : bad(`validate did not refuse cycle: status=${validCycle.status}`);
} catch (err) {
  bad(`crashed: ${err?.stack || err}`);
} finally {
  fx.cleanup();
}

rep.finish('Integration (tooling — DevPipeline)');
