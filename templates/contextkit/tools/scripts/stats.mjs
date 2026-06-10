#!/usr/bin/env node
/**
 * Platform telemetry — how healthy is the ContextDevKit practice on this project?
 *
 * Reports: registered sessions, sessions per ISO week, avg files/session,
 * drift rate (Stop hook had to nudge), ADR count, agents installed, level.
 * Reads archived ledgers in `.claude/.sessions/.archive/` + live ledgers, and
 * the memory tree. Zero-dependency.
 *
 * Usage:  node contextkit/tools/scripts/stats.mjs [--json]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getLevel } from '../../runtime/config/load.mjs';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { readJsonSafe } from '../../runtime/hooks/safe-io.mjs';
import { listStates } from '../../runtime/state/state-io.mjs';

const ROOT = process.cwd();
const P = pathsFor(ROOT);

const readJson = (p) => readJsonSafe(p);

function listJson(dir) {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readJson(resolve(dir, f))).filter(Boolean);
  } catch {
    return [];
  }
}

function count(dir, re) {
  try {
    return readdirSync(dir).filter((f) => re.test(f)).length;
  } catch {
    return 0;
  }
}

function isoWeek(ms) {
  const d = new Date(ms);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3);
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.floor(Math.round((t - firstThu) / 86_400_000) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** UTC-midnight epoch ms for every registered session, parsed from its filename date. */
function sessionDates(dir) {
  try {
    return readdirSync(dir)
      .map((f) => /^(\d{4}-\d{2}-\d{2})-\d{2,}-.+\.md$/.exec(f)?.[1])
      .filter(Boolean)
      .map((iso) => Date.parse(`${iso}T00:00:00Z`))
      .filter(Number.isFinite);
  } catch {
    return [];
  }
}

/**
 * Time-to-value (ticket 079): how long from `setup.completedAt` until the first
 * registered session — the first durable artifact the practice produced. Returns
 * `ttvDays: null` with a note when setup isn't marked or no session exists yet
 * (rule 8 — report "not reached", never a fake zero).
 *
 * @param {object|null} cfg — parsed config.json
 * @param {number[]} dates — session epoch-ms list from `sessionDates`
 */
function timeToValue(cfg, dates) {
  const completedISO = cfg?.setup?.completedAt;
  const completedAt = completedISO ? Date.parse(completedISO) : NaN;
  if (!Number.isFinite(completedAt)) return { setupAt: null, firstSessionAt: null, ttvDays: null, note: 'setup not marked complete' };
  if (!dates.length) {
    return { setupAt: completedISO, firstSessionAt: null, ttvDays: null, note: `no value yet — ${Math.max(0, Math.round((Date.now() - completedAt) / 86400000))}d since setup` };
  }
  const first = Math.min(...dates);
  return { setupAt: completedISO, firstSessionAt: new Date(first).toISOString().slice(0, 10), ttvDays: Math.max(0, Math.round((first - completedAt) / 86400000)), note: null };
}

function collectForge() {
  const root = resolve(ROOT, 'agent-packages');
  let entries = [];
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return null; }
  const pkgs = entries.filter((entry) => entry.isDirectory() && /^[a-z][a-z0-9-]*@\d+\.\d+\.\d+/.test(entry.name));
  if (!pkgs.length) return null;
  let evaluated = 0;
  let monthlyTarget = 0;
  let monthlyHardCap = 0;
  const byPrimary = {};
  for (const entry of pkgs) {
    const manifestPath = resolve(root, entry.name, 'manifest.yaml');
    let manifest = '';
    try { manifest = readFileSync(manifestPath, 'utf-8'); } catch { continue; }
    const evalLine = manifest.match(/eval_passed_at:\s*['"]?([^'\n]+)['"]?/);
    if (evalLine && evalLine[1].trim() !== 'null') evaluated += 1;
    const target = Number((manifest.match(/monthly_budget_usd:\s*([\d.]+)/) || [])[1] || 0);
    monthlyTarget += target;
    monthlyHardCap += Math.round(target * 1.5);
    const providerMatch = manifest.match(/primary:\s*\n\s*provider:\s*(\w[\w-]*)/);
    const provider = providerMatch ? providerMatch[1] : 'unknown';
    byPrimary[provider] = (byPrimary[provider] || 0) + 1;
  }
  return { packages: pkgs.length, evaluated, unevaluated: pkgs.length - evaluated, monthlyTarget, monthlyHardCap, byPrimary };
}

/**
 * Autonomy telemetry (ADR-0043) — derived ONLY from the append-only state.json
 * events ("if it isn't an event, it didn't happen"). These are the numbers the
 * grade-4 eligibility bar reads (ADR-0045): transitions, actor breakdown,
 * QA bounces, and the backward-move (rollback) rate. Returns null when no
 * events exist yet — reported as "no data", never as a passing zero (rule 8).
 */
