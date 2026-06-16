#!/usr/bin/env node
/**
 * CDK-075 self-check — evidence-taxonomy canonical taxonomy + classifier.
 *
 * Asserts five invariants:
 *   (1) EVIDENCE_TAXONOMY.outcomes contains every receipt-store RESULTS value.
 *   (2) classifyEvidence maps a 'passed' receipt node to family='outcome' kind='passed'.
 *   (3) SAFETY-CRITICAL: taxonomyCoverage.unknownKinds includes a rogue result
 *       ('totally-made-up') and the known result ('passed') is NOT in unknownKinds
 *       — no silent bucketing (§8 anti-theatre).
 *   (4) Fail-open: bare root (no contextkit) → evidenceTaxonomy() does not throw;
 *       registry is in sources.skipped OR the lineage graph is skipped.
 *   (5) CLI `node evidence-taxonomy.mjs --json` exits 0 and stdout is parseable JSON.
 *
 * Standalone runnable: node tools/selfcheck-pkg07-075.mjs
 * Exit 0 on all-pass, exit 1 on any failure.
 * Zero runtime deps — node:* only.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync, execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dirname, '..');

const CORE_URL = pathToFileURL(
  resolve(KIT, 'templates/contextkit/tools/scripts/evidence-taxonomy-core.mjs'),
).href;
const IO_PATH = resolve(KIT, 'templates/contextkit/tools/scripts/evidence-taxonomy.mjs');
const IO_URL  = pathToFileURL(IO_PATH).href;

let failures = 0;
const ok  = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { console.error(`  ✗ ${msg}`); failures += 1; };

// ---------------------------------------------------------------------------
// Import modules under test
// ---------------------------------------------------------------------------
let buildTaxonomy, classifyEvidence, taxonomyCoverage;
try {
  ({ buildTaxonomy, classifyEvidence, taxonomyCoverage } = await import(CORE_URL));
  ok('evidence-taxonomy-core.mjs imports cleanly');
} catch (err) {
  console.error(`FATAL: cannot import evidence-taxonomy-core.mjs: ${err?.message ?? err}`);
  process.exit(1);
}

let evidenceTaxonomy;
try {
  ({ evidenceTaxonomy } = await import(IO_URL));
  ok('evidence-taxonomy.mjs imports cleanly');
} catch (err) {
  console.error(`FATAL: cannot import evidence-taxonomy.mjs: ${err?.message ?? err}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Fixture data — REAL RESULTS array + minimal registry with one receiptType
// ---------------------------------------------------------------------------
const RECEIPT_STORE_URL = pathToFileURL(
  resolve(KIT, 'templates/contextkit/runtime/execution/receipt-store.mjs'),
).href;

let RESULTS;
try {
  ({ RESULTS } = await import(RECEIPT_STORE_URL));
  ok(`receipt-store RESULTS loaded: [${RESULTS.join(', ')}]`);
} catch (err) {
  console.error(`FATAL: cannot import receipt-store.mjs: ${err?.message ?? err}`);
  process.exit(1);
}

const FIXTURE_RECEIPT_TYPE = 'test-run';
const FIXTURE_CAP_ID = 'tests';
const FIXTURE_REGISTRY = {
  version: 1,
  capabilities: [{ id: FIXTURE_CAP_ID, kind: 'public', entrypoint: 'npm test', receiptType: FIXTURE_RECEIPT_TYPE }],
};
const KNOWN_RECEIPT_NODE = { type: 'receipt', id: 'receipt:CDK-TEST/tests', ref: { capability: FIXTURE_CAP_ID, result: 'passed', taskId: 'CDK-TEST' } };
const ROGUE_RESULT = 'totally-made-up';
const ROGUE_RECEIPT_NODE = { type: 'receipt', id: 'receipt:CDK-TEST/rogue', ref: { capability: 'nonexistent-cap', result: ROGUE_RESULT, taskId: 'CDK-TEST' } };

// ---------------------------------------------------------------------------
// (1) EVIDENCE_TAXONOMY.outcomes contains every RESULTS value
// ---------------------------------------------------------------------------
console.log('\n(1) buildTaxonomy — outcomes cover every RESULTS value\n');

const taxonomy = buildTaxonomy(RESULTS, FIXTURE_REGISTRY);

Array.isArray(taxonomy?.outcomes)
  ? ok(`taxonomy.outcomes is an array (${taxonomy.outcomes.length} entries)`)
  : bad('taxonomy.outcomes should be an array');

Array.isArray(taxonomy?.evidenceTypes)
  ? ok(`taxonomy.evidenceTypes is an array (${taxonomy.evidenceTypes.length} entries)`)
  : bad('taxonomy.evidenceTypes should be an array');

if (Array.isArray(taxonomy?.outcomes)) {
  const taxonomyKinds = new Set(taxonomy.outcomes.map((o) => o.kind));
  for (const result of RESULTS) {
    taxonomyKinds.has(result)
      ? ok(`outcome '${result}' present in taxonomy`)
      : bad(`outcome '${result}' MISSING from taxonomy — RESULTS not fully covered`);
  }
  // Verify family field
  const allOutcomeFamily = taxonomy.outcomes.every((o) => o.family === 'outcome');
  allOutcomeFamily
    ? ok('all outcome entries carry family="outcome"')
    : bad('some outcome entries have wrong family value');
}

// Verify evidenceTypes derived from registry
if (Array.isArray(taxonomy?.evidenceTypes)) {
  const testRunEntry = taxonomy.evidenceTypes.find((a) => a.kind === FIXTURE_RECEIPT_TYPE);
  testRunEntry
    ? ok(`artifact kind '${FIXTURE_RECEIPT_TYPE}' derived from registry`)
    : bad(`artifact kind '${FIXTURE_RECEIPT_TYPE}' missing — registry not read`);
  if (testRunEntry) {
    testRunEntry.capabilityIds.includes(FIXTURE_CAP_ID)
      ? ok(`artifact '${FIXTURE_RECEIPT_TYPE}' carries capabilityId '${FIXTURE_CAP_ID}'`)
      : bad(`artifact '${FIXTURE_RECEIPT_TYPE}' should carry capabilityId '${FIXTURE_CAP_ID}'`);
  }
}

// ---------------------------------------------------------------------------
// (2) classifyEvidence maps 'passed' receipt node → family='outcome' kind='passed'
// ---------------------------------------------------------------------------
console.log('\n(2) classifyEvidence — passed receipt → outcome/passed\n');

const knownClassification = classifyEvidence(KNOWN_RECEIPT_NODE, taxonomy);

knownClassification?.family === 'outcome'
  ? ok(`classifyEvidence: family='outcome' for passed receipt`)
  : bad(`classifyEvidence: expected family='outcome', got '${knownClassification?.family}'`);

knownClassification?.kind === 'passed'
  ? ok(`classifyEvidence: kind='passed'`)
  : bad(`classifyEvidence: expected kind='passed', got '${knownClassification?.kind}'`);

knownClassification?.confidence === 'direct'
  ? ok(`classifyEvidence: confidence='direct' for known result`)
  : bad(`classifyEvidence: expected confidence='direct', got '${knownClassification?.confidence}'`);

knownClassification?.artifactKind === FIXTURE_RECEIPT_TYPE
  ? ok(`classifyEvidence: artifactKind='${FIXTURE_RECEIPT_TYPE}' resolved via capability`)
  : bad(`classifyEvidence: expected artifactKind='${FIXTURE_RECEIPT_TYPE}', got '${knownClassification?.artifactKind}'`);

// Non-receipt node → n/a
const nonReceiptNode = { type: 'card', id: 'card:CDK-TEST', ref: {} };
const nonReceiptClassification = classifyEvidence(nonReceiptNode, taxonomy);
nonReceiptClassification?.family === 'none' && nonReceiptClassification?.kind === 'n/a'
  ? ok(`classifyEvidence: non-receipt node → family='none', kind='n/a'`)
  : bad(`classifyEvidence: non-receipt node wrong result: ${JSON.stringify(nonReceiptClassification)}`);

// ---------------------------------------------------------------------------
// (3) SAFETY-CRITICAL: unknownKinds catches rogue; known 'passed' NOT in unknownKinds
// ---------------------------------------------------------------------------
console.log('\n(3) taxonomyCoverage — §8 anti-theatre: unknownKinds surfaces rogue results\n');

const fakeGraph = { nodes: [KNOWN_RECEIPT_NODE, ROGUE_RECEIPT_NODE], edges: [] };
const coverage = taxonomyCoverage(fakeGraph, taxonomy);

typeof coverage?.receipts === 'number' && coverage.receipts === 2
  ? ok(`taxonomyCoverage: receipts=2 (both nodes counted)`)
  : bad(`taxonomyCoverage: expected receipts=2, got ${coverage?.receipts}`);

Array.isArray(coverage?.unknownKinds)
  ? ok('taxonomyCoverage: unknownKinds is an array')
  : bad('taxonomyCoverage: unknownKinds should be an array');

if (Array.isArray(coverage?.unknownKinds)) {
  // §8 CRITICAL: rogue result MUST appear in unknownKinds
  coverage.unknownKinds.includes(ROGUE_RESULT)
    ? ok(`§8 PASS: rogue result '${ROGUE_RESULT}' IS in unknownKinds`)
    : bad(`§8 FAIL: rogue result '${ROGUE_RESULT}' NOT in unknownKinds — silent bucketing!`);

  // §8 CRITICAL: known result 'passed' MUST NOT appear in unknownKinds
  !coverage.unknownKinds.includes('passed')
    ? ok(`§8 PASS: known result 'passed' is NOT in unknownKinds`)
    : bad(`§8 FAIL: 'passed' appears in unknownKinds — false positive!`);
}

// byResult should record both results
typeof coverage?.byResult?.['passed'] === 'number' && coverage.byResult['passed'] >= 1
  ? ok(`taxonomyCoverage: byResult['passed']=${coverage.byResult['passed']}`)
  : bad(`taxonomyCoverage: byResult['passed'] missing or zero`);

typeof coverage?.byResult?.[ROGUE_RESULT] === 'number' && coverage.byResult[ROGUE_RESULT] >= 1
  ? ok(`taxonomyCoverage: byResult['${ROGUE_RESULT}']=${coverage.byResult[ROGUE_RESULT]}`)
  : bad(`taxonomyCoverage: byResult['${ROGUE_RESULT}'] missing or zero`);

// ---------------------------------------------------------------------------
// (4) Fail-open: bare root → no throw; skipped sources reported
// ---------------------------------------------------------------------------
console.log('\n(4) evidenceTaxonomy — fail-open on bare root (no contextkit)\n');

const bareRoot = resolve(tmpdir(), `selfcheck-pkg07-075-bare-${Date.now()}`);
mkdirSync(bareRoot, { recursive: true });
try { execSync('git init -b main', { cwd: bareRoot, stdio: 'pipe' }); } catch {
  try { execSync('git init', { cwd: bareRoot, stdio: 'pipe' }); } catch { /* best-effort */ }
}

