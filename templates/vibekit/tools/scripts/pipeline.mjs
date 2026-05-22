#!/usr/bin/env node
/**
 * DevPipeline engine — the production board (distinct from the product roadmap).
 *
 * The roadmap (`vibekit/memory/roadmap.md`) is the product/business plan. The
 * DevPipeline is **execution control**: bugs, increments, chores and roadmap
 * items broken into tasks, each with priority + SLA, flowing through three
 * stages. One markdown file per task; `devpipeline.md` is the generated panel.
 *
 *   vibekit/pipeline/backlog/      to do
 *   vibekit/pipeline/testing/      in progress / under test
 *   vibekit/pipeline/conclusion/   done (report)
 *   vibekit/pipeline/devpipeline.md  ← generated dashboard (do not hand-edit)
 *
 * Usage:
 *   node .../pipeline.mjs add --type bug --priority P1 --title "..." [--sla 2026-06-01] [--roadmap P2.3]
 *   node .../pipeline.mjs move <id> testing|conclusion|backlog
 *   node .../pipeline.mjs sync          # regenerate devpipeline.md
 *   node .../pipeline.mjs list [--json]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const PIPE = resolve(ROOT, 'vibekit/pipeline');
const STAGES = { backlog: 'backlog', testing: 'testing', conclusion: 'conclusion' };
const STATUS = { backlog: 'backlog', testing: 'testing', conclusion: 'done' };

function ensureDirs() {
  for (const s of Object.keys(STAGES)) mkdirSync(resolve(PIPE, s), { recursive: true });
}

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  const fm = {};
  if (m) for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return fm;
}

function listTasks() {
  ensureDirs();
  const tasks = [];
  for (const stage of Object.keys(STAGES)) {
    let files = [];
    try {
      files = readdirSync(resolve(PIPE, stage)).filter((f) => f.endsWith('.md'));
    } catch {
      /* none */
    }
    for (const f of files) {
      const fm = parseFrontmatter(readFileSync(resolve(PIPE, stage, f), 'utf-8'));
      tasks.push({ stage, file: f, id: fm.id || f.split('-')[0], title: fm.title || f, type: fm.type || 'task', priority: fm.priority || 'P2', sla: fm.sla || '', roadmap: fm.roadmap || '', created: fm.created || '' });
    }
  }
  return tasks.sort((a, b) => (a.priority + a.id).localeCompare(b.priority + b.id));
}

function nextId() {
  const ids = listTasks().map((t) => parseInt(t.id, 10)).filter((n) => !Number.isNaN(n));
  return String((ids.length ? Math.max(...ids) : 0) + 1).padStart(3, '0');
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'task';
}

function getArg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function add() {
  ensureDirs();
  const type = getArg('type') || 'task';
  const priority = getArg('priority') || 'P2';
  const title = getArg('title');
  if (!title) {
    console.error('Usage: pipeline.mjs add --type <bug|feature|increment|chore> --priority <P0-P3> --title "..."');
    process.exit(1);
  }
  const id = nextId();
  const file = `${id}-${slug(title)}.md`;
  const body = [
    '---',
    `id: ${id}`,
    `title: ${title}`,
    `type: ${type}`,
    `priority: ${priority}`,
    `status: backlog`,
    `created: ${new Date().toISOString().slice(0, 10)}`,
    `sla: ${getArg('sla') || ''}`,
    `roadmap: ${getArg('roadmap') || ''}`,
    '---',
    '',
    `## ${title}`,
    '',
    '**Context / why:**',
    '',
    '**Acceptance criteria:**',
    '- [ ] ',
    '',
  ].join('\n');
  writeFileSync(resolve(PIPE, 'backlog', file), body, 'utf-8');
  sync();
  console.log(`✅ Added ${type} ${id} (${priority}) to backlog: ${title}`);
}

function move() {
  const id = process.argv[3];
  const stage = process.argv[4];
  if (!id || !STAGES[stage]) {
    console.error('Usage: pipeline.mjs move <id> <backlog|testing|conclusion>');
    process.exit(1);
  }
  const task = listTasks().find((t) => t.id === id.padStart(3, '0') || t.id === id);
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
  writeFileSync(from, text, 'utf-8');
  renameSync(from, to);
  sync();
  console.log(`✅ Moved ${task.id} → ${stage}`);
}

function table(tasks) {
  if (tasks.length === 0) return '_(empty)_\n';
  const rows = ['| ID | Pri | Type | Title | SLA | Roadmap |', '| --- | --- | --- | --- | --- | --- |'];
  for (const t of tasks) rows.push(`| ${t.id} | ${t.priority} | ${t.type} | ${t.title} | ${t.sla || '—'} | ${t.roadmap || '—'} |`);
  return rows.join('\n') + '\n';
}

function sync() {
  ensureDirs();
  const all = listTasks();
  const by = (s) => all.filter((t) => t.stage === s);
  const out = [];
  out.push('# DevPipeline — execution board');
  out.push('');
  out.push('> ⚠️  **AUTO-GENERATED** by `pipeline.mjs sync` (also on pre-commit). Do not hand-edit.');
  out.push('> The product/business plan is `vibekit/memory/roadmap.md`. THIS is execution control:');
  out.push('> bugs, increments, chores and roadmap items broken into tasks with priority + SLA.');
  out.push('');
  out.push(`Backlog **${by('backlog').length}** · Testing **${by('testing').length}** · Concluded **${by('conclusion').length}**`);
  out.push('');
  out.push('## 🟡 In testing / in progress');
  out.push('');
  out.push(table(by('testing')));
  out.push('## 📋 Backlog (by priority)');
  out.push('');
  out.push(table(by('backlog')));
  out.push('## ✅ Concluded (recent)');
  out.push('');
  out.push(table(by('conclusion').slice(-15)));
  writeFileSync(resolve(PIPE, 'devpipeline.md'), out.join('\n'), 'utf-8');
}

const cmd = process.argv[2];
if (cmd === 'add') add();
else if (cmd === 'move') move();
else if (cmd === 'sync') {
  sync();
  console.log('✅ devpipeline.md regenerated.');
} else if (cmd === 'list') {
  const all = listTasks();
  if (process.argv.includes('--json')) console.log(JSON.stringify(all, null, 2));
  else for (const t of all) console.log(`[${t.stage}] ${t.id} ${t.priority} ${t.type} — ${t.title}`);
} else {
  console.error('Usage: pipeline.mjs <add|move|sync|list>');
  process.exit(1);
}
