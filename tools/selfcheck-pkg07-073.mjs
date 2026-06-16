#!/usr/bin/env node
/**
 * CDK-073 self-check — lineage-rules-core.mjs + lineage-rules.mjs (PKG-07).
 *
 * WHY: CDK-073 introduces a pure rule engine over the CDK-070 lineage graph.
 * This suite verifies rule semantics on hermetically built graph fixtures —
 * no disk I/O needed for the pure-rule checks.
 *
 * Invariants verified:
 *   (1) Import: lineage-rules-core.mjs and lineage-rules.mjs import cleanly.
 *   (2) R1 FAIL: accepted ADR with no 'drives' edge → offender listed.
 *   (3) R2 FAIL: concluded card with no passed receipt → offender listed.
 *   (4) R4 PASS: workflow with a 'ships' edge is not an offender.
 *   (5) SAFETY: concluded card WITH a passed receipt is NOT an R2 offender.
 *   (6) SKIP: graph with no card nodes → R2 and R3 both return 'skipped' (not 'pass').
 *   (7) SKIP: graph with no workflow nodes → R4 returns 'skipped'.
 *   (8) SKIP: graph with no ADR nodes → R1 returns 'skipped'.
 *   (9) evaluateRules summary counts: pass/fail/skipped tally correctly.
 *  (10) CLI: node lineage-rules.mjs --json exits 0 and stdout is parseable JSON.
 *
 * Standalone: node tools/selfcheck-pkg07-073.mjs
 * Exit 0 = PASS, exit 1 = FAIL.
 * Zero runtime deps — node:* only.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dirname, '..');
const CORE_PATH = resolve(KIT, 'templates/contextkit/tools/scripts/lineage-rules-core.mjs');
const IO_PATH   = resolve(KIT, 'templates/contextkit/tools/scripts/lineage-rules.mjs');

// ---------------------------------------------------------------------------
// Micro-assertion harness
// ---------------------------------------------------------------------------
let failures = 0;
const ok  = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { console.error(`  ✗ ${msg}`); failures += 1; };

/**
 * @param {string} label
 * @param {boolean} condition
 */
function assert(label, condition) {
  condition ? ok(label) : bad(label);
}

// ---------------------------------------------------------------------------
// (1) Imports
// ---------------------------------------------------------------------------
console.log('\n(1) Import checks\n');

let DEFAULT_RULES, evaluateRules;
try {
  ({ DEFAULT_RULES, evaluateRules } = await import(pathToFileURL(CORE_PATH).href));
  ok('lineage-rules-core.mjs imports cleanly');
} catch (err) {
  console.error(`FATAL: cannot import lineage-rules-core.mjs: ${err?.message ?? err}`);
  process.exit(1);
}

try {
  await import(pathToFileURL(IO_PATH).href);
  ok('lineage-rules.mjs imports cleanly');
} catch (err) {
  bad(`lineage-rules.mjs import threw: ${err?.message ?? err}`);
}

// ---------------------------------------------------------------------------
// Graph fixture helpers — use pure data; no buildNodes/buildEdges needed
// ---------------------------------------------------------------------------

/**
 * Builds a minimal synthetic graph with predictable violations and passes.
 * - adr:0001 is accepted but has NO 'drives' edge → R1 offender
 * - card:DONE is in 'conclusion' but has NO passed receipt → R2 offender
 * - card:WORK is in 'working' WITH a workedIn edge → R3 pass
 * - wf:alpha has a 'ships' edge → R4 pass
 * No telemetry nodes → any telemetry-related logic is moot.
 */
