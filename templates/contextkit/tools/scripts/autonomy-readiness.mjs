#!/usr/bin/env node
/**
 * `/autonomy-readiness` — measures the two grade-4 criteria the eligibility bar
 * (ADR-0045 §1) cannot derive from passive artifacts, and stamps the marker it
 * reads. EXPENSIVE + opt-in: run it before attempting `/autonomy 4`.
 *
 *   1. self-coverage — runs the kit's own `npm test` under `NODE_V8_COVERAGE`
 *      and checks every module under `runtime/hooks/**` + `runtime/config/**`
 *      (the enforcement surface) was actually exercised. A module the self-tests
 *      never load is a blind spot — green requires zero blind spots.
 *   2. attribution — runs `token-report --json` (ADR-0044 D3); present iff any
 *      agent/command bucket carries tokens.
 *
 * Writes `contextkit/memory/autonomy/readiness.json` = `{ coverageGreen,
 * attributionPresent, ts, detail }`. Absent ⇒ the bar refuses (rule 8). Never
 * flips a criterion true on its own failure — a crashed run leaves it false.
 *
 * Usage:  node contextkit/tools/scripts/autonomy-readiness.mjs [--json]
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, relative, resolve } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';

const ROOT = process.cwd();
const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Every `*.mjs` under a dir (recursive), as repo-relative POSIX paths. */
function modulesUnder(absDir) {
  const out = [];
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith('.mjs')) out.push(relative(KIT, full).replaceAll('\\', '/'));
    }
  };
  try {
    walk(absDir);
  } catch { /* missing dir → no targets */ }
  return out;
}

/** The set of repo-relative module paths with ≥1 executed function range. */
function coveredModules(covDir) {
  const covered = new Set();
  let files = [];
  try {
    files = readdirSync(covDir).filter((f) => f.startsWith('coverage-') && f.endsWith('.json'));
  } catch {
    return covered;
  }
  for (const file of files) {
    let report;
    try {
      report = JSON.parse(readFileSync(resolve(covDir, file), 'utf-8'));
    } catch {
      continue;
    }
    for (const entry of report.result || []) {
      const ran = (entry.functions || []).some((fn) => (fn.ranges || []).some((r) => r.count > 0));
      if (!ran || !entry.url?.startsWith('file://')) continue;
      const rel = relative(KIT, fileURLToPath(entry.url)).replaceAll('\\', '/');
      if (!rel.startsWith('..')) covered.add(rel);
    }
  }
  return covered;
}

/** Runs `npm test` under V8 coverage and reports the uncovered enforcement modules. */
function measureCoverage() {
  const covDir = mkdtempSync(resolve(tmpdir(), 'ctxkit-cov-'));
  const run = spawnSync('npm', ['test'], { cwd: KIT, env: { ...process.env, NODE_V8_COVERAGE: covDir }, encoding: 'utf-8', shell: process.platform === 'win32' });
  const targets = [...modulesUnder(resolve(KIT, 'templates/contextkit/runtime/hooks')), ...modulesUnder(resolve(KIT, 'templates/contextkit/runtime/config'))];
  const covered = coveredModules(covDir);
  const uncovered = targets.filter((t) => !covered.has(t));
  const green = run.status === 0 && targets.length > 0 && uncovered.length === 0;
  return { green, detail: green ? `${targets.length} enforcement modules exercised` : `suite ${run.status === 0 ? 'green' : 'RED'}; ${uncovered.length} uncovered: ${uncovered.slice(0, 6).join(', ')}` };
}

/** Runs token-report --json and reports whether D3 attribution carries any tokens. */
function measureAttribution() {
  const run = spawnSync(process.execPath, [resolve(KIT, 'templates/contextkit/tools/scripts/token-report.mjs'), '--json', '--all'], { cwd: ROOT, encoding: 'utf-8' });
  try {
    const attribution = JSON.parse(run.stdout).attribution;
    const agentTokens = ['main', 'subagent'].some((k) => Object.values(attribution.agents[k]).some((v) => v > 0));
    const present = agentTokens || Object.keys(attribution.commands).length > 0;
    return { present, detail: present ? 'attribution data found in transcripts' : 'no token attribution yet — run sessions first' };
  } catch {
    return { present: false, detail: 'token-report produced no parseable attribution' };
  }
}

function main() {
  const coverage = measureCoverage();
  const attribution = measureAttribution();
  const marker = { coverageGreen: coverage.green, attributionPresent: attribution.present, ts: new Date().toISOString(), detail: { coverage: coverage.detail, attribution: attribution.detail } };
  const file = resolve(pathsFor(ROOT).memory, 'autonomy', 'readiness.json');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(marker, null, 2) + '\n', 'utf-8');
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(marker, null, 2) + '\n');
    return;
  }
  console.log(`🎚️  Grade-4 readiness stamped to memory/autonomy/readiness.json`);
  console.log(`   self-coverage: ${coverage.green ? '✅ green' : '❌ ' + coverage.detail}`);
  console.log(`   attribution:   ${attribution.present ? '✅ present' : '❌ ' + attribution.detail}`);
  console.log(coverage.green && attribution.present ? '   Both criteria met — `/autonomy 4` can pass the bar if the event/session counts also hold.' : '   Run more sessions / add tests, then re-run. The bar refuses until both are green (rule 8).');
}

main();
