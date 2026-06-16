#!/usr/bin/env node
/**
 * CDK-077 self-check — autonomy-readiness-v2 pure core + I/O integration.
 *
 * Asserts four invariants:
 *   (A) PURE: all signals present+passing → ready:true, confidence 'high'.
 *   (B) §8 SAFETY-CRITICAL: v1:null → ready:false, v1 signals present:false,
 *       assert it is NOT true. scorecard health score 50 → ready:false.
 *   (C) I/O on a disk fixture WITHOUT a v1 marker → ready:false,
 *       sources.skipped includes 'v1-marker', no throw.
 *   (D) CLI `--json` exits 0 and prints parseable JSON.
 *
 * Standalone runnable: node tools/selfcheck-pkg07-077.mjs
 * Exit 0 on all-pass, exit 1 on any failure.
 * Zero runtime deps — node:* only.
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync, execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dirname, '..');

const CORE_URL = pathToFileURL(
  resolve(KIT, 'templates/contextkit/tools/scripts/autonomy-readiness-v2-core.mjs'),
).href;
const IO_URL = pathToFileURL(
  resolve(KIT, 'templates/contextkit/tools/scripts/autonomy-readiness-v2.mjs'),
).href;
const IO_PATH = resolve(KIT, 'templates/contextkit/tools/scripts/autonomy-readiness-v2.mjs');

let failures = 0;
const ok  = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { console.error(`  ✗ ${msg}`); failures += 1; };

// ---------------------------------------------------------------------------
// Import pure core
// ---------------------------------------------------------------------------
let assessReadiness;
try {
  ({ assessReadiness } = await import(CORE_URL));
  ok('autonomy-readiness-v2-core.mjs imports cleanly');
} catch (err) {
  console.error(`FATAL: cannot import autonomy-readiness-v2-core.mjs: ${err?.message ?? err}`);
  process.exit(1);
}

let autonomyReadinessV2;
try {
  ({ autonomyReadinessV2 } = await import(IO_URL));
  ok('autonomy-readiness-v2.mjs imports cleanly');
} catch (err) {
  console.error(`FATAL: cannot import autonomy-readiness-v2.mjs: ${err?.message ?? err}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Minimal passing scorecard inputs: overall score 80, capability-compliance 90. */
function passingScorecard() {
  return {
    overall: { score: 80, band: 'strong', confidence: 'high' },
    dimensions: [
      { key: 'capability-compliance', score: 90, band: 'strong', status: 'scored', detail: '9/10 at parity' },
    ],
  };
}

/** Minimal v1 marker with all criteria satisfied. */
function passingV1() {
  return { coverageGreen: true, attributionPresent: true, ts: '2026-01-01T00:00:00.000Z', detail: {} };
}

/** Creates a minimal git+contextkit fixture WITHOUT a v1 marker. Returns root. */
function buildFixtureRoot() {
  const root = resolve(tmpdir(), `selfcheck-077-${Date.now()}`);
  mkdirSync(root, { recursive: true });

  try { execSync('git init -b main', { cwd: root, stdio: 'pipe' }); } catch {
    try { execSync('git init', { cwd: root, stdio: 'pipe' }); } catch { /* best-effort */ }
  }

  // Minimal contextkit structure — no autonomy/readiness.json (v1 marker absent).
  mkdirSync(resolve(root, 'contextkit', 'memory'), { recursive: true });
  mkdirSync(resolve(root, 'contextkit', 'pipeline'), { recursive: true });
  mkdirSync(resolve(root, 'contextkit', 'runtime', 'config'), { recursive: true });

  // Minimal config so pathsFor resolves without errors.
  writeFileSync(
    resolve(root, 'contextkit', 'config.json'),
    JSON.stringify({ level: 1 }, null, 2),
    'utf-8',
  );

  return root;
}

