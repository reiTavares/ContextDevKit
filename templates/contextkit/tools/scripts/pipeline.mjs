#!/usr/bin/env node
/**
 * DevPipeline engine — execution board (≠ roadmap). Stages: backlog → working
 * (ADR-0015 §B) → testing → conclusion. Renderer in pipeline-board.mjs,
 * scoring in pipeline-prioritize.mjs, session-coupled start/stop in
 * pipeline-session.mjs, schema-v2 validators in pipeline-validate.mjs.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfigSync } from '../../runtime/config/load.mjs';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { writeFileAtomicSync } from '../../runtime/hooks/safe-io.mjs';
import { wsjfScore, wsjfToPriority, severityToPriority, bugSeverityToPriority, slaDue, DEFAULTS } from './pipeline-prioritize.mjs';
import { renderBoard, renderKnownBugs } from './pipeline-board.mjs';
import { parseInlineArray, runValidate } from './pipeline-validate.mjs';
import { listTasks } from './pipeline-tasks.mjs';
import { classifyTask } from './complexity-rubric.mjs';

const ROOT = process.cwd();
const PIPE = pathsFor(ROOT).pipeline;
const STAGES = { backlog: 'backlog', working: 'working', testing: 'testing', conclusion: 'conclusion' };
const STATUS = { backlog: 'backlog', working: 'working', testing: 'testing', conclusion: 'done' };
const CFG = loadConfigSync(ROOT).pipeline || {};
const BANDS = CFG.wsjfBands || DEFAULTS.wsjfBands;
const SEVMAP = CFG.severityPriority || DEFAULTS.severityPriority;
const SLADAYS = CFG.slaDays || DEFAULTS.slaDays;

function ensureDirs() {
  for (const s of Object.keys(STAGES)) mkdirSync(resolve(PIPE, s), { recursive: true });
}

/** Read-only task listing — delegated to the shared task-I/O module. */
const tasks = () => listTasks(PIPE);

function nextId() {
  const ids = tasks().map((t) => parseInt(t.id, 10)).filter((n) => !Number.isNaN(n));
  return String((ids.length ? Math.max(...ids) : 0) + 1).padStart(3, '0');
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'task';
}

function getArg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

/** Writes one backlog task file and returns its id. Shared by add + ingest. */
function writeTask({ type = 'task', priority = 'P2', title, sla = '', roadmap = '', source = '', context = '', severity = '', wsjf = '', bugType = '', complexity = '', dependencies = [] }) {
  ensureDirs();
  const created = new Date().toISOString().slice(0, 10);
  const deps = Array.isArray(dependencies) ? `[${dependencies.join(', ')}]` : '[]';
  const buildBody = (id) => [
    '---',
    `id: ${id}`,
    `title: ${title}`,
    `type: ${type}`,
    `priority: ${priority}`,
    `severity: ${severity}`,
    `wsjf: ${wsjf}`,
    `bugType: ${bugType}`,
    `complexity: ${complexity}`,
    `dependencies: ${deps}`,
    `status: backlog`,
    `created: ${created}`,
    `sla: ${sla || slaDue(priority, created, SLADAYS)}`,
    `roadmap: ${roadmap}`,
    `source: ${source}`,
    '---',
    '',
    `## ${title}`,
    '',
    `**Context / why:** ${context}`,
    '',
    '**Acceptance criteria:**',
    '- [ ] ',
    '',
  ].join('\n');
  // Collision-safe id allocation: claim the file with an exclusive create (`wx`).
  // If two concurrent `add`s race for the same id, the loser sees EEXIST (or finds
  // the id already taken) and retries with the next id — two tasks never share one.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const id = nextId();
    if (tasks().some((t) => t.id === id)) continue;
    try {
      writeFileSync(resolve(PIPE, 'backlog', `${id}-${slug(title)}.md`), buildBody(id), { encoding: 'utf-8', flag: 'wx' });
      return id;
    } catch (err) {
      if (err?.code === 'EEXIST') continue;
      throw err;
    }
  }
  throw new Error('pipeline: could not allocate a unique task id (50 attempts exhausted)');
}

