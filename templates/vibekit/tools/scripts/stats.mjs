#!/usr/bin/env node
/**
 * Platform telemetry — how healthy is the VibeDevKit practice on this project?
 *
 * Reports: registered sessions, sessions per ISO week, avg files/session,
 * drift rate (Stop hook had to nudge), ADR count, agents installed, level.
 * Reads archived ledgers in `.claude/.sessions/.archive/` + live ledgers, and
 * the memory tree. Zero-dependency.
 *
 * Usage:  node vibekit/tools/scripts/stats.mjs [--json]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getLevel } from '../../runtime/config/load.mjs';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { readJsonSafe } from '../../runtime/hooks/safe-io.mjs';

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
  };
}

function main() {
  const s = collect();
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(s, null, 2) + '\n');
    return;
  }
  console.log('📊 VibeDevKit stats\n');
  console.log(`Level:                 L${s.level}`);
  console.log(`Registered sessions:   ${s.registeredSessions}`);
  console.log(`ADRs:                  ${s.adrs}`);
  console.log(`Agents / commands:     ${s.agents} / ${s.commands}`);
  console.log(`Ledgers analyzed:      ${s.ledgersSeen}`);
  console.log(`Avg files / session:   ${s.avgFilesPerSession}`);
  console.log(`Drift rate (nudged):   ${s.driftRatePct}%`);
  const weeks = Object.entries(s.perWeek).sort();
  if (weeks.length) {
    console.log('\nSessions per ISO week:');
    for (const [w, c] of weeks) console.log(`  ${w}  ${'█'.repeat(c)} (${c})`);
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
