#!/usr/bin/env node
/**
 * `adr-tasks` — preview work implied by an ADR decision (ADR-0034).
 *
 * Parses an ADR's numbered/lettered **Decision** points + **Follow-ups** bullets
 * into a reviewable proposal. This command is preview-only; it never writes task authority.
 * Accepted work must be added explicitly to one scoped `tasks.json` through
 * `pipeline.mjs add --tasks <scope>`. Zero-dep.
 *
 * Usage:
 *   node contextkit/tools/scripts/adr-tasks.mjs 0034            # dry-run (preview)
 *   node contextkit/tools/scripts/adr-tasks.mjs <path.md> --json
 */
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
 * @returns {{ adrId: string, tasks: Array<{ title: string }> }}
 */
export function parseAdrTasks(text, adrId) {
  const tasks = [];
  const seen = new Set();
  for (const line of section(text, 'Decision').split('\n')) {
    if (!/^\s*(\d+[.)]|\*\*[A-Z][.)])/.test(line)) continue;
    const title = titleOf(line);
    if (title && title.length > 4 && !seen.has(title.toLowerCase())) {
      seen.add(title.toLowerCase());
      tasks.push({ title });
    }
  }
  return { adrId, tasks };
}

function main() {
  const argv = process.argv.slice(2);
  const wantJson = argv.includes('--json');
  if (argv.includes('--write')) {
    console.error('adr-tasks is preview-only; add accepted work with pipeline.mjs add --tasks <scope>.');
    process.exit(1);
  }
  const arg = argv.find((a) => !a.startsWith('--'));
  if (!arg) {
    console.error('Usage: adr-tasks.mjs <adr-id|path.md> [--json]');
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
    console.log(JSON.stringify({ adrId, tasks }, null, 2));
    return;
  }
  if (tasks.length === 0) {
    console.log(`No decision/follow-up tasks parsed from ADR-${adrId}.`);
    return;
  }
  console.log(`\n📋 ADR-${adrId} → ${tasks.length} proposed task(s) (preview-only):`);
  for (const t of tasks) {
    console.log(`  - ${t.title}`);
  }
  console.log('\nReview the proposal, then add accepted work to an explicit scope with pipeline.mjs add --tasks <scope>.');
}

if (process.argv[1]?.endsWith('adr-tasks.mjs')) main();
