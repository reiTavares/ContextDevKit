#!/usr/bin/env node
/**
 * Generic Contract Drift detector (L5/L6).
 *
 * "Contract" = the public surface other code/consumers depend on. You declare
 * which files form it via `vibekit/config.json` → `l5.contractGlobs` (prefixes
 * or exact paths). This extracts exported identifiers from those files and
 * compares against a committed baseline, flagging REMOVALS/RENAMES (the
 * breaking changes) — additions are fine.
 *
 * Usage:
 *   node vibekit/tools/scripts/contract-scan.mjs --save     # write/refresh baseline
 *   node vibekit/tools/scripts/contract-scan.mjs            # diff vs baseline (exit 1 on removals)
 *   node vibekit/tools/scripts/contract-scan.mjs --json
 *
 * Baseline: vibekit/memory/contract-baseline.json (commit it).
 * Regex-based, language-agnostic-ish (JS/TS export forms). Advisory by default;
 * wire into CI to block breaking changes without an intentional version bump.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { loadConfigSync } from '../../runtime/config/load.mjs';

const ROOT = process.cwd();
const BASELINE = resolve(ROOT, 'vibekit/memory/contract-baseline.json');
const GLOBS = loadConfigSync(ROOT).l5?.contractGlobs || [];

const EXPORT_RE = /export\s+(?:async\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
const REEXPORT_RE = /export\s*\{\s*([^}]+)\}/g;

function matchesGlob(rel) {
  return GLOBS.some((g) => rel === g || rel.startsWith(g));
}

function walk(dir, acc) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const abs = join(dir, e.name);
    const rel = relative(ROOT, abs).replaceAll('\\', '/');
    if (rel.startsWith('node_modules') || rel.startsWith('.git')) continue;
    if (e.isDirectory()) walk(abs, acc);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e.name) && matchesGlob(rel)) acc.push(rel);
  }
  return acc;
}

function extractExports(content) {
  const seen = new Set();
  let m;
  EXPORT_RE.lastIndex = 0;
  while ((m = EXPORT_RE.exec(content)) !== null) seen.add(m[1]);
  REEXPORT_RE.lastIndex = 0;
  while ((m = REEXPORT_RE.exec(content)) !== null) {
    for (const raw of m[1].split(',')) {
      const part = raw.trim().split(/\s+as\s+/).pop().replace(/[^A-Za-z0-9_$]/g, '');
      if (part) seen.add(part);
    }
  }
  return [...seen];
}

function snapshot() {
  const surface = {};
  for (const rel of walk(ROOT, [])) {
    try {
      surface[rel] = extractExports(readFileSync(resolve(ROOT, rel), 'utf-8')).sort();
    } catch {
      /* skip */
    }
  }
  return surface;
}

function diff(base, current) {
  const removals = [];
  for (const [file, names] of Object.entries(base)) {
    const now = new Set(current[file] || []);
    for (const name of names) if (!now.has(name)) removals.push(`${file} → ${name}`);
  }
  return removals;
}

function main() {
  const args = process.argv.slice(2);
  if (GLOBS.length === 0) {
    console.log('ℹ️  No l5.contractGlobs configured — nothing to track. Set them via /vibe-config to enable.');
    return;
  }
  const current = snapshot();
  if (args.includes('--save')) {
    writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n', 'utf-8');
    const total = Object.values(current).reduce((n, a) => n + a.length, 0);
    console.log(`✅ contract baseline saved — ${Object.keys(current).length} files, ${total} exported symbols.`);
    return;
  }
  if (!existsSync(BASELINE)) {
    console.log('No baseline yet. Run with --save to create vibekit/memory/contract-baseline.json, then commit it.');
    return;
  }
  const removals = diff(JSON.parse(readFileSync(BASELINE, 'utf-8')), current);
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({ removals }, null, 2) + '\n');
  } else if (removals.length === 0) {
    console.log('✅ No contract drift — no exported symbols removed/renamed.');
  } else {
    console.error(`🛑 Contract drift — ${removals.length} removed/renamed export(s):`);
    for (const r of removals) console.error(`   - ${r}`);
    console.error('\nIf intentional, bump the version (BREAKING CHANGE) and refresh the baseline with --save.');
  }
  process.exit(removals.length > 0 ? 1 : 0);
}

main();
