#!/usr/bin/env node
/**
 * Fleet mode — one control plane over many VibeDevKit repos.
 *
 * Aggregates each registered repo's telemetry/scanners and reports cross-repo
 * CLAUDE.md rule drift. The registry lives OUTSIDE any repo (a true control
 * plane): `~/.vibedevkit/fleet.json` (override with `VIBE_FLEET_FILE`).
 *
 *   fleet.mjs list                       # registered repos
 *   fleet.mjs add <path>                 # register a repo (abs path stored)
 *   fleet.mjs remove <path>              # unregister
 *   fleet.mjs stats [--json]            # aggregate stats.mjs across repos
 *   fleet.mjs audit [--json]            # aggregate deep-analysis findings
 *   fleet.mjs propagate <rule-file>     # report repos whose CLAUDE.md lacks the rule
 *
 * Zero-dependency and defensive: a missing/broken repo is skipped, never throws.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, basename, resolve } from 'node:path';

const FLEET_FILE = process.env.VIBE_FLEET_FILE || resolve(homedir(), '.vibedevkit', 'fleet.json');

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, 'utf-8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

function loadRegistry() {
  const reg = readJson(FLEET_FILE);
  return reg && Array.isArray(reg.repos) ? reg : { repos: [] };
}

function saveRegistry(reg) {
  const dir = dirname(FLEET_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(FLEET_FILE, JSON.stringify(reg, null, 2) + '\n', 'utf-8');
}

/** Run a repo's script with --json and parse the result. null on any failure. */
function runRepoJson(repo, rel, args = ['--json']) {
  const script = resolve(repo, rel);
  if (!existsSync(script)) return null;
  try {
    return JSON.parse(execFileSync(process.execPath, [script, ...args], { cwd: repo, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000 }));
  } catch {
    return null;
  }
}

function isJson() {
  return process.argv.includes('--json');
}

function cmdList() {
  const { repos } = loadRegistry();
  if (isJson()) return void process.stdout.write(JSON.stringify({ file: FLEET_FILE, repos }, null, 2) + '\n');
  if (!repos.length) return void console.log(`🛰️  fleet: no repos registered (${FLEET_FILE}).\n   Add one:  node vibekit/tools/scripts/fleet.mjs add <path>`);
  console.log(`🛰️  fleet: ${repos.length} repo(s) — ${FLEET_FILE}`);
  for (const r of repos) console.log(`   ${existsSync(resolve(r, 'vibekit')) ? '✓' : '⚠'} ${r}`);
}

function cmdAdd() {
  const input = process.argv[3];
  if (!input) return void fail('Usage: fleet.mjs add <path>');
  const abs = resolve(process.cwd(), input);
  if (!existsSync(abs)) return void fail(`Path not found: ${abs}`);
  const reg = loadRegistry();
  if (reg.repos.includes(abs)) return void console.log(`already registered: ${abs}`);
  reg.repos.push(abs);
  saveRegistry(reg);
  console.log(`🛰️  fleet: registered ${abs} (${reg.repos.length} total).`);
}

function cmdRemove() {
  const abs = resolve(process.cwd(), process.argv[3] || '');
  const reg = loadRegistry();
  const next = reg.repos.filter((r) => r !== abs);
  saveRegistry({ ...reg, repos: next });
  console.log(next.length === reg.repos.length ? `not registered: ${abs}` : `🛰️  fleet: removed ${abs}.`);
}

function cmdStats() {
  const { repos } = loadRegistry();
  const rows = repos.map((repo) => {
    const s = runRepoJson(repo, 'vibekit/tools/scripts/stats.mjs');
    if (!s) return { path: repo, name: basename(repo), ok: false };
    return { path: repo, name: basename(repo), ok: true, level: s.level, registeredSessions: s.registeredSessions, adrs: s.adrs, agents: s.agents, driftRatePct: s.driftRatePct };
  });
  const ok = rows.filter((r) => r.ok);
  const totals = {
    repos: rows.length,
    withStats: ok.length,
    totalSessions: ok.reduce((a, r) => a + (r.registeredSessions || 0), 0),
    totalAdrs: ok.reduce((a, r) => a + (r.adrs || 0), 0),
    avgDriftPct: ok.length ? +(ok.reduce((a, r) => a + (r.driftRatePct || 0), 0) / ok.length).toFixed(1) : 0,
  };
  if (isJson()) return void process.stdout.write(JSON.stringify({ repos: rows, totals }, null, 2) + '\n');
  console.log(`🛰️  fleet stats — ${totals.repos} repo(s), ${totals.totalSessions} sessions, ${totals.totalAdrs} ADRs, avg drift ${totals.avgDriftPct}%\n`);
  for (const r of rows) {
    console.log(r.ok ? `   ${r.name}  L${r.level}  ${r.registeredSessions} sess  ${r.adrs} ADR  ${r.agents} agents  ${r.driftRatePct}% drift` : `   ${r.name}  (no stats — not a VibeDevKit repo?)`);
  }
}

function cmdAudit() {
  const { repos } = loadRegistry();
  const rows = repos.map((repo) => {
    const a = runRepoJson(repo, 'vibekit/tools/scripts/deep-analysis.mjs');
    if (!a || typeof a.total !== 'number') return { path: repo, name: basename(repo), ok: false };
    return { path: repo, name: basename(repo), ok: true, total: a.total, byScan: a.byScan || {} };
  });
  const ok = rows.filter((r) => r.ok);
  const totals = { repos: rows.length, scanned: ok.length, totalFindings: ok.reduce((a, r) => a + r.total, 0) };
  if (isJson()) return void process.stdout.write(JSON.stringify({ repos: rows, totals }, null, 2) + '\n');
  console.log(`🛰️  fleet audit — ${totals.totalFindings} finding(s) across ${totals.scanned}/${totals.repos} repo(s)\n`);
  for (const r of rows) console.log(r.ok ? `   ${r.name}  ${r.total} finding(s)` : `   ${r.name}  (no analyzer)`);
}

function cmdPropagate() {
  const ruleFile = process.argv[3];
  if (!ruleFile || !existsSync(ruleFile)) return void fail('Usage: fleet.mjs propagate <rule-file>  (a CLAUDE.md rule snippet)');
  const snippet = readFileSync(ruleFile, 'utf-8').trim();
  const key = snippet.split('\n').find((l) => l.trim().length > 12)?.trim() || snippet.slice(0, 40);
  const { repos } = loadRegistry();
  const result = repos.map((repo) => {
    const claudeMd = resolve(repo, 'CLAUDE.md');
    const has = existsSync(claudeMd) && readFileSync(claudeMd, 'utf-8').includes(key);
    return { path: repo, name: basename(repo), present: has };
  });
  const missing = result.filter((r) => !r.present);
  if (isJson()) return void process.stdout.write(JSON.stringify({ key, missing: missing.map((r) => r.path), checked: result }, null, 2) + '\n');
  console.log(`🛰️  fleet propagate (detect-only) — rule absent in ${missing.length}/${result.length} repo(s):\n   key: "${key}"\n`);
  for (const r of result) console.log(`   ${r.present ? '✓ has ' : '✗ MISSING'}  ${r.name}`);
  if (missing.length) console.log(`\n   Add the rule to each MISSING repo's CLAUDE.md (reviewed, per-repo) — fleet does not auto-edit.`);
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const cmd = process.argv[2];
const table = { list: cmdList, add: cmdAdd, remove: cmdRemove, stats: cmdStats, audit: cmdAudit, propagate: cmdPropagate };
if (table[cmd]) table[cmd]();
else fail('Usage: fleet.mjs <list|add|remove|stats|audit|propagate> [...]');
