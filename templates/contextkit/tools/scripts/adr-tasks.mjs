#!/usr/bin/env node
/**
 * `adr-tasks` — turn an ADR's decision into backlog tasks (ADR-0034).
 *
 * Parses an ADR's numbered/lettered **Decision** points + **Follow-ups** bullets
 * into proposed DevPipeline tasks, each tagged `source: adr:NNNN` so the decision
 * and its work are linked (and measurable, like advisor findings). Dry-run by
 * default (constitution §8) — prints the proposal; `--write` creates the tasks by
 * delegating to `pipeline.mjs add` (the single task-writer). Zero-dep.
 *
 * Usage:
 *   node contextkit/tools/scripts/adr-tasks.mjs 0034            # dry-run (preview)
 *   node contextkit/tools/scripts/adr-tasks.mjs 0034 --write    # create the tasks
 *   node contextkit/tools/scripts/adr-tasks.mjs <path.md> --json
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';

/** Resolves an ADR id (e.g. "0034") or a path to the ADR file. */
function resolveAdr(root, arg) {
  if (arg.endsWith('.md') && existsSync(arg)) return resolve(arg);
  const id = String(arg).replace(/\D/g, '').padStart(4, '0');
  const dir = pathsFor(root).decisions;
  try {
    const file = readdirSync(dir).find((f) => f.startsWith(`${id}-`) && f.endsWith('.md'));
    if (file) return resolve(dir, file);
  } catch {
    /* no decisions dir */
  }
  return null;
}

function section(text, name) {
  // Anchor the heading on a leading newline (so `^`+`m` isn't needed) and run to the
  // next `## ` heading or end-of-string (`$` matches string end without the `m` flag).
  const re = new RegExp(`\\n##\\s+${name}\\b[\\s\\S]*?(?=\\n##\\s|$)`, 'i');
  return text.match(re)?.[0] || '';
}

/** Concise task title from a Decision point — prefers the bold lead, strips the marker. */
function titleOf(line) {
  let t = line.match(/\*\*(.+?)\*\*/)?.[1] || line;
  t = t.replace(/^[\s*_-]+/, '').replace(/^(?:[A-Za-z]|\d+)[.)]\s+/, ''); // leading bullet/emphasis, then "A. " / "1) "
  t = t.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > 80 ? `${t.slice(0, 77)}…` : t;
}

/**
 * Extracts proposed tasks from an ADR's **Decision** section — the numbered (`1.`)
 * and lettered-bold (`**A.`) points ARE the work items. Heuristic + dry-run by
 * default, so an imperfect parse is reviewed, never auto-spammed.
 * @returns {{ adrId: string, tasks: Array<{ title: string, kind: string }> }}
 */
export function parseAdrTasks(text, adrId) {
  const tasks = [];
  const seen = new Set();
  for (const line of section(text, 'Decision').split('\n')) {
    if (!/^\s*(\d+[.)]|\*\*[A-Z][.)])/.test(line)) continue;
    const title = titleOf(line);
    if (title && title.length > 4 && !seen.has(title.toLowerCase())) {
      seen.add(title.toLowerCase());
      tasks.push({ title, kind: 'chore' });
    }
  }
  return { adrId, tasks };
}

function main() {
  const argv = process.argv.slice(2);
  const wantJson = argv.includes('--json');
  const write = argv.includes('--write');
  const arg = argv.find((a) => !a.startsWith('--'));
  if (!arg) {
    console.error('Usage: adr-tasks.mjs <adr-id|path.md> [--write] [--json]');
    process.exit(1);
  }
  const root = process.cwd();
  const file = resolveAdr(root, arg);
  if (!file) {
    console.error(`ADR not found: ${arg}`);
    process.exit(1);
  }
  const adrId = (file.match(/(\d{4})-/) || [])[1] || arg.replace(/\D/g, '').padStart(4, '0');
  const { tasks } = parseAdrTasks(readFileSync(file, 'utf-8').replace(/^﻿/, ''), adrId);

  if (wantJson) {
    console.log(JSON.stringify({ adrId, write, tasks }, null, 2));
    return;
  }
  if (tasks.length === 0) {
    console.log(`No decision/follow-up tasks parsed from ADR-${adrId}.`);
    return;
  }
  console.log(`\n📋 ADR-${adrId} → ${tasks.length} proposed task(s)${write ? ' (creating)' : ' (dry-run — pass --write to create)'}:`);
  const pipeline = resolve(pathsFor(root).scripts, 'pipeline.mjs');
  for (const t of tasks) {
    console.log(`  - [${t.kind}] ${t.title}`);
    if (write) {
      const r = spawnSync(process.execPath, [pipeline, 'add', '--type', t.kind, '--source', `adr:${adrId}`, '--title', t.title], { cwd: root, encoding: 'utf-8' });
      if (r.status !== 0) console.error(`    ⚠️  add failed: ${r.stderr || r.stdout}`);
    }
  }
  console.log(write ? '\n✅ Tasks created (tagged source: adr:' + adrId + '). Run /pipeline to see the board.' : '\nReview, then re-run with --write.');
}

if (process.argv[1]?.endsWith('adr-tasks.mjs')) main();
