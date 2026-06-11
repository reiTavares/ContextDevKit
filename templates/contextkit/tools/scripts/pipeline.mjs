#!/usr/bin/env node
/**
 * DevPipeline engine — execution board (≠ roadmap). Stages: backlog → working
 * (ADR-0015 §B) → testing → conclusion. Renderer in pipeline-board.mjs,
 * scoring in pipeline-prioritize.mjs, session-coupled start/stop in
 * pipeline-session.mjs, schema-v2 validators in pipeline-validate.mjs.
 */
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { loadConfigSync } from '../../runtime/config/load.mjs';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { writeFileAtomicSync } from '../../runtime/hooks/safe-io.mjs';
import { wsjfScore, wsjfToPriority, slaDue, DEFAULTS } from './pipeline-prioritize.mjs';
import { renderBoard, renderDigest, renderKnownBugs } from './pipeline-board.mjs';
import { runValidate } from './pipeline-validate.mjs';
import { listTasks } from './pipeline-tasks.mjs';
import { add, ingest, ensureDirs } from './pipeline-add.mjs';
import { autoTransition, move, qaReject } from './pipeline-transitions.mjs';

const ROOT = process.cwd();
const PIPE = pathsFor(ROOT).pipeline;
const CFG = loadConfigSync(ROOT).pipeline || {};
const BANDS = CFG.wsjfBands || DEFAULTS.wsjfBands;
const SEVMAP = CFG.severityPriority || DEFAULTS.severityPriority;
const SLADAYS = CFG.slaDays || DEFAULTS.slaDays;

const tasks = () => listTasks(PIPE);

function prioritize() {
  const id = process.argv[3];
  const priority = process.argv[4];
  if (!id || !/^P[0-3]$/.test(priority || '')) {
    console.error('Usage: pipeline.mjs prioritize <id> <P0|P1|P2|P3>');
    process.exit(1);
  }
  const task = tasks().find((t) => t.id === id.padStart(3, '0') || t.id === id);
  if (!task) { console.error(`No task with id ${id}.`); process.exit(1); }
  const p = resolve(PIPE, task.stage, task.file);
  writeFileAtomicSync(p, readFileSync(p, 'utf-8').replace(/^priority:.*$/m, `priority: ${priority}`));
  sync();
  console.log(`✅ ${task.id} priority → ${priority}`);
}

function setWsjf() {
  const id = process.argv[3];
  const [uv, tc, rr, js] = process.argv.slice(4).map(Number);
  if (!id || [uv, tc, rr, js].some((n) => Number.isNaN(n))) {
    console.error('Usage: pipeline.mjs wsjf <id> <userValue> <timeCriticality> <riskReduction> <jobSize>  (each 1-10)');
    process.exit(1);
  }
  const task = tasks().find((t) => t.id === id.padStart(3, '0') || t.id === id);
  if (!task) { console.error(`No task with id ${id}.`); process.exit(1); }
  const score = wsjfScore({ userValue: uv, timeCriticality: tc, riskReduction: rr, jobSize: js });
  const pr = wsjfToPriority(score, BANDS);
  const due = slaDue(pr, task.created, SLADAYS);
  const p = resolve(PIPE, task.stage, task.file);
  writeFileAtomicSync(p, readFileSync(p, 'utf-8')
    .replace(/^priority:.*$/m, `priority: ${pr}`)
    .replace(/^wsjf:.*$/m, `wsjf: ${score}`)
    .replace(/^sla:.*$/m, `sla: ${due}`));
  sync();
  console.log(`✅ ${task.id} WSJF ${score} → ${pr} (SLA ${due})`);
}

async function sessionCli(verb, marker, dest) {
  const id = process.argv[3];
  if (!id) { console.error(`Usage: pipeline.mjs ${verb} <id>`); process.exit(1); }
  const sess = await import('./pipeline-session.mjs');
  try {
    const result = await (verb === 'start' ? sess.startTask : sess.stopTask)(PIPE, id, sync);
    console.log(`${marker}  ${result.id} → ${dest}`);
  } catch (err) { console.error(err.message); process.exit(1); }
}

function sync() {
  ensureDirs(PIPE);
  const all = tasks();
  writeFileAtomicSync(resolve(PIPE, 'devpipeline.md'), renderBoard(all));
  writeFileAtomicSync(resolve(PIPE, 'known-bugs.md'), renderKnownBugs(all));
}

function bugs() {
  sync();
  const open = tasks().filter((t) => t.type === 'bug' && t.stage !== 'conclusion');
  console.log(`🐞 Known bugs: ${open.length} open. Map → contextkit/pipeline/known-bugs.md`);
  for (const b of open) console.log(`   ${b.severity || '—'} ${b.priority} ${b.id} ${b.bugType || ''} — ${b.title}`);
}

const cmd = process.argv[2];
if (cmd === 'add') add({ ROOT, PIPE, sync, BANDS, SEVMAP, SLADAYS });
else if (cmd === 'ingest') ingest({ ROOT, PIPE, sync });
else if (cmd === 'prioritize') prioritize();
else if (cmd === 'wsjf') setWsjf();
else if (cmd === 'bugs') bugs();
else if (cmd === 'move') move({ PIPE, sync });
else if (cmd === 'start') await sessionCli('start', '▶', 'working/ (owner: this session)');
else if (cmd === 'stop') await sessionCli('stop', '⏸', 'backlog/ (released)');
else if (cmd === 'validate') { const t = tasks(); const e = runValidate(t); e.length ? (e.forEach((m) => console.error(`✗ ${m}`)), process.exit(1)) : console.log(`✅ ${t.length} tickets validated.`); }
else if (cmd === 'sync') { sync(); console.log('✅ devpipeline.md regenerated.'); }
else if (cmd === 'board') {
  // --digest: token-light lane summary (ADR-0047 A3); default: the full board.
  if (process.argv.includes('--digest')) console.log(renderDigest(tasks()));
  else { sync(); console.log(readFileSync(resolve(PIPE, 'devpipeline.md'), 'utf-8')); }
}
else if (cmd === 'list') {
  const all = tasks();
  if (process.argv.includes('--json')) console.log(JSON.stringify(all, null, 2));
  else for (const t of all) console.log(`[${t.stage}] ${t.id} ${t.priority} ${t.type} — ${t.title}`);
} else if (cmd === 'qa-reject') qaReject({ PIPE, sync });
else if (cmd === 'auto-transition') autoTransition({ ROOT, PIPE, sync });
else {
  console.error('Usage: pipeline.mjs <add|ingest|prioritize|wsjf|bugs|move|start|stop|validate|sync|list|board|qa-reject|auto-transition>');
  process.exit(1);
}
