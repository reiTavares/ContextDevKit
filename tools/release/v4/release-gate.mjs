#!/usr/bin/env node
/** Runs every v4 legacy-removal and distribution fence in one release boundary. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLegacyInventory, renderLegacyInventoryMarkdown, resolveContainedPath } from '../../../templates/contextkit/tools/scripts/legacy-inventory.mjs';
import { analyzeLegacyReachability, renderReachabilityMarkdown } from '../../../templates/contextkit/tools/scripts/legacy-reachability.mjs';
import { renderModuleLoadMarkdown, traceModuleLoads } from '../../../templates/contextkit/tools/scripts/module-load-trace.mjs';
import { auditNpmPackage } from './package-audit.mjs';
import { captureFootprint } from './footprint.mjs';

/** @param {string} root @param {string} path @param {string} content */
function writeReport(root, path, content) {
  const absolutePath = resolveContainedPath(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, 'utf8');
}

/**
 * Runs all release checks. A missing replacement entrypoint is a refusal, not a
 * skipped/pass receipt.
 * @param {{root:string, reportDirectory?:string}} options
 * @returns {object}
 */
export function runReleaseGate({ root, reportDirectory }) {
  const absoluteRoot = resolve(root);
  const inventory = buildLegacyInventory({ root: absoluteRoot });
  const reachability = analyzeLegacyReachability({ root: absoluteRoot });
  const moduleLoads = traceModuleLoads({ root: absoluteRoot });
  const packageAudit = auditNpmPackage({ root: absoluteRoot });
  const footprint = captureFootprint({ root: absoluteRoot, label: 'v4-release-candidate' });
  const checks = {
    inventory: inventory.complete && inventory.summary.releaseBlocking === 0 ? 'pass' : 'refuse',
    reachability: reachability.verdict,
    moduleLoads: moduleLoads.verdict,
    packageAudit: packageAudit.verdict,
  };
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    checks,
    verdict: Object.values(checks).every((verdict) => verdict === 'pass') ? 'pass' : 'refuse',
    retainedConsumers: inventory.items.filter((item) => item.releaseBlocking).map((item) => ({
      path: item.path,
      runtimeReferences: item.runtimeReferences,
      buildReferences: item.buildReferences,
      replacedBy: item.replacedBy,
    })),
    inventory,
    reachability,
    moduleLoads,
    packageAudit,
    footprint,
  };
  if (reportDirectory) {
    writeReport(absoluteRoot, `${reportDirectory}/legacy-inventory.json`, `${JSON.stringify(inventory, null, 2)}\n`);
    writeReport(absoluteRoot, `${reportDirectory}/legacy-inventory.md`, renderLegacyInventoryMarkdown(inventory));
    writeReport(absoluteRoot, `${reportDirectory}/legacy-reachability.json`, `${JSON.stringify(reachability, null, 2)}\n`);
    writeReport(absoluteRoot, `${reportDirectory}/legacy-reachability.md`, renderReachabilityMarkdown(reachability));
    writeReport(absoluteRoot, `${reportDirectory}/module-load-trace.json`, `${JSON.stringify(moduleLoads, null, 2)}\n`);
    writeReport(absoluteRoot, `${reportDirectory}/module-load-trace.md`, renderModuleLoadMarkdown(moduleLoads));
    writeReport(absoluteRoot, `${reportDirectory}/package-audit.json`, `${JSON.stringify(packageAudit, null, 2)}\n`);
    writeReport(absoluteRoot, `${reportDirectory}/footprint.json`, `${JSON.stringify(footprint, null, 2)}\n`);
    writeReport(absoluteRoot, `${reportDirectory}/release-gate.json`, `${JSON.stringify({ ...report, inventory: undefined, reachability: undefined, moduleLoads: undefined, packageAudit: undefined, footprint: undefined }, null, 2)}\n`);
  }
  return report;
}

function main() {
  const rootIndex = process.argv.indexOf('--root');
  const reportIndex = process.argv.indexOf('--report-dir');
  const root = rootIndex >= 0 ? process.argv[rootIndex + 1] : '.';
  const reportDirectory = reportIndex >= 0 ? process.argv[reportIndex + 1] : undefined;
  const report = runReleaseGate({ root, reportDirectory });
  process.stdout.write(`${JSON.stringify({ verdict: report.verdict, checks: report.checks, retainedConsumers: report.retainedConsumers.length }, null, 2)}\n`);
  if (report.verdict !== 'pass') process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`release-gate: ${error.message}`); process.exitCode = 2; }
}