function buildViolationGraph() {
  const nodes = [
    // ADR: accepted, no drives edge
    { id: 'adr:0001', type: 'adr', label: 'ADR-0001', ref: { status: 'Accepted', number: '0001' } },
    // Workflow: has a ships edge → R4 satisfied
    { id: 'wf:alpha', type: 'workflow', label: 'alpha', ref: { slug: 'alpha' } },
    // Card: conclusion stage, will have a FAILED receipt only (no passed one) → R2 offender
    { id: 'card:DONE', type: 'card', label: 'DONE', ref: { stage: 'conclusion', id: 'DONE' } },
    // Card: working stage, has workedIn edge → R3 pass
    { id: 'card:WORK', type: 'card', label: 'WORK', ref: { stage: 'working', id: 'WORK' } },
    // Session node for WORK card
    { id: 'session:1', type: 'session', label: 'session-1', ref: { number: 1 } },
    // Receipt for DONE card with result 'failed' (not 'passed')
    { id: 'receipt:DONE/check', type: 'receipt', label: 'DONE/check', ref: { result: 'failed', capability: 'check', taskId: 'DONE' } },
  ];
  const edges = [
    // wf:alpha ships card:DONE (satisfies R4)
    { from: 'wf:alpha', to: 'card:DONE', rel: 'ships', confidence: 'direct' },
    // card:WORK workedIn session:1 (satisfies R3)
    { from: 'card:WORK', to: 'session:1', rel: 'workedIn', confidence: 'direct' },
    // card:DONE attests receipt:DONE/check (result=failed — does NOT satisfy R2)
    { from: 'card:DONE', to: 'receipt:DONE/check', rel: 'attests', confidence: 'direct' },
    // NOTE: no adr:0001 drives edge → R1 violation
  ];
  return { nodes, edges };
}

/**
 * Graph with a concluded card that HAS a passed receipt — must NOT be an R2 offender.
 * Safety test for correct join logic.
 */
function buildPassedReceiptGraph() {
  const nodes = [
    { id: 'card:SHIPPED', type: 'card', label: 'SHIPPED', ref: { stage: 'conclusion', id: 'SHIPPED' } },
    { id: 'receipt:SHIPPED/run', type: 'receipt', label: 'SHIPPED/run', ref: { result: 'passed', capability: 'run', taskId: 'SHIPPED' } },
  ];
  const edges = [
    { from: 'card:SHIPPED', to: 'receipt:SHIPPED/run', rel: 'attests', confidence: 'direct' },
  ];
  return { nodes, edges };
}

/**
 * Graph with NO card nodes — R2 and R3 must return 'skipped'.
 */