function add() {
  const type = getArg('type') || 'task';
  const title = getArg('title');
  if (!title) {
    console.error('Usage: pipeline.mjs add --type <bug|feature|chore> --title "..." [--priority P0-P3] [--severity S1-S4] [--wsjf uv,tc,rr,js] [--bug-type <t>]');
    process.exit(1);
  }
  const sev = getArg('severity');
  const wsjfArg = getArg('wsjf');
  let priority = getArg('priority');
  let wsjf = '';
  if (wsjfArg) {
    const [uv, tc, rr, js] = wsjfArg.split(',').map(Number);
    wsjf = wsjfScore({ userValue: uv, timeCriticality: tc, riskReduction: rr, jobSize: js });
    priority = priority || wsjfToPriority(wsjf, BANDS);
  } else if (sev) {
    priority = priority || bugSeverityToPriority(sev, SEVMAP);
  }
  priority = priority || 'P2';
  // Auto right-size (ADR-0032): when --complexity is absent, the rubric classifies
  // the title into a tier (stamped into `complexity`) and surfaces the ADR/agent route.
  const auto = getArg('complexity') ? { complexity: getArg('complexity'), route: '' } : classifyTask(title, ROOT);
  const id = writeTask({ type, priority, title, sla: getArg('sla') || '', roadmap: getArg('roadmap') || '', source: getArg('source') || '', severity: sev || '', wsjf, bugType: getArg('bug-type') || '', complexity: auto.complexity, dependencies: parseInlineArray(getArg('depends-on')) });
  sync();
  console.log(`✅ Added ${type} ${id} (${priority}${wsjf ? `, WSJF ${wsjf}` : ''}${sev ? `, ${sev}` : ''}) to backlog: ${title}${auto.route}`);
}

/**
 * Bulk-import findings from a JSON file (e.g. `tech-debt-scan --json`) into the
 * backlog — one task per finding, priority auto-mapped from `severity`. Idempotent:
 * a finding whose `source` fingerprint already has a non-concluded task is skipped,
 * so re-running an analysis never spams duplicates. The user re-prioritizes freely.
 */
function ingest() {
  const fileArg = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : getArg('file');
  if (!fileArg) {
    console.error('Usage: pipeline.mjs ingest <findings.json> [--type chore]');
    process.exit(1);
  }
  let data;
  try {
    data = JSON.parse(readFileSync(resolve(ROOT, fileArg), 'utf-8').replace(/^﻿/, ''));
  } catch (err) {
    console.error(`Could not read findings JSON: ${err?.message ?? err}`);
    process.exit(1);
  }
  const findings = Array.isArray(data) ? data : data.findings || [];
  const type = getArg('type') || 'chore';
  const taken = new Set(tasks().filter((t) => t.stage !== 'conclusion').map((t) => t.source).filter(Boolean));
  let added = 0;
  let skipped = 0;
  for (const f of findings) {
    const where = f.path ? `${f.path}${f.line ? ':' + f.line : ''}` : '';
    const source = f.source || `${f.kind || 'finding'}:${where}`;
    if (taken.has(source)) {
      skipped += 1;
      continue;
    }
    const priority = /^P[0-3]$/.test(f.priority || '') ? f.priority : severityToPriority(f.severity);
    const title = String(f.title || `${f.kind ? f.kind + ': ' : ''}${where || 'finding'}`).slice(0, 80);
    writeTask({ type, priority, title, source, context: f.message || '' });
    taken.add(source);
    added += 1;
  }
  sync();
  console.log(`✅ Ingested ${added} finding(s) into backlog (${skipped} already present). Re-prioritize any with: pipeline.mjs prioritize <id> <P0-P3>`);
}

/** User override: change a task's auto-assigned priority. */
function prioritize() {
  const id = process.argv[3];
  const priority = process.argv[4];
  if (!id || !/^P[0-3]$/.test(priority || '')) {
    console.error('Usage: pipeline.mjs prioritize <id> <P0|P1|P2|P3>');
    process.exit(1);
  }
  const task = tasks().find((t) => t.id === id.padStart(3, '0') || t.id === id);
  if (!task) {
    console.error(`No task with id ${id}.`);
    process.exit(1);
  }
  const p = resolve(PIPE, task.stage, task.file);
  writeFileAtomicSync(p, readFileSync(p, 'utf-8').replace(/^priority:.*$/m, `priority: ${priority}`));
  sync();
  console.log(`✅ ${task.id} priority → ${priority}`);
}

