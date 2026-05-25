#!/usr/bin/env node
/**
 * Deep analysis — the deterministic aggregator behind `/deep-analysis`.
 *
 * Runs every deterministic scanner the project ships and merges their findings
 * into ONE report, shaped for `pipeline.mjs ingest`. The slash command adds the
 * judgment layer (security/architecture/bugs) on top. Defensive: a scanner that
 * errors or isn't applicable contributes nothing rather than failing the run.
 *
 *   node .../deep-analysis.mjs            # console summary
 *   node .../deep-analysis.mjs --json     # merged { findings: [...] }
 *   node .../deep-analysis.mjs --write    # → vibekit/memory/deep-analysis-findings.json
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';

const ROOT = process.cwd();
const P = pathsFor(ROOT);
const SCANS = [
  { name: 'tech-debt', script: 'tech-debt-scan.mjs' },
  { name: 'deps', script: 'deps-audit.mjs' },
  { name: 'contract', script: 'contract-scan.mjs' },
];

function runScan(script) {
  try {
    const out = execFileSync('node', [`vibekit/tools/scripts/${script}`, '--json'], { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 120000 });
    const data = JSON.parse(out.replace(/^﻿/, ''));
    return Array.isArray(data) ? data : data.findings || [];
  } catch {
    return [];
  }
}

function main() {
  const findings = [];
  const byScan = {};
  for (const s of SCANS) {
    const f = runScan(s.script).map((x) => ({ ...x, scan: s.name }));
    byScan[s.name] = f.length;
    findings.push(...f);
  }
  const result = { findings, byScan, total: findings.length, at: new Date().toISOString() };

  if (process.argv.includes('--write')) {
    writeFileSync(resolve(P.memory, 'deep-analysis-findings.json'), JSON.stringify(result, null, 2), 'utf-8');
    console.log(`🔬 deep-analysis: ${findings.length} finding(s) → vibekit/memory/deep-analysis-findings.json`);
    console.log('   → ingest:  node vibekit/tools/scripts/pipeline.mjs ingest vibekit/memory/deep-analysis-findings.json --type chore');
    return;
  }
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }
  console.log(`🔬 deep-analysis: ${findings.length} deterministic finding(s) across ${SCANS.length} scanners.`);
  for (const [k, n] of Object.entries(byScan)) console.log(`   ${k}: ${n}`);
  console.log('   (run /deep-analysis for the full sweep: + judgment, report, ADRs, backlog.)');
}

main();
