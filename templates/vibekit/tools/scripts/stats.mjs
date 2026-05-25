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

function collect() {
  const ledgers = [
    ...listJson(resolve(ROOT, '.claude/.sessions')),
    ...listJson(resolve(ROOT, '.claude/.sessions/.archive')),
  ];
  const registeredSessions = count(P.sessions, /^\d{4}-\d{2}-\d{2}-\d{2,}-.+\.md$/);
  const adrs = count(P.decisions, /^\d{4}-.+\.md$/);
  const agents = count(resolve(ROOT, '.claude/agents'), /\.md$/);
  const commands = count(resolve(ROOT, '.claude/commands'), /\.md$/);

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
}

main();