let bareReport;
try {
  bareReport = await evidenceTaxonomy(bareRoot);
  ok('evidenceTaxonomy on bare root: no throw (fail-open)');
} catch (err) {
  bad(`evidenceTaxonomy on bare root threw: ${err?.message ?? err}`);
  bareReport = null;
}

if (bareReport) {
  typeof bareReport.schemaVersion === 'number'
    ? ok(`schemaVersion present: ${bareReport.schemaVersion}`)
    : bad('schemaVersion missing from report');

  const { present, skipped } = bareReport.sources ?? {};
  // Either registry is skipped OR lineage-graph stores are skipped — both are valid
  const hasSkipped = Array.isArray(skipped) && skipped.length > 0;
  hasSkipped
    ? ok(`bare root: ${skipped.length} source(s) skipped: ${skipped.join(', ')}`)
    : bad('bare root: expected at least one skipped source, got none');

  // Taxonomy should still have outcomes (from RESULTS, which never needs I/O)
  typeof bareReport.taxonomy?.outcomeCount === 'number' && bareReport.taxonomy.outcomeCount > 0
    ? ok(`bare root: taxonomy.outcomeCount=${bareReport.taxonomy.outcomeCount} (RESULTS loaded)`)
    : bad('bare root: taxonomy.outcomeCount should be >0 (RESULTS is in-memory)');
}

