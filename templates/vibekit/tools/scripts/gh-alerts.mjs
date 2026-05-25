#!/usr/bin/env node
/**
 * GitHub security alerts → findings (the loop-closer).
 *
 * Pulls Dependabot + code-scanning alerts via the `gh` CLI and shapes them like
 * deps-audit findings, so `pipeline.mjs ingest` turns GitHub's alerts into
 * prioritized, owned backlog tasks. The `code-security` agent then triages them.
 *
 *   node .../gh-alerts.mjs            # console summary
 *   node .../gh-alerts.mjs --json     # { findings: [...] }
 *   node .../gh-alerts.mjs --write    # → vibekit/memory/gh-alerts-findings.json
 *
 * Defensive: needs an authenticated `gh` + a GitHub repo. If `gh` is missing,
 * unauthenticated, offline, or the repo has no GitHub remote, it reports nothing
 * and exits 0 — never throws, never blocks.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.cwd();
const SEV = { critical: 5, high: 4, medium: 3, moderate: 3, low: 2, warning: 2, error: 4, note: 1 };
const findings = [];

/** Maps one Dependabot alert (GitHub API shape) to a deps-audit-style finding. Pure. */
export function mapDependabotAlert(alert) {
  const sev = alert?.security_advisory?.severity || alert?.security_vulnerability?.severity || 'low';
  const pkg = alert?.dependency?.package?.name || 'dependency';
  const file = alert?.dependency?.manifest_path || 'package.json';
  return {
    kind: 'dependabot',
    severity: SEV[String(sev).toLowerCase()] || 2,
    path: file,
    message: `\`${pkg}\`: ${sev} — ${alert?.security_advisory?.summary || 'Dependabot advisory'} (${alert?.security_advisory?.ghsa_id || 'GHSA ?'}).`,
    source: `gh:dependabot:${file}`,
  };
}

/** Maps one code-scanning alert (GitHub API shape) to a finding. Pure. */
export function mapCodeScanningAlert(alert) {
  const sev = alert?.rule?.security_severity_level || alert?.rule?.severity || 'warning';
  const file = alert?.most_recent_instance?.location?.path || 'code';
  return {
    kind: 'code-scanning',
    severity: SEV[String(sev).toLowerCase()] || 2,
    path: file,
    message: `${alert?.rule?.id || 'rule'}: ${alert?.rule?.description || alert?.most_recent_instance?.message?.text || 'code-scanning alert'}.`,
    source: `gh:code-scanning:${file}`,
  };
}

function gh(args) {
  return execFileSync('gh', args, { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 });
}

function repoNwo() {
  try {
    return JSON.parse(gh(['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner || null;
  } catch {
    return null;
  }
}

function apiJson(path) {
  try {
    return JSON.parse(gh(['api', '-H', 'Accept: application/vnd.github+json', '--paginate', path]) || 'null');
  } catch {
    return null;
  }
}

function dependabotAlerts(repo) {
  const alerts = apiJson(`repos/${repo}/dependabot/alerts?state=open&per_page=100`);
  if (!Array.isArray(alerts)) return;
  for (const a of alerts) findings.push(mapDependabotAlert(a));
}

function codeScanningAlerts(repo) {
  const alerts = apiJson(`repos/${repo}/code-scanning/alerts?state=open&per_page=100`);
  if (!Array.isArray(alerts)) return;
  for (const a of alerts) findings.push(mapCodeScanningAlert(a));
}

function main() {
  const repo = repoNwo();
  if (!repo) {
    if (process.argv.includes('--json')) process.stdout.write('{"findings":[]}\n');
    else console.log('🔐 gh-alerts: no GitHub repo / `gh` unavailable — nothing to sync.');
    return;
  }
  dependabotAlerts(repo);
  codeScanningAlerts(repo);
  const result = { findings };

  if (process.argv.includes('--write')) {
    writeFileSync(resolve(ROOT, 'vibekit/memory/gh-alerts-findings.json'), JSON.stringify(result, null, 2), 'utf-8');
    console.log(`🔐 gh-alerts: ${findings.length} alert(s) → vibekit/memory/gh-alerts-findings.json`);
    console.log('   → feed the backlog:  node vibekit/tools/scripts/pipeline.mjs ingest vibekit/memory/gh-alerts-findings.json --type chore');
    return;
  }
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }
  if (findings.length === 0) {
    console.log(`🔐 gh-alerts: no open alerts for ${repo} (or none accessible).`);
    return;
  }
  console.log(`🔐 gh-alerts: ${findings.length} open alert(s) for ${repo}.`);
  for (const f of [...findings].sort((a, b) => b.severity - a.severity)) console.log(`   ${'●'.repeat(f.severity)} ${f.kind} — ${f.message}`);
}

// Auto-run only when invoked as a script; importing (for tests) is side-effect-free.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
