#!/usr/bin/env node
/**
 * Token economy & usage insight (roadmap #7 / L6).
 *
 * Reports Claude Code token usage for THIS project by reading the local session
 * transcripts (`~/.claude/projects/<project>/<sessionId>.jsonl`). Aggregates
 * input / output / cache tokens per session and per ISO week, and warns when a
 * session crosses the configured budget (`tokens.budgetPerSession`). Read-only,
 * local, zero third-party deps; reports **aggregated counts only**, never content.
 * Degrades to a clear "no data" message when transcripts aren't found.
 *
 * Usage:
 *   node contextkit/tools/scripts/token-report.mjs            # this project (table)
 *   node contextkit/tools/scripts/token-report.mjs --json
 *   node contextkit/tools/scripts/token-report.mjs --all      # every project, not just cwd
 *   node contextkit/tools/scripts/token-report.mjs --from <dir>   # read transcripts from <dir>
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfigSync } from '../../runtime/config/load.mjs';

const ROOT = process.cwd();
const norm = (p) => String(p || '').replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
const ROOT_N = norm(ROOT);
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

/** All `.jsonl` transcript files under the source dir (recursive, shallow). */
function findTranscripts(fromDir) {
  const base = fromDir || join(homedir(), '.claude', 'projects');
  const out = [];
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory() && depth < 3) walk(p, depth + 1);
      else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
    }
  };
  if (existsSync(base)) walk(base, 0);
  return out;
}

function isoWeek(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** sessionId → token totals, built from `message.usage` entries (filtered by cwd unless --all). */
function aggregate(files, all) {
  const sessions = new Map();
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const usage = entry?.message?.usage;
      if (!usage) continue;
      if (!all && norm(entry.cwd) !== ROOT_N) continue;
      const sid = entry.sessionId || file;
      const s = sessions.get(sid) || { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, turns: 0, at: '', week: 'unknown' };
      s.input += usage.input_tokens || 0;
      s.output += usage.output_tokens || 0;
      s.cacheRead += usage.cache_read_input_tokens || 0;
      s.cacheCreate += usage.cache_creation_input_tokens || 0;
      s.turns += 1;
      if (entry.timestamp && entry.timestamp > s.at) {
        s.at = entry.timestamp;
        s.week = isoWeek(entry.timestamp);
      }
      sessions.set(sid, s);
    }
  }
  return sessions;
}

const sessionTotal = (s) => s.input + s.output + s.cacheRead + s.cacheCreate;
const n = (x) => x.toLocaleString('en-US');

function summarize(sessions) {
  const rows = [...sessions.entries()].map(([sid, s]) => ({ sid, ...s, total: sessionTotal(s) }));
  rows.sort((a, b) => b.total - a.total);
  const totals = rows.reduce(
    (t, r) => ({ input: t.input + r.input, output: t.output + r.output, cacheRead: t.cacheRead + r.cacheRead, cacheCreate: t.cacheCreate + r.cacheCreate, total: t.total + r.total }),
    { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, total: 0 },
  );
  const weeks = {};
  for (const r of rows) weeks[r.week] = (weeks[r.week] || 0) + r.total;
  return { rows, totals, weeks, sessions: rows.length };
}

function main() {
  const budget = loadConfigSync(ROOT).tokens || { budgetPerSession: 0, warnAtPct: 80 };
  const files = findTranscripts(opt('--from'));
  const { rows, totals, weeks, sessions } = summarize(aggregate(files, flag('--all')));

  if (flag('--json')) {
    process.stdout.write(JSON.stringify({ sessions, totals, weeks, budget, perSession: rows }, null, 2) + '\n');
    return;
  }

  console.log('\n🪙  ContextDevKit token report' + (flag('--all') ? ' (all projects)' : ` — ${ROOT}`) + '\n');
  if (sessions === 0) {
    console.log('No token usage found in Claude Code transcripts (~/.claude/projects/).');
    console.log('Open this project in Claude Code and run a session, then try again.');
    return;
  }
  console.log(`Sessions: ${sessions}   Total tokens: ${n(totals.total)}`);
  console.log(`  input ${n(totals.input)} · output ${n(totals.output)} · cache-read ${n(totals.cacheRead)} · cache-write ${n(totals.cacheCreate)}\n`);

  const over = budget.budgetPerSession > 0 ? rows.filter((r) => r.total >= (budget.budgetPerSession * (budget.warnAtPct || 100)) / 100) : [];
  console.log('Top sessions by tokens:');
  for (const r of rows.slice(0, 10)) {
    const pct = budget.budgetPerSession > 0 ? ` (${Math.round((r.total / budget.budgetPerSession) * 100)}% of budget)` : '';
    const hot = budget.budgetPerSession > 0 && r.total >= (budget.budgetPerSession * (budget.warnAtPct || 100)) / 100 ? ' ⚠️' : '';
    console.log(`  ${String(r.sid).slice(0, 8)}  ${n(r.total).padStart(12)}  (${r.turns} turns)${pct}${hot}`);
  }
  console.log('\nPer ISO week:');
  for (const [week, total] of Object.entries(weeks).sort()) console.log(`  ${week}  ${n(total)}`);

  if (budget.budgetPerSession > 0) {
    console.log(`\nBudget: ${n(budget.budgetPerSession)}/session (warn at ${budget.warnAtPct}%).` + (over.length ? ` ⚠️ ${over.length} session(s) over the warn line.` : ' ✅ all within budget.'));
  } else {
    console.log('\nNo per-session budget set. Configure with: /context-config set tokens.budgetPerSession <n>');
  }
}

main();