try { rmSync(bareRoot, { recursive: true, force: true }); } catch { /* best-effort */ }

// ---------------------------------------------------------------------------
// (5) CLI: node evidence-taxonomy.mjs --json exits 0 + parseable JSON
// ---------------------------------------------------------------------------
console.log('\n(5) CLI: --json exits 0 and stdout is parseable JSON\n');

const cliResult = spawnSync(process.execPath, [IO_PATH, '--json'], {
  cwd: KIT,
  encoding: 'utf-8',
  timeout: 30_000,
});

cliResult.status === 0
  ? ok('CLI: exit code 0')
  : bad(`CLI: expected exit 0, got ${cliResult.status}; stderr: ${cliResult.stderr?.slice(0, 200)}`);

let parsedCliOutput = null;
try {
  parsedCliOutput = JSON.parse(cliResult.stdout);
  ok('CLI: stdout is valid JSON');
} catch (err) {
  bad(`CLI: stdout is not parseable JSON: ${err?.message ?? err}`);
}

if (parsedCliOutput) {
  typeof parsedCliOutput.schemaVersion === 'number'
    ? ok(`CLI JSON: schemaVersion=${parsedCliOutput.schemaVersion}`)
    : bad('CLI JSON: schemaVersion missing');

  typeof parsedCliOutput.taxonomy?.outcomeCount === 'number'
    ? ok(`CLI JSON: taxonomy.outcomeCount=${parsedCliOutput.taxonomy.outcomeCount}`)
    : bad('CLI JSON: taxonomy.outcomeCount missing');

  typeof parsedCliOutput.coverage?.receipts === 'number'
    ? ok(`CLI JSON: coverage.receipts=${parsedCliOutput.coverage.receipts}`)
    : bad('CLI JSON: coverage.receipts missing');

  Array.isArray(parsedCliOutput.coverage?.unknownKinds)
    ? ok('CLI JSON: coverage.unknownKinds is an array')
    : bad('CLI JSON: coverage.unknownKinds missing');
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(
  failures === 0
    ? '\n  PASS — CDK-075 evidence-taxonomy self-check: all checks passed.\n'
    : `\n  FAIL — CDK-075 evidence-taxonomy self-check: ${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