function buildNoCardGraph() {
  const nodes = [
    { id: 'adr:0042', type: 'adr', label: 'ADR-0042', ref: { status: 'accepted' } },
    { id: 'wf:beta', type: 'workflow', label: 'beta', ref: { slug: 'beta' } },
  ];
  const edges = [
    { from: 'adr:0042', to: 'wf:beta', rel: 'drives', confidence: 'derived' },
    // wf:beta ships nothing → R4 would fail, but we only check R2/R3 skip here
  ];
  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// (2) R1 FAIL: accepted ADR with no drives edge
// ---------------------------------------------------------------------------
console.log('\n(2) R1 FAIL — accepted ADR without drives edge is flagged\n');

{
  const graph = buildViolationGraph();
  const { results } = evaluateRules(graph, DEFAULT_RULES);
  const r1 = results.find((r) => r.id === 'R1');
  assert('R1 result exists', Boolean(r1));
  assert('R1 status === fail', r1?.status === 'fail');
  assert('R1 offenders includes adr:0001', r1?.offenders.includes('adr:0001'));
}

// ---------------------------------------------------------------------------
// (3) R2 FAIL: concluded card with no passed receipt
// ---------------------------------------------------------------------------
console.log('\n(3) R2 FAIL — concluded card without passed receipt is flagged\n');

{
  const graph = buildViolationGraph();
  const { results } = evaluateRules(graph, DEFAULT_RULES);
  const r2 = results.find((r) => r.id === 'R2');
  assert('R2 result exists', Boolean(r2));
  assert('R2 status === fail', r2?.status === 'fail');
  assert('R2 offenders includes card:DONE', r2?.offenders.includes('card:DONE'));
}

// ---------------------------------------------------------------------------
// (4) R4 PASS: workflow with ships edge
// ---------------------------------------------------------------------------
console.log('\n(4) R4 PASS — workflow with ships edge is not an offender\n');

{
  const graph = buildViolationGraph();
  const { results } = evaluateRules(graph, DEFAULT_RULES);
  const r4 = results.find((r) => r.id === 'R4');
  assert('R4 result exists', Boolean(r4));
  assert('R4 status === pass', r4?.status === 'pass');
  assert('R4 offenders is empty', r4?.offenders.length === 0);
}

// ---------------------------------------------------------------------------
// (5) SAFETY: concluded card WITH a passed receipt is NOT an R2 offender
// ---------------------------------------------------------------------------
console.log('\n(5) SAFETY — concluded card with passed receipt is NOT an R2 offender\n');

{
  const graph = buildPassedReceiptGraph();
  const { results } = evaluateRules(graph, DEFAULT_RULES);
  const r2 = results.find((r) => r.id === 'R2');
  assert('R2 result exists', Boolean(r2));
  assert('R2 status === pass (all concluded have passed receipts)', r2?.status === 'pass');
  assert('R2 offenders is empty (card:SHIPPED has passed receipt)', r2?.offenders.length === 0);
  assert('R2 does NOT list card:SHIPPED as offender', !r2?.offenders.includes('card:SHIPPED'));
}

// ---------------------------------------------------------------------------
// (6) SKIP: no card nodes → R2 and R3 return 'skipped' (not 'pass')
// ---------------------------------------------------------------------------
console.log('\n(6) SKIP — no card nodes yields R2=skipped and R3=skipped\n');

{
  const graph = buildNoCardGraph();
  const { results } = evaluateRules(graph, DEFAULT_RULES);
  const r2 = results.find((r) => r.id === 'R2');
  const r3 = results.find((r) => r.id === 'R3');
  assert('R2 status === skipped (no cards)', r2?.status === 'skipped');
  assert('R2 is not pass when skipped', r2?.status !== 'pass');
  assert('R3 status === skipped (no cards)', r3?.status === 'skipped');
  assert('R3 is not pass when skipped', r3?.status !== 'pass');
}

// ---------------------------------------------------------------------------
// (7) SKIP: no workflow nodes → R4 returns 'skipped'
// ---------------------------------------------------------------------------
console.log('\n(7) SKIP — no workflow nodes yields R4=skipped\n');

{
  const graph = { nodes: [{ id: 'adr:0099', type: 'adr', label: 'X', ref: { status: 'draft' } }], edges: [] };
  const { results } = evaluateRules(graph, DEFAULT_RULES);
  const r4 = results.find((r) => r.id === 'R4');
  assert('R4 status === skipped (no workflows)', r4?.status === 'skipped');
  assert('R4 is not pass when skipped', r4?.status !== 'pass');
}

// ---------------------------------------------------------------------------
// (8) SKIP: no ADR nodes → R1 returns 'skipped'
// ---------------------------------------------------------------------------
console.log('\n(8) SKIP — no ADR nodes yields R1=skipped\n');

{
  const graph = { nodes: [], edges: [] };
  const { results } = evaluateRules(graph, DEFAULT_RULES);
  const r1 = results.find((r) => r.id === 'R1');
  assert('R1 status === skipped (no ADRs)', r1?.status === 'skipped');
  assert('R1 is not pass when skipped', r1?.status !== 'pass');
}

// ---------------------------------------------------------------------------
// (9) evaluateRules summary counts tally correctly
// ---------------------------------------------------------------------------
console.log('\n(9) Summary counts — pass+fail+skipped = total rules\n');

{
  const graph = buildViolationGraph();
  const { results, summary } = evaluateRules(graph, DEFAULT_RULES);
  const total = summary.pass + summary.fail + summary.skipped;
  assert(`summary total (${total}) === rules count (${results.length})`, total === results.length);
  assert('summary.fail >= 1 (R1 and R2 fail)', summary.fail >= 1);
}

// ---------------------------------------------------------------------------
// (10) CLI: exit 0 and parseable JSON
// ---------------------------------------------------------------------------
console.log('\n(10) CLI: node lineage-rules.mjs --json exits 0 + parseable JSON\n');

const cliResult = spawnSync(process.execPath, [IO_PATH, '--json'], {
  cwd: KIT,
  encoding: 'utf-8',
  timeout: 30_000,
});

assert(`CLI exit code 0 (got ${cliResult.status})`, cliResult.status === 0);

let parsedCli = null;
try {
  parsedCli = JSON.parse(cliResult.stdout);
  ok('CLI stdout is valid JSON');
} catch (err) {
  bad(`CLI stdout is not parseable JSON: ${err?.message ?? err}`);
}

if (parsedCli) {
  assert('CLI JSON has schemaVersion', typeof parsedCli.schemaVersion === 'number');
  assert('CLI JSON has results array', Array.isArray(parsedCli.results));
  assert('CLI JSON has summary', parsedCli.summary && typeof parsedCli.summary === 'object');
  assert('CLI JSON has sources', parsedCli.sources && typeof parsedCli.sources === 'object');
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const checkCount = 10; // sections above
console.log(
  failures === 0
    ? `\n  PASS — CDK-073 lineage-rules self-check: all checks passed (${checkCount} sections).\n`
    : `\n  FAIL — CDK-073 lineage-rules self-check: ${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
