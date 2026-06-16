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
import { attribute, totalOf } from './token-attribution.mjs';
import { financialSummary, presentFinancial, REPORT_SCHEMA_VERSION } from './economics/token-report-cost.mjs';
import { advisorySummary, presentAdvisories, normalizeToolUse } from './economics/report-advisories.mjs';
import { resolvePrivacyConfig } from './economics/privacy.mjs';
import { evaluateBudget } from './economics/budgets.mjs';
import { presentBudget } from './economics/budgets-report.mjs';
import { routingSummary, presentRouting } from './economics/routing-economics.mjs';
import { loadRegistry } from './economics/pricing/pricing-registry.mjs';
import { readSnapshots, quotaSummary, presentQuota } from './economics/quota-snapshots.mjs';
import { multiplierSummary, presentAutonomy } from './economics/autonomy-multiplier.mjs';
import { readDecisions, routingTelemetrySummary, presentRoutingTelemetry } from './routing/routing-telemetry.mjs';

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

/**
 * sessionId → token totals, built from `message.usage` entries (filtered by cwd
 * unless --all). Also returns the per-agent / per-command attribution (ADR-0044
 * D3) and a normalized toolEvents array (EACP Wave 3 / cards #236-#237) — all
 * derived in one pass, no second read.
 */
function aggregate(files, all) {
  const sessions = new Map();
  const attrEntries = [];
  const toolEvents = [];
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
      attrEntries.push({ message: { usage, model: entry?.message?.model }, isSidechain: entry.isSidechain, attributionSkill: entry.attributionSkill });
      // Collect tool_use events for EACP Wave 3 map-effectiveness analysis.
      if (Array.isArray(entry.message?.content)) {
        for (const item of entry.message.content) {
          if (item?.type === 'tool_use') {
            const ev = normalizeToolUse(item.name, item.input);
            if (ev !== null) {
              toolEvents.push({ ...ev, ts: Date.parse(entry.timestamp) || undefined });
            }
          }
        }
      }
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
  return { sessions, attribution: attribute(attrEntries), toolEvents };
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

/**
 * Renders the ADR-0044 D3 attribution: main-loop vs subagent fan-out split, then
 * the top commands by spend. Silent on the parts with no data (a project that
 * never fanned out shows no fan-out line) — never invents a row.
 */
function printAttribution(attribution) {
  const { main: mainLoop, subagent } = attribution.agents;
  const mainTotal = totalOf(mainLoop);
  const subTotal = totalOf(subagent);
  if (subTotal > 0) {
    const share = Math.round((subTotal / (mainTotal + subTotal)) * 100);
    console.log('\nFan-out attribution (ADR-0044):');
    console.log(`  main loop ${n(mainTotal)} · subagents ${n(subTotal)} (${share}% of spend, ${subagent.turns} subagent turns)`);
  }
  const commands = Object.entries(attribution.commands)
    .map(([command, bucket]) => ({ command, total: totalOf(bucket), turns: bucket.turns }))
    .sort((a, b) => b.total - a.total);
  if (commands.length) {
    console.log('\nTop commands by tokens:');
    for (const c of commands.slice(0, 8)) console.log(`  ${c.command.padEnd(24)} ${n(c.total).padStart(12)}  (${c.turns} turns)`);
  }
  // ADR-0052 Phase 2 — per-model spend split: is the fan-out actually running
  // cheap, or silently premium? Only meaningful when more than one model is seen.
  const models = Object.entries(attribution.byModel || {})
    .map(([model, bucket]) => ({ model, total: totalOf(bucket), turns: bucket.turns }))
    .sort((a, b) => b.total - a.total);
  if (models.length > 1 || (models.length === 1 && models[0].model !== 'unknown')) {
    console.log('\nSpend by model (ADR-0052):');
    for (const m of models) console.log(`  ${m.model.padEnd(24)} ${n(m.total).padStart(12)}  (${m.turns} turns)`);
  }
}

function main() {
  const cfg = loadConfigSync(ROOT);
  const budget = cfg.tokens || { budgetPerSession: 0, warnAtPct: 80 };
  const privacy = resolvePrivacyConfig(cfg);
  const files = findTranscripts(opt('--from'));
  const { sessions: rawSessions, attribution, toolEvents } = aggregate(files, flag('--all'));
  const { rows, totals, weeks, sessions } = summarize(rawSessions);

  const financial = financialSummary(attribution);
  const advisories = advisorySummary({ perSession: rows, toolEvents }, { privacy });

  // EACP Wave 4 (#238) — session-scope budget guard, advisory-only. Spend is the
  // hottest session's token total; the Wave-3 pressure band escalates the mode.
  // It only computes the `budgetExhausted` signal the autonomy resolver consumes;
  // this report is grade-blind (display only) and never calls the resolver.
  const sessionLimit = Number(budget.budgetPerSession) || 0;
  const budgetGuard = sessionLimit > 0 && rows.length
    ? evaluateBudget({ tokens: rows[0].total }, { scope: 'session', limit: sessionLimit, warnAtPct: budget.warnAtPct }, { pressureBand: advisories.pressure?.hottest?.band })
    : null;
  // EACP Wave 4 (#239) — routing economics + Fable audit from the per-model split.
  let registry = null;
  try { registry = loadRegistry(); } catch { registry = null; }
  const routing = routingSummary({ byModel: attribution.byModel, registry });

  // EACP Wave 5 (#240) — quota snapshots from the append-only state substrate
  // (read-only here; capture is an explicit step). Skipped when none recorded.
  const quotaFile = join(ROOT, 'contextkit', 'memory', 'quota-snapshots.jsonl');
  const quota = quotaSummary(readSnapshots(quotaFile));
  // EACP Wave 5 (#241) — autonomy multiplier. Transcripts carry no QA-green or
  // quota signal, so this honestly degrades to skipped() in the live report
  // (never a fabricated multiplier). Real signals arrive via the #242 benchmark.
  const autonomy = multiplierSummary({ quotaObservable: false, availableUnits: ['effective-mtok'] });

  // ADR-0094 — routing decision telemetry (kit-routing economics only; never the
  // provider's native cache savings). Read-only from the append-only ledger that
  // shadow/canary/active modes write; "no decisions yet" when empty (never faked).
  const routingLogFile = join(ROOT, 'contextkit', 'memory', 'routing-decisions.jsonl');
  const routingTelemetry = routingTelemetrySummary(readDecisions(routingLogFile));

  if (flag('--json')) {
    process.stdout.write(JSON.stringify({ schemaVersion: REPORT_SCHEMA_VERSION, sessions, totals, weeks, budget, perSession: rows, attribution, financial, pressure: advisories.pressure, mapEffectiveness: advisories.mapEffectiveness, budgetGuard, routing, quota, autonomy, routingTelemetry }, null, 2) + '\n');
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

  printAttribution(attribution);

  console.log('');
  console.log(presentFinancial(financial));
  console.log('');
  console.log(presentAdvisories(advisories));
  if (budgetGuard) { console.log(''); console.log(presentBudget(budgetGuard)); }
  console.log('');
  console.log(presentRouting(routing));
  console.log('');
  console.log(presentQuota(quota));
  console.log('');
  console.log(presentAutonomy(autonomy));
  console.log('');
  console.log(presentRoutingTelemetry(routingTelemetry));

  if (budget.budgetPerSession > 0) {
    console.log(`\nBudget: ${n(budget.budgetPerSession)}/session (warn at ${budget.warnAtPct}%).` + (over.length ? ` ⚠️ ${over.length} session(s) over the warn line.` : ' ✅ all within budget.'));
  } else {
    console.log('\nNo per-session budget set. Configure with: /context-config set tokens.budgetPerSession <n>');
  }
}

main();
