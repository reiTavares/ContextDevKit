#!/usr/bin/env node
/**
 * CDK-061 self-check — per-host capability compliance (PKG-06).
 * Verifies: matrix structure, row fields, verdict validity, count arithmetic, deterministic sort.
 * Exit 0 on pass, exit 1 on failure.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMPLIANCE_MODULE_PATH = resolve(
  __dirname,
  '../templates/contextkit/tools/scripts/capability-compliance.mjs',
);
const COMPLIANCE_MODULE_URL = pathToFileURL(COMPLIANCE_MODULE_PATH).href;

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => {
  console.error(`  ✗ ${msg}`);
  failures += 1;
};

// ---------------------------------------------------------------------------
// Import the module under test
// ---------------------------------------------------------------------------
let buildComplianceMatrix, summarize, loadRegistry;
try {
  ({ buildComplianceMatrix, summarize, loadRegistry } = await import(
    COMPLIANCE_MODULE_URL,
  ));
} catch (err) {
  console.error(
    `FATAL: cannot import capability-compliance.mjs: ${err?.message ?? err}`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// (a) buildComplianceMatrix returns array with one entry per capability
// ---------------------------------------------------------------------------
console.log('\n(a) Matrix structure — one row per capability\n');

let matrix;
try {
  const registry = await loadRegistry();
  matrix = buildComplianceMatrix(registry);
  Array.isArray(matrix)
    ? ok(`matrix is an array (${matrix.length} capabilities)`)
    : bad('matrix is not an array');

  if (matrix.length > 0) {
    ok(`matrix has entries (non-empty for this registry)`);
  } else {
    bad('matrix is empty — registry may not have loaded');
  }
} catch (err) {
  bad(`buildComplianceMatrix threw: ${err?.message ?? err}`);
  matrix = [];
}

// ---------------------------------------------------------------------------
// (b) Each row has boolean claude/codex/agy + verdict string
// ---------------------------------------------------------------------------
console.log('\n(b) Row structure — boolean hosts + verdict\n');

let structureOk = 0;
for (let i = 0; i < Math.min(matrix.length, 3); i++) {
  const row = matrix[i];
  const hasId = typeof row.id === 'string' && row.id.length > 0;
  const hasClaude = typeof row.claude === 'boolean';
  const hasCodex = typeof row.codex === 'boolean';
  const hasAgy = typeof row.agy === 'boolean';
  const hasVerdict = typeof row.verdict === 'string';

  if (hasId && hasClaude && hasCodex && hasAgy && hasVerdict) {
    ok(`row ${i}: ${row.id} — id, claude, codex, agy, verdict present`);
    structureOk++;
  } else {
    bad(
      `row ${i} has missing fields: id=${hasId} claude=${hasClaude} codex=${hasCodex} agy=${hasAgy} verdict=${hasVerdict}`,
    );
  }
}

// ---------------------------------------------------------------------------
// (c) Verdict is exactly 'parity' or 'GAP'
// ---------------------------------------------------------------------------
console.log('\n(c) Verdict values — only "parity" or "GAP"\n');

const validVerdicts = new Set(['parity', 'GAP']);
let invalidVerdicts = 0;
for (const row of matrix) {
  if (!validVerdicts.has(row.verdict)) {
    bad(
      `capability "${row.id}" has invalid verdict "${row.verdict}" (must be "parity" or "GAP")`,
    );
    invalidVerdicts++;
  }
}
if (invalidVerdicts === 0) {
  ok(`all ${matrix.length} capabilities have valid verdicts (parity | GAP)`);
}

// ---------------------------------------------------------------------------
// (d) summarize() counts add up: parity + gaps === total
// ---------------------------------------------------------------------------
console.log('\n(d) Summary arithmetic — parity + gaps === total\n');

let summary;
try {
  summary = summarize(matrix);
  const arithmeticOk = summary.parity + summary.gaps === summary.total;
  arithmeticOk
    ? ok(
        `parity (${summary.parity}) + gaps (${summary.gaps}) === total (${summary.total})`,
      )
    : bad(
        `arithmetic failed: ${summary.parity} + ${summary.gaps} !== ${summary.total}`,
      );

  // Spot-check: count verdicts manually
  const countedParity = matrix.filter((r) => r.verdict === 'parity').length;
  const countedGaps = matrix.filter((r) => r.verdict === 'GAP').length;
  countedParity === summary.parity
    ? ok(`counted parity matches: ${countedParity}`)
    : bad(`counted parity ${countedParity} != summary.parity ${summary.parity}`);
  countedGaps === summary.gaps
    ? ok(`counted gaps matches: ${countedGaps}`)
    : bad(`counted gaps ${countedGaps} != summary.gaps ${summary.gaps}`);
} catch (err) {
  bad(`summarize threw: ${err?.message ?? err}`);
}

// ---------------------------------------------------------------------------
// (e) Matrix is sorted deterministically by id
// ---------------------------------------------------------------------------
console.log('\n(e) Deterministic sort by id\n');

let sorted = true;
for (let i = 1; i < matrix.length; i++) {
  const prev = matrix[i - 1].id;
  const curr = matrix[i].id;
  if (prev > curr) {
    if (sorted) bad(`matrix not sorted at index ${i}: "${prev}" > "${curr}"`);
    sorted = false;
  }
}
if (sorted && matrix.length > 1) {
  ok('matrix is sorted by id (stable/deterministic order)');
} else if (matrix.length <= 1) {
  ok('matrix has ≤1 entry (vacuously sorted)');
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(
  failures === 0
    ? '\n  PASS — CDK-061 capability-compliance self-check: all checks passed.\n'
    : `\n  FAIL — CDK-061 capability-compliance self-check: ${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
