#!/usr/bin/env node
/**
 * gh-triage incremental watermark (ticket 075) — keeps "GitHub issues → backlog"
 * in sync without reprocessing. It stores the `createdAt` of the newest issue
 * already triaged; on the next run, `select` filters a `gh issue list --json`
 * dump down to issues created strictly after that watermark AND not already
 * tracked (a backlog task with `source: gh#<n>`). Re-triage stays cheap and
 * never duplicates a task. Pure over the input JSON; zero deps.
 *
 *   gh-triage.mjs watermark                  → print stored ISO ('' on first run)
 *   gh-triage.mjs select <issues.json> [--since ISO]
 *                                            → JSON { since, watermark, new[], skipped }
 *   gh-triage.mjs commit <iso>               → persist the watermark after triage
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { writeFileAtomicSync } from '../../runtime/hooks/safe-io.mjs';
import { listTasks } from './pipeline-tasks.mjs';

const PIPE = pathsFor(process.cwd()).pipeline;
const WATERMARK_FILE = resolve(PIPE, '.gh-triage.json');

/** The stored watermark ISO, or '' when there is none / the file is unreadable. */
export function readWatermark(file = WATERMARK_FILE) {
  if (!existsSync(file)) return '';
  try {
    return JSON.parse(readFileSync(file, 'utf-8').replace(/^﻿/, '')).watermark || '';
  } catch {
    return '';
  }
}

/** Issue numbers already tracked in the backlog via `source: gh#<n>`. */
export function trackedIssueNumbers(tasks) {
  const set = new Set();
  for (const task of tasks) {
    const match = /^gh#(\d+)/.exec(task.source || '');
    if (match) set.add(match[1]);
  }
  return set;
}

/**
 * Filters a `gh issue list --json number,title,createdAt,…` array down to the
 * issues worth triaging — created strictly after `since`, and not already
 * tracked. Always advances the watermark to the newest `createdAt` it sees
 * (so even an all-duplicate run moves the cursor forward).
 *
 * @param {Array<object>} issues — parsed gh JSON
 * @param {string} since — ISO watermark ('' = first run, take everything)
 * @param {Set<string>} tracked — issue numbers already in the backlog
 * @returns {{ since: string|null, watermark: string, new: object[], skipped: {old:number, duplicate:number} }}
 */
export function selectNewIssues(issues, since, tracked) {
  const sinceTime = since ? Date.parse(since) : 0;
  let watermark = since || '';
  let maxTime = Number.isFinite(sinceTime) ? sinceTime : 0;
  const fresh = [];
  let old = 0;
  let duplicate = 0;
  for (const issue of Array.isArray(issues) ? issues : []) {
    const created = issue.createdAt || '';
    const createdTime = Date.parse(created);
    if (Number.isFinite(createdTime) && createdTime > maxTime) {
      maxTime = createdTime;
      watermark = created;
    }
    if (since && Number.isFinite(createdTime) && createdTime <= sinceTime) { old += 1; continue; }
    if (tracked.has(String(issue.number))) { duplicate += 1; continue; }
    fresh.push(issue);
  }
  return { since: since || null, watermark: watermark || since || '', new: fresh, skipped: { old, duplicate } };
}

function getArg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function main() {
  const cmd = process.argv[2];
  if (cmd === 'watermark') {
    console.log(readWatermark());
  } else if (cmd === 'select') {
    const file = process.argv[3];
    if (!file || file.startsWith('--')) { console.error('Usage: gh-triage.mjs select <issues.json> [--since ISO]'); process.exit(1); }
    let issues;
    try {
      issues = JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf-8').replace(/^﻿/, ''));
    } catch (err) {
      console.error(`Could not read issues JSON: ${err?.message ?? err}`);
      process.exit(1);
    }
    const since = getArg('since') ?? readWatermark();
    console.log(JSON.stringify(selectNewIssues(issues, since, trackedIssueNumbers(listTasks(PIPE))), null, 2));
  } else if (cmd === 'commit') {
    const iso = process.argv[3];
    if (!iso) { console.error('Usage: gh-triage.mjs commit <iso-timestamp>'); process.exit(1); }
    writeFileAtomicSync(WATERMARK_FILE, JSON.stringify({ watermark: iso, updatedAt: new Date().toISOString() }, null, 2));
    console.log(`✅ gh-triage watermark → ${iso}`);
  } else {
    console.error('Usage: gh-triage.mjs <watermark|select <file.json>|commit <iso>>');
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('gh-triage.mjs')) main();