/** (Re)score a task with WSJF and re-derive its priority + SLA due date. */
function setWsjf() {
  const id = process.argv[3];
  const [uv, tc, rr, js] = process.argv.slice(4).map(Number);
  if (!id || [uv, tc, rr, js].some((n) => Number.isNaN(n))) {
    console.error('Usage: pipeline.mjs wsjf <id> <userValue> <timeCriticality> <riskReduction> <jobSize>  (each 1-10)');
    process.exit(1);
  }
  const task = tasks().find((t) => t.id === id.padStart(3, '0') || t.id === id);
  if (!task) {
    console.error(`No task with id ${id}.`);
    process.exit(1);
  }
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

function move() {
  const id = process.argv[3];
  const stage = process.argv[4];
  if (!id || !STAGES[stage]) {
    console.error('Usage: pipeline.mjs move <id> <backlog|working|testing|conclusion>');
    process.exit(1);
  }
  const task = tasks().find((t) => t.id === id.padStart(3, '0') || t.id === id);
  if (!task) {
    console.error(`No task with id ${id}.`);
    process.exit(1);
  }
  const from = resolve(PIPE, task.stage, task.file);
  const to = resolve(PIPE, stage, task.file);
  let text = readFileSync(from, 'utf-8').replace(/^(status:).*$/m, `status: ${STATUS[stage]}`);
  if (stage === 'conclusion' && !/^concluded:/m.test(text)) {
    text = text.replace(/^---\n([\s\S]*?)\n---/, (full, fm) => `---\n${fm}\nconcluded: ${new Date().toISOString().slice(0, 10)}\n---`);
  }
  writeFileAtomicSync(from, text);
  renameSync(from, to);
  sync();
  // ADR-0015 §C — fire-and-forget state.json mirror (observability, best-effort).
  import('../../runtime/state/state-io.mjs').then((m) => m.readState(PIPE, task.id) && m.writeState(PIPE, task.id, stage === 'conclusion' ? { status: STATUS[stage], endedAt: Date.now() } : { status: STATUS[stage] })).catch(() => {});
  console.log(`✅ Moved ${task.id} → ${stage}`);
}


/** Session-coupled transitions (start/stop) — see `pipeline-session.mjs`. */
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
  ensureDirs();
  const all = tasks();
  writeFileAtomicSync(resolve(PIPE, 'devpipeline.md'), renderBoard(all));
  writeFileAtomicSync(resolve(PIPE, 'known-bugs.md'), renderKnownBugs(all));
}

/** Print + regenerate the known-bugs map. */
function bugs() {
  sync();
  const open = tasks().filter((t) => t.type === 'bug' && t.stage !== 'conclusion');
  console.log(`🐞 Known bugs: ${open.length} open. Map → contextkit/pipeline/known-bugs.md`);
  for (const b of open) console.log(`   ${b.severity || '—'} ${b.priority} ${b.id} ${b.bugType || ''} — ${b.title}`);
}

const cmd = process.argv[2];
if (cmd === 'add') add();
else if (cmd === 'ingest') ingest();
else if (cmd === 'prioritize') prioritize();
else if (cmd === 'wsjf') setWsjf();
else if (cmd === 'bugs') bugs();
else if (cmd === 'move') move();
else if (cmd === 'start') await sessionCli('start', '▶', 'working/ (owner: this session)');
else if (cmd === 'stop') await sessionCli('stop', '⏸', 'backlog/ (released)');
else if (cmd === 'validate') { const t = tasks(); const e = runValidate(t); e.length ? (e.forEach((m) => console.error(`✗ ${m}`)), process.exit(1)) : console.log(`✅ ${t.length} tickets validated.`); }
else if (cmd === 'sync') {
  sync();
  console.log('✅ devpipeline.md regenerated.');
} else if (cmd === 'list') {
  const all = tasks();
  if (process.argv.includes('--json')) console.log(JSON.stringify(all, null, 2));
  else for (const t of all) console.log(`[${t.stage}] ${t.id} ${t.priority} ${t.type} — ${t.title}`);
} else {
  console.error('Usage: pipeline.mjs <add|ingest|prioritize|wsjf|bugs|move|start|stop|validate|sync|list>');
  process.exit(1);
}