function cleanFixture(root) {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// (A) PURE: all signals present+passing → ready:true, confidence 'high'
// ---------------------------------------------------------------------------
console.log('\n(A) PURE assessReadiness — all signals present+passing\n');

{
  const result = assessReadiness({ v1: passingV1(), scorecard: passingScorecard() });

  result.ready === true
    ? ok('ready:true when all four signals present+passing')
    : bad(`expected ready:true, got ready:${result.ready}`);

  result.confidence === 'high'
    ? ok('confidence:high when all four signals present')
    : bad(`expected confidence:'high', got '${result.confidence}'`);

  Array.isArray(result.signals) && result.signals.length === 4
    ? ok('signals array has exactly 4 entries')
    : bad(`expected 4 signals, got ${result.signals?.length ?? 'undefined'}`);

  const allPresent = result.signals.every((s) => s.present && s.pass);
  allPresent
    ? ok('all four signals have present:true and pass:true')
    : bad(`some signals not present+pass: ${JSON.stringify(result.signals.filter((s) => !s.present || !s.pass))}`);

  const keys = result.signals.map((s) => s.key);
  ['v1-coverage', 'v1-attribution', 'scorecard-health', 'capability-compliance'].every((k) => keys.includes(k))
    ? ok('all four expected signal keys present in output')
    : bad(`unexpected signal keys: ${JSON.stringify(keys)}`);
}

// ---------------------------------------------------------------------------
// (B) §8 SAFETY-CRITICAL: v1:null → ready:false, scorecard health 50 → ready:false
// ---------------------------------------------------------------------------
console.log('\n(B) §8 SAFETY-CRITICAL — default-to-refuse invariants\n');

{
  // v1 absent (null) — scorecard present and fully passing.
  const noV1Result = assessReadiness({ v1: null, scorecard: passingScorecard() });

  noV1Result.ready !== true
    ? ok('§8: ready:false when v1 marker absent (not false-positive)')
    : bad('§8 VIOLATION: ready must be false when v1 is null — false-positive detected!');

  const covSig = noV1Result.signals.find((s) => s.key === 'v1-coverage');
  const attrSig = noV1Result.signals.find((s) => s.key === 'v1-attribution');

  covSig?.present === false
    ? ok('v1-coverage: present:false when v1 is null')
    : bad(`v1-coverage should have present:false when v1 null, got present:${covSig?.present}`);

  attrSig?.present === false
    ? ok('v1-attribution: present:false when v1 is null')
    : bad(`v1-attribution should have present:false when v1 null, got present:${attrSig?.present}`);

  // Explicit not-true assertion (belt-and-suspenders).
  if (noV1Result.ready === true) {
    bad('§8 CRITICAL: noV1Result.ready should NOT be true — false-positive!');
  } else {
    ok('§8: assert noV1Result.ready is NOT true (confirmed)');
  }
}

{
  // scorecard health score 50 (weak) — v1 fully passing.
  const weakScorecard = {
    overall: { score: 50, band: 'weak', confidence: 'low' },
    dimensions: [
      { key: 'capability-compliance', score: 90, band: 'strong', status: 'scored', detail: '9/10' },
    ],
  };
  const weakScorecardResult = assessReadiness({ v1: passingV1(), scorecard: weakScorecard });

  weakScorecardResult.ready !== true
    ? ok('§8: ready:false when scorecard-health score is 50 (weak)')
    : bad('§8 VIOLATION: ready must be false when scorecard-health score < 60');

  const healthSig = weakScorecardResult.signals.find((s) => s.key === 'scorecard-health');
  healthSig?.present === true && healthSig?.pass === false
    ? ok('scorecard-health: present:true, pass:false when score=50')
    : bad(`expected scorecard-health present:true pass:false, got present:${healthSig?.present} pass:${healthSig?.pass}`);
}

{
  // Both inputs null — no data at all.
  const noDataResult = assessReadiness({ v1: null, scorecard: null });
  noDataResult.ready !== true
    ? ok('§8: ready:false when both inputs null')
    : bad('§8 VIOLATION: ready must be false when all inputs null');
  noDataResult.confidence === 'none'
    ? ok('confidence:none when all inputs null')
    : bad(`expected confidence:'none', got '${noDataResult.confidence}'`);
}

// ---------------------------------------------------------------------------
// (C) I/O on disk fixture WITHOUT a v1 marker → ready:false, v1-marker skipped
// ---------------------------------------------------------------------------
console.log('\n(C) I/O integration — disk fixture without v1 marker\n');

let fixtureRoot;
try {
  fixtureRoot = buildFixtureRoot();

  let ioResult;
  try {
    ioResult = await autonomyReadinessV2(fixtureRoot);
    ok('autonomyReadinessV2 on bare fixture: no throw (fail-open)');
  } catch (err) {
    bad(`autonomyReadinessV2 threw on bare fixture: ${err?.message ?? err}`);
    ioResult = null;
  }

  if (ioResult !== null) {
    ioResult.ready !== true
      ? ok('I/O: ready:false when v1 marker absent on disk')
      : bad('I/O §8 VIOLATION: ready must be false when v1 marker absent on disk');

    Array.isArray(ioResult.sources?.skipped) && ioResult.sources.skipped.includes('v1-marker')
      ? ok('I/O: sources.skipped includes v1-marker')
      : bad(`expected 'v1-marker' in sources.skipped, got: ${JSON.stringify(ioResult.sources?.skipped)}`);

    typeof ioResult.schemaVersion === 'number'
      ? ok(`I/O: schemaVersion present (${ioResult.schemaVersion})`)
      : bad('I/O: schemaVersion missing');

    Array.isArray(ioResult.signals)
      ? ok(`I/O: signals array present (${ioResult.signals.length} entries)`)
      : bad('I/O: signals array missing');
  }
} finally {
  if (fixtureRoot) cleanFixture(fixtureRoot);
}

// ---------------------------------------------------------------------------
// (D) CLI `--json` exits 0 and prints parseable JSON
// ---------------------------------------------------------------------------
console.log('\n(D) CLI --json exits 0 and is parseable JSON\n');

{
  const cliResult = spawnSync(process.execPath, [IO_PATH, '--json'], {
    cwd: KIT,
    encoding: 'utf-8',
    timeout: 60_000,
  });

  cliResult.status === 0
    ? ok('CLI: exit code 0')
    : bad(`CLI: expected exit 0, got ${cliResult.status}; stderr: ${cliResult.stderr?.slice(0, 300)}`);

  let parsed = null;
  try {
    parsed = JSON.parse(cliResult.stdout);
    ok('CLI: stdout is valid JSON');
  } catch (err) {
    bad(`CLI: stdout is not parseable JSON: ${err?.message ?? err}`);
  }

  if (parsed !== null) {
    typeof parsed.ready === 'boolean'
      ? ok(`CLI JSON: ready field present (value: ${parsed.ready})`)
      : bad('CLI JSON: ready field missing or not boolean');

    Array.isArray(parsed.signals)
      ? ok(`CLI JSON: signals array present (${parsed.signals.length} entries)`)
      : bad('CLI JSON: signals array missing');

    typeof parsed.schemaVersion === 'number'
      ? ok(`CLI JSON: schemaVersion present (${parsed.schemaVersion})`)
      : bad('CLI JSON: schemaVersion missing');

    parsed.ready !== true || parsed.signals.every((s) => s.present && s.pass)
      ? ok('CLI JSON: ready=true only when all signals present+pass (§8 consistent)')
      : bad('CLI JSON: §8 violation — ready:true but not all signals pass');
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(
  failures === 0
    ? '\n  PASS — CDK-077 autonomy-readiness-v2 self-check: all checks passed.\n'
    : `\n  FAIL — CDK-077 autonomy-readiness-v2 self-check: ${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
