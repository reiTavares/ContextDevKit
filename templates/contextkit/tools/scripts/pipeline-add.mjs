/**
 * DevPipeline task creation — `add` (single task, WSJF/severity-priced,
 * ADR-0032 auto-classified) and `ingest` (bulk findings JSON → backlog,
 * idempotent by `source` fingerprint). Extracted from pipeline.mjs
 * (280-budget split, ADR-0041 F1 / task 110). `writeTask` keeps the
 * collision-safe exclusive-create (`wx`) id allocation.
 */
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { wsjfScore, wsjfToPriority, severityToPriority, bugSeverityToPriority, slaDue, DEFAULTS } from './pipeline-prioritize.mjs';
import { parseInlineArray } from './pipeline-validate.mjs';
import { classifyTask } from './complexity-rubric.mjs';
import { listTasks } from './pipeline-tasks.mjs';

const STAGES = { backlog: 'backlog', working: 'working', testing: 'testing', conclusion: 'conclusion' };

export function ensureDirs(PIPE) {
  for (const s of Object.keys(STAGES)) mkdirSync(resolve(PIPE, s), { recursive: true });
}

function nextId(PIPE) {
  const ids = listTasks(PIPE).map((t) => parseInt(t.id, 10)).filter((n) => !Number.isNaN(n));
  return String((ids.length ? Math.max(...ids) : 0) + 1).padStart(3, '0');
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'task';
}

function getArg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

export function writeTask(PIPE, { type = 'task', priority = 'P2', title, sla = '', roadmap = '', workflow = '', spec = '', source = '', context = '', severity = '', wsjf = '', bugType = '', complexity = '', dependencies = [] }, SLADAYS) {
  ensureDirs(PIPE);
  const created = new Date().toISOString().slice(0, 10);
  const deps = Array.isArray(dependencies) ? `[${dependencies.join(', ')}]` : '[]';
  const specSections = workflow || spec ? [
    '',
    '**Spec references:**',
    `- Workflow: ${workflow || 'not linked'}`,
    `- SPEC: ${spec || 'not linked'}`,
    '',
    '**Implementation report:**',
    '- Pending.',
    '',
    '**Diff summary:**',
    '- Pending.',
    '',
    '**Verification:**',
    '- Pending.',
    '',
  ] : [];
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
    `workflow: ${workflow}`,
    `spec: ${spec}`,
    'implemented: ',
    `source: ${source}`,
    '---',
    '',
    `## ${title}`,
    '',
    `**Context / why:** ${context}`,
    ...specSections,
    '',
    '**Acceptance criteria:**',
    '- [ ] ',
    '',
  ].join('\n');

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const id = nextId(PIPE);
    if (listTasks(PIPE).some((t) => t.id === id)) continue;
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

export function add({ ROOT, PIPE, sync: syncFn, BANDS, SEVMAP, SLADAYS }) {
  const type = getArg('type') || 'task';
  const title = getArg('title');
  if (!title) {
    console.error('Usage: pipeline.mjs add --type <bug|feature|chore> --title "..." [--priority P0-P3] [--workflow slug] [--spec path] [--severity S1-S4] [--wsjf uv,tc,rr,js] [--bug-type <t>]');
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
  const auto = getArg('complexity') ? { complexity: getArg('complexity'), route: '' } : classifyTask(title, ROOT);
  const id = writeTask(PIPE, {
    type, priority, title, sla: getArg('sla') || '', roadmap: getArg('roadmap') || '',
    workflow: getArg('workflow') || '', spec: getArg('spec') || '',
    source: getArg('source') || '', severity: sev || '', wsjf,
    bugType: getArg('bug-type') || '', complexity: auto.complexity,
    dependencies: parseInlineArray(getArg('depends-on')),
  }, SLADAYS);
  syncFn();
  console.log(`✅ Added ${type} ${id} (${priority}${wsjf ? `, WSJF ${wsjf}` : ''}${sev ? `, ${sev}` : ''}) to backlog: ${title}${auto.route}`);
}

export function ingest({ ROOT, PIPE, sync: syncFn }) {
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
  const taken = new Set(listTasks(PIPE).filter((t) => t.stage !== 'conclusion').map((t) => t.source).filter(Boolean));
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
    writeTask(PIPE, { type, priority, title, source, context: f.message || '' }, DEFAULTS.slaDays);
    taken.add(source);
    added += 1;
  }
  syncFn();
  console.log(`✅ Ingested ${added} finding(s) into backlog (${skipped} already present). Re-prioritize any with: pipeline.mjs prioritize <id> <P0-P3>`);
}
