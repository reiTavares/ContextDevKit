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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { reporter, installFixture } from './it-helpers.mjs';

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
} catch (err) {
  bad(`crashed: ${err?.stack || err}`);
} finally {
  fx.cleanup();
}

rep.finish('Integration (tooling — DevPipeline)');
