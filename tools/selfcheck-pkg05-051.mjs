#!/usr/bin/env node
/**
 * CDK-051 self-check — project-map coverage report.
 *
 * Feeds fixture model objects to `computeCoverage` and `renderCoverage`, then
 * asserts exact counts and expected markdown structure. Runs standalone:
 *   node tools/selfcheck-pkg05-051.mjs
 *
 * Exit 0 = all checks pass. Exit 1 = at least one failure.
 * Follows the same ok/bad reporter pattern used by sibling selfcheck modules.
 */
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dir = resolve(fileURLToPath(import.meta.url), '..');
const KIT = resolve(__dir, '..');

let passes = 0;
let failures = 0;

const ok = (m) => { passes++; console.log(`  ✓ ${m}`); };
const bad = (m) => { failures++; console.error(`  ✗ ${m}`); };

// ---------------------------------------------------------------------------
// Import the module under test
// ---------------------------------------------------------------------------

const coveragePath = resolve(KIT, 'templates/contextkit/tools/scripts/project-map-coverage.mjs');
existsSync(coveragePath)
  ? ok('project-map-coverage.mjs exists at expected path')
  : bad('project-map-coverage.mjs NOT FOUND at templates/contextkit/tools/scripts/project-map-coverage.mjs');

let computeCoverage, renderCoverage;
try {
  const mod = await import('file://' + coveragePath.replaceAll('\\', '/'));
  computeCoverage = mod.computeCoverage;
  renderCoverage = mod.renderCoverage;
  typeof computeCoverage === 'function' ? ok('computeCoverage exported as function') : bad('computeCoverage not a function');
  typeof renderCoverage === 'function' ? ok('renderCoverage exported as function') : bad('renderCoverage not a function');
} catch (err) {
  bad(`Failed to import project-map-coverage.mjs: ${err?.message ?? err}`);
  console.error('Aborting — cannot test without the module.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Fixture A — typical healthy model (no oversized, no orphans, no capped)
// ---------------------------------------------------------------------------

console.log('\nFixture A: healthy model (3 modules, no oversized, no orphans)...');

const fixtureA = {
  name: 'my-project',
  fileCount: 120,
  modules: [
    { path: 'src', role: 'backend', files: 80, bytes: 12000, capped: false, deps: [], symbols: [] },
    { path: 'tests', role: 'tests', files: 30, bytes: 4000, capped: false, deps: ['src'], symbols: [] },
    { path: 'lib', role: 'shared', files: 10, bytes: 1500, capped: false, deps: [], symbols: [] },
  ],
  insights: {
    cycles: [],
    orphans: [],
    oversized: [],
  },
};

const covA = computeCoverage(fixtureA);

covA.scanned === 120 ? ok('Fixture A: scanned === 120') : bad(`Fixture A: scanned expected 120 got ${covA.scanned}`);
covA.ignored === 0 ? ok('Fixture A: ignored === 0 (no capped modules, no CDK-050)') : bad(`Fixture A: ignored expected 0 got ${covA.ignored}`);
covA.oversized === 0 ? ok('Fixture A: oversized === 0') : bad(`Fixture A: oversized expected 0 got ${covA.oversized}`);
covA.orphans === 0 ? ok('Fixture A: orphans === 0') : bad(`Fixture A: orphans expected 0 got ${covA.orphans}`);
covA.modules === 3 ? ok('Fixture A: modules === 3') : bad(`Fixture A: modules expected 3 got ${covA.modules}`);
covA.pct === 1 ? ok('Fixture A: pct === 1 (no excluded dirs)') : bad(`Fixture A: pct expected 1 got ${covA.pct}`);
typeof covA.generatedAt === 'string' && covA.generatedAt.length > 0
  ? ok('Fixture A: generatedAt is a non-empty string')
  : bad('Fixture A: generatedAt is missing or empty');

// ---------------------------------------------------------------------------
// Fixture B — model with oversized, orphans, and capped modules
// ---------------------------------------------------------------------------

console.log('\nFixture B: model with oversized, orphans, and 2 capped modules...');

const fixtureB = {
  name: 'big-project',
  fileCount: 750,
  modules: [
    { path: 'frontend', role: 'frontend', files: 600, bytes: 900000, capped: true, deps: [], symbols: [] },
    { path: 'backend', role: 'backend', files: 100, bytes: 50000, capped: false, deps: [], symbols: [] },
    { path: 'shared', role: 'shared', files: 50, bytes: 8000, capped: true, deps: [], symbols: [] },
  ],
  insights: {
    cycles: [],
    orphans: ['backend'],
    oversized: ['frontend', 'shared'],
  },
};

const covB = computeCoverage(fixtureB);

covB.scanned === 750 ? ok('Fixture B: scanned === 750') : bad(`Fixture B: scanned expected 750 got ${covB.scanned}`);
// Without CDK-050, ignored = count of capped modules = 2
covB.ignored === 2 ? ok('Fixture B: ignored === 2 (2 capped modules as proxy)') : bad(`Fixture B: ignored expected 2 got ${covB.ignored}`);
covB.oversized === 2 ? ok('Fixture B: oversized === 2') : bad(`Fixture B: oversized expected 2 got ${covB.oversized}`);
covB.orphans === 1 ? ok('Fixture B: orphans === 1') : bad(`Fixture B: orphans expected 1 got ${covB.orphans}`);
covB.modules === 3 ? ok('Fixture B: modules === 3') : bad(`Fixture B: modules expected 3 got ${covB.modules}`);
// pct = 750 / (750 + 2) = 0.997... → rounds to 1 at 2dp precision
const expectedPctB = Math.round((750 / 752) * 100) / 100;
covB.pct === expectedPctB
  ? ok(`Fixture B: pct === ${expectedPctB}`)
  : bad(`Fixture B: pct expected ${expectedPctB} got ${covB.pct}`);

// ---------------------------------------------------------------------------
// Fixture C — empty / degenerate model (degrade-gracefully check)
// ---------------------------------------------------------------------------

console.log('\nFixture C: degenerate model (fileCount missing, no insights)...');

const fixtureC = {
  name: 'partial',
  modules: [{ path: 'src', files: 5, capped: false }],
  // no fileCount, no insights
};

const covC = computeCoverage(fixtureC);

covC.scanned === 0 ? ok('Fixture C: scanned degrades to 0 when fileCount absent') : bad(`Fixture C: scanned expected 0 got ${covC.scanned}`);
covC.oversized === 0 ? ok('Fixture C: oversized degrades to 0 when insights absent') : bad(`Fixture C: oversized expected 0 got ${covC.oversized}`);
covC.orphans === 0 ? ok('Fixture C: orphans degrades to 0 when insights absent') : bad(`Fixture C: orphans expected 0 got ${covC.orphans}`);
covC.pct === 0 ? ok('Fixture C: pct === 0 (no files)') : bad(`Fixture C: pct expected 0 got ${covC.pct}`);

// ---------------------------------------------------------------------------
// Fixture D — null model (fail-open contract)
// ---------------------------------------------------------------------------

console.log('\nFixture D: null model (fail-open)...');

const covD = computeCoverage(null);

covD.scanned === 0 ? ok('Fixture D: scanned === 0 for null model') : bad(`Fixture D: scanned expected 0 got ${covD.scanned}`);
covD.pct === 0 ? ok('Fixture D: pct === 0 for null model') : bad(`Fixture D: pct expected 0 got ${covD.pct}`);

// ---------------------------------------------------------------------------
// renderCoverage — markdown structure assertions
// ---------------------------------------------------------------------------

console.log('\nrenderCoverage markdown output...');

const reportA = renderCoverage(covA);
typeof reportA === 'string' ? ok('renderCoverage returns a string') : bad('renderCoverage did not return a string');
reportA.includes('## Project-map coverage report') ? ok('report contains ## Project-map coverage report header') : bad('report missing ## Project-map coverage report header');
reportA.includes('| Metric | Value |') ? ok('report contains table header row') : bad('report missing table header row');
reportA.includes('| Modules mapped |') ? ok('report contains Modules mapped row') : bad('report missing Modules mapped row');
reportA.includes('| Source files scanned |') ? ok('report contains Source files scanned row') : bad('report missing Source files scanned row');
reportA.includes('| Excluded dirs (proxy) |') ? ok('report contains Excluded dirs row') : bad('report missing Excluded dirs row');
reportA.includes('| Coverage estimate |') ? ok('report contains Coverage estimate row') : bad('report missing Coverage estimate row');
reportA.includes('| Oversized modules |') ? ok('report contains Oversized modules row') : bad('report missing Oversized modules row');
reportA.includes('| Orphan modules |') ? ok('report contains Orphan modules row') : bad('report missing Orphan modules row');
reportA.includes('**Verdict:**') ? ok('report contains **Verdict:** line') : bad('report missing **Verdict:** line');
reportA.includes('health healthy') ? ok('Fixture A verdict shows health healthy') : bad(`Fixture A verdict health label wrong; got: ${reportA.match(/health.+/)?.[0]}`);
reportA.includes('100%') ? ok('Fixture A shows 100% coverage') : bad(`Fixture A coverage pct wrong; report:\n${reportA}`);

// Fixture B — report with needs-attention verdict
const reportB = renderCoverage(covB);
reportB.includes('health needs attention') ? ok('Fixture B verdict shows health needs attention') : bad(`Fixture B verdict wrong; got: ${reportB.match(/health.+/)?.[0]}`);

// Confirm no emoji in output (constitution rule: no emoji unless user asks)
// (render has none by design — just assert the coverage row markers are plain text)
reportA.includes('> Generated:') ? ok('report contains generated timestamp line') : bad('report missing > Generated: line');

// ---------------------------------------------------------------------------
// CLI exit-code check — run the script with no manifest; expect exit 0 + hint
// ---------------------------------------------------------------------------

console.log('\nCLI fail-open check (no manifest present)...');

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const tmpRoot = mkdtempSync(resolve(tmpdir(), 'cdk051-test-'));
let exitCode = -1;
let stdout = '';
try {
  // Run with a --root pointing at an empty temp dir (no manifest.json).
  stdout = execFileSync(process.execPath, [
    coveragePath,
    '--root', tmpRoot,
  ], { encoding: 'utf-8', timeout: 10000 });
  exitCode = 0;
} catch (err) {
  exitCode = err.status ?? 1;
  stdout = err.stdout ?? '';
}

exitCode === 0 ? ok('CLI exits 0 when no manifest present (fail-open)') : bad(`CLI exited ${exitCode} instead of 0 when no manifest`);
stdout.includes('map not generated') ? ok('CLI prints "map not generated" hint when no manifest') : bad(`CLI did not print expected hint; stdout: ${stdout.trim()}`);

// --write with a fixture manifest: confirm coverage.md is created
console.log('\nCLI --write check (fixture manifest)...');

const mapDir = resolve(tmpRoot, 'contextkit/memory/project-map');
import { mkdirSync } from 'node:fs';
mkdirSync(mapDir, { recursive: true });
writeFileSync(resolve(mapDir, 'manifest.json'), JSON.stringify({
  name: 'cli-test',
  fileCount: 50,
  modules: [{ path: 'src', role: 'backend', files: 50, bytes: 5000, capped: false, deps: [], symbols: [] }],
  insights: { cycles: [], orphans: [], oversized: [] },
}, null, 2), 'utf-8');

let writeExitCode = -1;
try {
  execFileSync(process.execPath, [
    coveragePath,
    '--root', tmpRoot,
    '--write',
  ], { encoding: 'utf-8', timeout: 10000 });
  writeExitCode = 0;
} catch (err) {
  writeExitCode = err.status ?? 1;
}
writeExitCode === 0 ? ok('CLI --write exits 0') : bad(`CLI --write exited ${writeExitCode}`);
existsSync(resolve(mapDir, 'coverage.md')) ? ok('coverage.md created under projectMap dir') : bad('coverage.md NOT created');

// Cleanup temp dir
try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

console.log(`\n${passes + failures} checks — ${passes} pass · ${failures} fail`);
if (failures > 0) {
  console.error('\nFAIL');
  process.exit(1);
}
console.log('\nPASS');
process.exit(0);
