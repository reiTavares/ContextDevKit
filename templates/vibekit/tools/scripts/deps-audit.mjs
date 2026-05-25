#!/usr/bin/env node
/**
 * Dependency / supply-chain audit — the security-team's deterministic check.
 *
 * Zero-dep checks on the manifest + lockfile + installed metadata, plus an
 * OPTIONAL native audit (`npm`/`pnpm`/`yarn audit`) when the toolchain is
 * present and online. Findings are shaped to feed `pipeline.mjs ingest`
 * (kind/severity/path/message/source), so supply-chain issues flow into the
 * DevPipeline backlog like any other finding.
 *
 * Policy lives in `vibekit/config.json` → `deps` (requireLockfile, license
 * allow/deny); see runtime/config/defaults.mjs.
 *
 *   node .../deps-audit.mjs            # console summary
 *   node .../deps-audit.mjs --json     # machine-readable { findings: [...] }
 *   node .../deps-audit.mjs --write    # → vibekit/memory/deps-findings.json (for ingest)
 *   node .../deps-audit.mjs --sbom     # → vibekit/memory/sbom.json (CycloneDX)
 *
 * Defensive: never throws; degrades to "nothing to report" when it can't tell.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfigSync } from '../../runtime/config/load.mjs';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { readJsonSafe } from '../../runtime/hooks/safe-io.mjs';

const ROOT = process.cwd();
const P = pathsFor(ROOT);
const SEV = { critical: 5, high: 4, moderate: 3, low: 2, info: 1 };
const findings = [];

function add(severity, kind, message, path = 'package.json') {
  findings.push({ kind, severity, path, message, source: `deps:${kind}:${path}` });
}

const readJson = (p) => readJsonSafe(p);

function depPolicy() {
  try {
    return loadConfigSync(ROOT).deps || {};
  } catch {
    return { requireLockfile: true, licenses: { allow: [], deny: [] } };
  }
}

/** All declared dependency names (prod + dev). */
function depNames(pkg) {
  return Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
}

/** Best-effort SPDX id from an installed package's metadata. null if unknown. */
function licenseOf(name) {
  const meta = readJson(resolve(ROOT, 'node_modules', name, 'package.json'));
  if (!meta) return null;
  if (typeof meta.license === 'string') return meta.license;
  if (meta.license && typeof meta.license.type === 'string') return meta.license.type;
  if (Array.isArray(meta.licenses) && meta.licenses[0]?.type) return meta.licenses[0].type;
  return null;
}

function auditLicenses(pkg, policy) {
  const allow = (policy.licenses?.allow || []).map((s) => s.toLowerCase());
  const deny = (policy.licenses?.deny || []).map((s) => s.toLowerCase());
  if (!allow.length && !deny.length) return;
  for (const name of depNames(pkg)) {
    const lic = licenseOf(name);
    if (!lic) continue; // not installed / unknown — degrade silently
    const l = lic.toLowerCase();
    if (deny.includes(l)) add(4, 'license-deny', `\`${name}\`: license ${lic} is denied by policy (deps.licenses.deny).`);
    else if (allow.length && !allow.includes(l)) add(2, 'license-unlisted', `\`${name}\`: license ${lic} is not in the allow-list (deps.licenses.allow).`);
  }
}

/** Heuristic: a declared dep that does not appear in the lockfile text. */
function auditDrift(pkg, lockText) {
  for (const name of depNames(pkg)) {
    const present = lockText.includes(`node_modules/${name}`) || lockText.includes(`"${name}"`) || lockText.includes(`${name}@`) || lockText.includes(`/${name}/`);
    if (!present) add(2, 'lockfile-drift', `\`${name}\` is declared but not found in the lockfile — run install to sync it.`);
  }
}

function buildSbom(pkg) {
  const all = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const components = Object.entries(all).map(([name, range]) => {
    const meta = readJson(resolve(ROOT, 'node_modules', name, 'package.json'));
    const version = meta?.version || String(range).replace(/^[^0-9]*/, '') || '0.0.0';
    const lic = licenseOf(name);
    return { type: 'library', name, version, purl: `pkg:npm/${name}@${version}`, ...(lic ? { licenses: [{ license: { id: lic } }] } : {}) };
  });
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [{ vendor: 'VibeDevKit', name: 'deps-audit' }],
      component: { type: 'application', name: pkg.name || 'app', version: pkg.version || '0.0.0' },
    },
    components,
  };
}

function findLock() {
  const locks = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'npm-shrinkwrap.json'];
  return locks.find((l) => existsSync(resolve(ROOT, l)));
}

function auditNode(policy) {
  if (!existsSync(resolve(ROOT, 'package.json'))) return false;
  const pkg = readJson(resolve(ROOT, 'package.json')) || {};
  const all = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const hasDeps = Object.keys(all).length > 0;

  const lock = findLock();
  if (hasDeps && !lock && policy.requireLockfile !== false) add(4, 'no-lockfile', 'No lockfile committed — installs are not reproducible. Commit one.');

  for (const [name, range] of Object.entries(all)) {
    if (typeof range !== 'string') continue;
    if (range === '*' || range === 'latest' || /^[><]/.test(range)) {
      add(3, 'loose-range', `\`${name}\`: "${range}" is unbounded — pin a version (or a caret range with a lockfile).`);
    }
  }

  auditLicenses(pkg, policy);
  if (lock) {
    auditDrift(pkg, readFileSync(resolve(ROOT, lock), 'utf-8'));
    runNativeAudit(lock);
  }
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
  const parsed = JSON.parse(out);
  for (const [name, v] of Object.entries(parsed.vulnerabilities || {})) { // npm v7+
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

function writeSbom() {
  const pkg = readJson(resolve(ROOT, 'package.json'));
  if (!pkg) {
    console.log('🔐 deps-audit --sbom: no package.json found.');
    return;
  }
  const out = resolve(P.memory, 'sbom.json');
  writeFileSync(out, JSON.stringify(buildSbom(pkg), null, 2), 'utf-8');
  console.log('🔐 deps-audit: SBOM written → vibekit/memory/sbom.json (CycloneDX 1.5).');
}

function main() {
  if (process.argv.includes('--sbom')) {
    writeSbom();
    return;
  }
  auditNode(depPolicy());
  pythonHint();
  const report = { findings };

  if (process.argv.includes('--write')) {
    writeFileSync(resolve(P.memory, 'deps-findings.json'), JSON.stringify(report, null, 2), 'utf-8');
    console.log(`🔐 deps-audit: ${findings.length} finding(s) → vibekit/memory/deps-findings.json`);
    console.log('   → feed the backlog:  node vibekit/tools/scripts/pipeline.mjs ingest vibekit/memory/deps-findings.json --type chore');
    return;
  }
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
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
