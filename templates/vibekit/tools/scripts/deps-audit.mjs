#!/usr/bin/env node
/**
 * Dependency / supply-chain audit — the security-team's deterministic check.
 *
 * Zero-dep checks on the manifest + lockfile, plus an OPTIONAL native audit
 * (`npm`/`pnpm`/`yarn audit`) when the toolchain is present and online. Findings
 * are shaped to feed `pipeline.mjs ingest` (kind/severity/path/message/source), so
 * supply-chain issues flow into the DevPipeline backlog like any other finding.
 *
 *   node .../deps-audit.mjs            # console summary
 *   node .../deps-audit.mjs --json     # machine-readable { findings: [...] }
 *   node .../deps-audit.mjs --write    # → vibekit/memory/deps-findings.json (for ingest)
 *
 * Defensive: never throws; degrades to "nothing to report" when it can't tell.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const SEV = { critical: 5, high: 4, moderate: 3, low: 2, info: 1 };
const findings = [];

function add(severity, kind, message, path = 'package.json') {
  findings.push({ kind, severity, path, message, source: `deps:${kind}:${path}` });
}

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, 'utf-8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

function auditNode() {
  if (!existsSync(resolve(ROOT, 'package.json'))) return false;
  const pkg = readJson(resolve(ROOT, 'package.json')) || {};
  const all = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const hasDeps = Object.keys(all).length > 0;

  const locks = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'npm-shrinkwrap.json'];
  const lock = locks.find((l) => existsSync(resolve(ROOT, l)));
  if (hasDeps && !lock) add(4, 'no-lockfile', 'No lockfile committed — installs are not reproducible. Commit one.');

  for (const [name, range] of Object.entries(all)) {
    if (typeof range !== 'string') continue;
    if (range === '*' || range === 'latest' || /^[><]/.test(range)) {
      add(3, 'loose-range', `\`${name}\`: "${range}" is unbounded — pin a version (or a caret range with a lockfile).`);
    }
  }
  if (hasDeps && lock) runNativeAudit(lock);
  return true;
}

function runNativeAudit(lock) {
  const pm = lock.startsWith('pnpm') ? 'pnpm' : lock.startsWith('yarn') ? 'yarn' : 'npm';
  try {
    parseNpmAudit(execFileSync(pm, ['audit', '--json'], { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000 }));
  } catch (err) {
    // `npm audit` exits non-zero when vulnerabilities exist — the JSON is still on stdout.
    if (err?.stdout) {
      try { parseNpmAudit(err.stdout); return; } catch { /* fall through */ }
    }
    add(1, 'audit-skipped', `Could not run \`${pm} audit\` (offline or unavailable) — run it before release.`);
  }
}

function parseNpmAudit(out) {
  const data = JSON.parse(out);
  for (const [name, v] of Object.entries(data.vulnerabilities || {})) { // npm v7+
    add(SEV[v.severity] || 2, 'cve', `\`${name}\`: ${v.severity} advisory — see \`npm audit\`.`);
  }
  for (const a of Object.values(data.advisories || {})) { // npm v6
    add(SEV[a.severity] || 2, 'cve', `\`${a.module_name}\`: ${a.severity} — ${a.title}.`);
  }
}

function pythonHint() {
  if (existsSync(resolve(ROOT, 'requirements.txt')) || existsSync(resolve(ROOT, 'pyproject.toml'))) {
    add(1, 'py-audit', 'Python deps detected — run `pip-audit` / `safety check` for CVEs (not automated here yet).');
  }
}

function main() {
  auditNode();
  pythonHint();
  const result = { findings };

  if (process.argv.includes('--write')) {
    writeFileSync(resolve(ROOT, 'vibekit/memory/deps-findings.json'), JSON.stringify(result, null, 2), 'utf-8');
    console.log(`🔐 deps-audit: ${findings.length} finding(s) → vibekit/memory/deps-findings.json`);
    console.log('   → feed the backlog:  node vibekit/tools/scripts/pipeline.mjs ingest vibekit/memory/deps-findings.json --type chore');
    return;
  }
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }
  if (findings.length === 0) {
    console.log('🔐 deps-audit: no issues found.');
    return;
  }
  console.log(`🔐 deps-audit: ${findings.length} finding(s).`);
  for (const f of [...findings].sort((a, b) => b.severity - a.severity)) {
    console.log(`   ${'●'.repeat(f.severity)} ${f.kind} — ${f.message}`);
  }
}

main();