function collectAutonomy() {
  const STAGE_ORDER = { backlog: 0, working: 1, testing: 2, conclusion: 3 };
  const events = listStates(P.pipeline).flatMap((s) => s.events || []);
  if (events.length === 0) return null;
  const byActor = {};
  let backward = 0;
  for (const e of events) {
    byActor[e.actor] = (byActor[e.actor] || 0) + 1;
    if ((STAGE_ORDER[e.to] ?? 0) < (STAGE_ORDER[e.from] ?? 0)) backward += 1;
  }
  return {
    transitions: events.length,
    byActor,
    qaBounces: byActor.qa || 0,
    autoSharePct: +(((byActor.auto || 0) / events.length) * 100).toFixed(1),
    rollbackRatePct: +((backward / events.length) * 100).toFixed(1),
  };
}

function collect() {
  const ledgers = [
    ...listJson(resolve(ROOT, '.claude/.sessions')),
    ...listJson(resolve(ROOT, '.claude/.sessions/.archive')),
  ];
  const registeredSessions = count(P.sessions, /^\d{4}-\d{2}-\d{2}-\d{2,}-.+\.md$/);
  const adrs = count(P.decisions, /^\d{4}-.+\.md$/);
  const agents = count(resolve(ROOT, '.claude/agents'), /\.md$/);
  const commands = count(resolve(ROOT, '.claude/commands'), /\.md$/);
  const forge = collectForge();
  const ttv = timeToValue(readJson(P.config), sessionDates(P.sessions));

  const perWeek = {};
  let totalFiles = 0;
  let nudged = 0;
  for (const l of ledgers) {
    if (typeof l.startedAt === 'number') perWeek[isoWeek(l.startedAt)] = (perWeek[isoWeek(l.startedAt)] || 0) + 1;
    totalFiles += new Set((l.modifications || []).map((m) => m.path)).size;
    if (typeof l.stopWarnedAt === 'number') nudged += 1;
  }
  const n = ledgers.length || 1;
  return {
    level: getLevel(ROOT),
    registeredSessions,
    ledgersSeen: ledgers.length,
    avgFilesPerSession: +(totalFiles / n).toFixed(1),
    driftRatePct: +((nudged / n) * 100).toFixed(1),
    adrs,
    agents,
    commands,
    perWeek,
    forge,
    timeToValue: ttv,
    autonomy: collectAutonomy(),
  };
}

function main() {
  const s = collect();
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(s, null, 2) + '\n');
    return;
  }
  console.log('📊 ContextDevKit stats\n');
  console.log(`Level:                 L${s.level}`);
  console.log(`Registered sessions:   ${s.registeredSessions}`);
  console.log(`ADRs:                  ${s.adrs}`);
  console.log(`Agents / commands:     ${s.agents} / ${s.commands}`);
  console.log(`Ledgers analyzed:      ${s.ledgersSeen}`);
  console.log(`Avg files / session:   ${s.avgFilesPerSession}`);
  console.log(`Drift rate (nudged):   ${s.driftRatePct}%`);
  const ttv = s.timeToValue;
  if (ttv.ttvDays !== null) console.log(`Time to first value:   ${ttv.ttvDays} day(s)  (setup ${ttv.setupAt?.slice(0, 10)} → first session ${ttv.firstSessionAt})`);
  else console.log(`Time to first value:   — (${ttv.note})`);
  const weeks = Object.entries(s.perWeek).sort();
  if (weeks.length) {
    console.log('\nSessions per ISO week:');
    for (const [w, c] of weeks) console.log(`  ${w}  ${'█'.repeat(c)} (${c})`);
  }
  if (s.autonomy) {
    console.log('\n🎚️ Autonomy telemetry (state.json events — the ADR-0045 eligibility inputs)');
    console.log(`  Transitions:        ${s.autonomy.transitions}`);
    console.log(`  By actor:           ${Object.entries(s.autonomy.byActor).map(([a, c]) => `${a}=${c}`).join(', ')}`);
    console.log(`  QA bounces:         ${s.autonomy.qaBounces}`);
    console.log(`  Auto share:         ${s.autonomy.autoSharePct}%`);
    console.log(`  Rollback rate:      ${s.autonomy.rollbackRatePct}%  (bar: <10%, ≥30 transitions, ≥20 sessions)`);
  } else {
    console.log('\n🎚️ Autonomy telemetry:  no transition events yet (grade-4 bar: no data ⇒ not eligible)');
  }
  if (s.forge) {
    console.log('\n🔥 Forge Stats (agent-packages/)');
    console.log(`  Packages:           ${s.forge.packages}`);
    console.log(`  Eval-stamped:       ${s.forge.evaluated} / ${s.forge.packages}` + (s.forge.unevaluated ? `  ⚠️  ${s.forge.unevaluated} unevaluated` : ''));
    console.log(`  Monthly target:     $${s.forge.monthlyTarget.toFixed(2)}`);
    console.log(`  Monthly hard cap:   $${s.forge.monthlyHardCap.toFixed(2)}`);
    const providers = Object.entries(s.forge.byPrimary).sort((a, b) => b[1] - a[1]);
    if (providers.length) console.log('  By primary provider: ' + providers.map(([p, c]) => `${p}=${c}`).join(', '));
  }
}

main();
