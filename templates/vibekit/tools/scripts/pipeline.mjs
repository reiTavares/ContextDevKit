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
 *   node .../pipeline.mjs ingest <findings.json> [--type chore]   # 1 task/finding, auto-priority, idempotent
 *   node .../pipeline.mjs prioritize <id> <P0-P3>                  # user override of the auto priority
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
      tasks.push({ stage, file: f, id: fm.id || f.split('-')[0], title: fm.title || f, type: fm.type || 'task', priority: fm.priority || 'P2', sla: fm.sla || '', roadmap: fm.roadmap || '', source: fm.source || '', created: fm.created || '' });
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

/** Severity (1–5, from the deterministic scanners) → board priority (P0–P3). */
function severityToPriority(sev) {
  const n = Number(sev);
  if (n >= 4) return 'P1';
  if (n >= 3) return 'P2';
  return 'P3';
}

/** Writes one backlog task file and returns its id. Shared by add + ingest. */
function writeTask({ type = 'task', priority = 'P2', title, sla = '', roadmap = '', source = '', context = '' }) {
  ensureDirs();
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
    `sla: ${sla}`,
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
  writeFileSync(resolve(PIPE, 'backlog', file), body, 'utf-8');
  return id;
}

function add() {
  const type = getArg('type') || 'task';
  const priority = getArg('priority') || 'P2';
  const title = getArg('title');
  if (!title) {
    console.error('Usage: pipeline.mjs add --type <bug|feature|increment|chore> --priority <P0-P3> --title "..."');
    process.exit(1);
  }
  const id = writeTask({ type, priority, title, sla: getArg('sla') || '', roadmap: getArg('roadmap') || '', source: getArg('source') || '' });
  sync();
  console.log(`✅ Added ${type} ${id} (${priority}) to backlog: ${title}`);
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
  const taken = new Set(listTasks().filter((t) => t.stage !== 'conclusion').map((t) => t.source).filter(Boolean));
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
  const task = listTasks().find((t) => t.id === id.padStart(3, '0') || t.id === id);
  if (!task) {
    console.error(`No task with id ${id}.`);
    process.exit(1);
  }
  const p = resolve(PIPE, task.stage, task.file);
  writeFileSync(p, readFileSync(p, 'utf-8').replace(/^priority:.*$/m, `priority: ${priority}`), 'utf-8');
  sync();
  console.log(`✅ ${task.id} priority → ${priority}`);
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
else if (cmd === 'ingest') ingest();
else if (cmd === 'prioritize') prioritize();
else if (cmd === 'move') move();
else if (cmd === 'sync') {
  sync();
  console.log('✅ devpipeline.md regenerated.');
} else if (cmd === 'list') {
  const all = listTasks();
  if (process.argv.includes('--json')) console.log(JSON.stringify(all, null, 2));
  else for (const t of all) console.log(`[${t.stage}] ${t.id} ${t.priority} ${t.type} — ${t.title}`);
} else {
  console.error('Usage: pipeline.mjs <add|ingest|prioritize|move|sync|list>');
  process.exit(1);
}
