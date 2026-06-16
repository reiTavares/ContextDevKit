/**
 * Self-check — EACP Wave 7 baseline harness (card #176 / CDK-003).
 *
 * Module — EACP Wave 7 / card #176 (CDK-003).
 * Asserts the three baseline modules are internally sound AND honest:
 * - baseline-scenarios: BASELINE_SCENARIO_SCHEMA_VERSION present; SCENARIOS
 *   length >=10; SCENARIO_KINDS exactly 10; each kind appears once in SCENARIOS;
 *   listScenarios/getScenario/validateScenario exported.
 * - baseline-harness: BASELINE_SCHEMA_VERSION + EVENT_KINDS exported; contract
 *   functions exported; buildBaselineSpec on unknown id → skipped; recordBaseline
 *   with no events → skipped (no executor this wave); claim always null.
 * - baseline-report: BASELINE_REPORT_SCHEMA_VERSION + baselineStatus/presentBaseline
 *   exported; baselineStatus on absent ledger → pending true, recorded 0, claim null.
 * - File-size invariant: each new file ≤308 lines.
 * - Determinism invariant: no Date.now()/Math.random()/new Date() in the 3 files.
 * - Zero-dep invariant: node:* and relative imports only.
 *
 * Cohesion note (constitution §1): one cohesive assertion suite for Wave 7;
 * registered in selfcheck-eacp-all.mjs, NOT selfcheck.mjs. Zero runtime deps.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Internal helpers (mirroring selfcheck-eacp-benchmark.mjs)
// ---------------------------------------------------------------------------

/** @private — count non-empty lines in a file (reports 0 if unreadable). */
async function lineCount(filePath) {
  try {
    const text = await readFile(filePath, 'utf-8');
    return text.split('\n').filter((l) => l.trim().length > 0).length;
  } catch { return 0; }
}

/** @private — check a module has only node:/* or relative imports (zero-dep). */
async function checkModuleZeroDep(modPath) {
  let content = '';
  try { content = await readFile(modPath, 'utf-8'); }
  catch (err) { return { error: `could not read: ${err?.message ?? err}` }; }
  const importRegex = /^import\s+(?:[^"'`]*\s+)?from\s+['"`]([^'"`]+)['"`]/gm;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const spec = match[1];
    if (!spec.startsWith('.') && !spec.startsWith('node:')) return { error: `imports from "${spec}"` };
  }
  return { error: null };
}

/** @private — check a file has no Date.now()/Math.random()/new Date() in non-comment code. */
async function checkDeterministic(filePath) {
  let content = '';
  try { content = await readFile(filePath, 'utf-8'); }
  catch (err) { return { error: `could not read: ${err?.message ?? err}` }; }
  // Strip single-line comments and block comments before scanning, so that
  // documentation sentences like "no Date.now() here" don't trip the guard.
  const stripped = content
    .split('\n')
    .map((line) => {
      // Remove // comment portion (naive but sufficient — no regex edge cases in these files).
      const ci = line.indexOf('//');
      return ci >= 0 ? line.slice(0, ci) : line;
    })
    .join('\n')
    // Strip block comments.
    .replace(/\/\*[\s\S]*?\*\//g, '');
  if (/Date\.now\(\)|Math\.random\(\)|new Date\(/.test(stripped)) {
    return { error: 'contains non-deterministic call (Date.now/Math.random/new Date)' };
  }
  return { error: null };
}

// ---------------------------------------------------------------------------
// Exported runner
// ---------------------------------------------------------------------------

/**
 * Runs EACP Wave 7 baseline harness self-checks.
 *
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root (templates/ lives here)
 * @returns {Promise<void>}
 */
export async function runEacpBaselineChecks({ ok, bad }, { KIT }) {
  console.log('Checking EACP Wave 7 baseline harness (card #176 / CDK-003)...');
  const econ        = 'templates/contextkit/tools/scripts/economics';
  const scenPath    = resolve(KIT, `${econ}/baseline-scenarios.mjs`);
  const harnessPath = resolve(KIT, `${econ}/baseline-harness.mjs`);
  const reportPath  = resolve(KIT, `${econ}/baseline-report.mjs`);

  // ── Import guard ─────────────────────────────────────────────────────────────
  let scenarios, harness, report;
  try { scenarios = await import(pathToFileURL(scenPath).href); ok('baseline-scenarios.mjs imports cleanly'); }
  catch (err) { bad(`baseline-scenarios.mjs import failed: ${err?.message ?? err}`); return; }
  try { harness = await import(pathToFileURL(harnessPath).href); ok('baseline-harness.mjs imports cleanly'); }
  catch (err) { bad(`baseline-harness.mjs import failed: ${err?.message ?? err}`); return; }
  try { report = await import(pathToFileURL(reportPath).href); ok('baseline-report.mjs imports cleanly'); }
  catch (err) { bad(`baseline-report.mjs import failed: ${err?.message ?? err}`); return; }

  // ── baseline-scenarios: constants ────────────────────────────────────────────
  const { BASELINE_SCENARIO_SCHEMA_VERSION, SCENARIO_KINDS, SCENARIOS,
          listScenarios, getScenario, validateScenario } = scenarios;

  BASELINE_SCENARIO_SCHEMA_VERSION === 'cdk-baseline-scenario/1'
    ? ok('scenarios: BASELINE_SCENARIO_SCHEMA_VERSION === "cdk-baseline-scenario/1"')
    : bad(`scenarios: schema version is "${BASELINE_SCENARIO_SCHEMA_VERSION}"`);

  Array.isArray(SCENARIO_KINDS) && SCENARIO_KINDS.length === 10
    ? ok('scenarios: SCENARIO_KINDS has exactly 10 kinds')
    : bad(`scenarios: SCENARIO_KINDS length is ${SCENARIO_KINDS?.length}, expected 10`);

  Array.isArray(SCENARIOS) && SCENARIOS.length >= 10
    ? ok(`scenarios: SCENARIOS.length=${SCENARIOS.length} ≥ 10`)
    : bad(`scenarios: SCENARIOS.length=${SCENARIOS?.length}, expected ≥10`);

  // Each SCENARIO_KIND must appear in at least one scenario.
  if (Array.isArray(SCENARIO_KINDS) && Array.isArray(SCENARIOS)) {
    const kinds = new Set(SCENARIOS.map((s) => s.kind));
    const missing = SCENARIO_KINDS.filter((k) => !kinds.has(k));
    missing.length === 0
      ? ok('scenarios: every SCENARIO_KIND appears in SCENARIOS')
      : bad(`scenarios: missing kinds in SCENARIOS: ${missing.join(', ')}`);
  }

  // ── baseline-scenarios: helpers ───────────────────────────────────────────────
  typeof listScenarios === 'function'
    ? ok('scenarios: listScenarios exported') : bad('scenarios: listScenarios missing');
  typeof getScenario === 'function'
    ? ok('scenarios: getScenario exported') : bad('scenarios: getScenario missing');
  typeof validateScenario === 'function'
    ? ok('scenarios: validateScenario exported') : bad('scenarios: validateScenario missing');

  // getScenario(unknown) → null
  getScenario('__does_not_exist__') === null
    ? ok('scenarios: getScenario("__does_not_exist__") → null')
    : bad('scenarios: getScenario unknown id should return null');

  // ── baseline-harness: constants + contract fns ────────────────────────────────
  const { BASELINE_SCHEMA_VERSION, EVENT_KINDS,
          buildBaselineSpec, recordBaseline, costPerCompletedTask,
          serializeBaseline, appendBaseline, readBaselines } = harness;

  BASELINE_SCHEMA_VERSION === 'cdk-baseline/1'
    ? ok('harness: BASELINE_SCHEMA_VERSION === "cdk-baseline/1"')
    : bad(`harness: BASELINE_SCHEMA_VERSION is "${BASELINE_SCHEMA_VERSION}"`);

  Array.isArray(EVENT_KINDS) && EVENT_KINDS.length > 0
    ? ok(`harness: EVENT_KINDS exported (${EVENT_KINDS.length} kinds)`)
    : bad('harness: EVENT_KINDS missing or empty');

  for (const fn of ['buildBaselineSpec', 'recordBaseline', 'costPerCompletedTask',
    'serializeBaseline', 'appendBaseline', 'readBaselines']) {
    typeof harness[fn] === 'function'
      ? ok(`harness: ${fn} exported`) : bad(`harness: ${fn} missing`);
  }

  // buildBaselineSpec on unknown id → skipped
  const unknownSpec = buildBaselineSpec('__not_a_real_scenario__');
  unknownSpec?.status === 'skipped'
    ? ok('harness: buildBaselineSpec(unknown id) → status "skipped"')
    : bad(`harness: unknown id should skip, got ${JSON.stringify(unknownSpec)}`);

  // recordBaseline with no events → skipped (no executor this wave)
  if (typeof buildBaselineSpec === 'function' && Array.isArray(SCENARIOS) && SCENARIOS.length > 0) {
    const validSpec = buildBaselineSpec(SCENARIOS[0].id);
    const noEventsRec = recordBaseline(validSpec, {});
    noEventsRec?.status === 'skipped'
      ? ok('harness: recordBaseline(spec, {}) — no events → status "skipped" (no executor)')
      : bad(`harness: no-events recordBaseline should skip, got ${JSON.stringify(noEventsRec)}`);

    // claim must be null on mock record
    const mockRec = recordBaseline(validSpec, {
      events: { tokens: 10, qaOutcome: 'pass', costUsd: 0.01 }, mock: true,
    });
    mockRec?.claim === null
      ? ok('harness: recordBaseline mock → claim null (ADR-0080 — targets ≠ claims)')
      : bad(`harness: mock record claim should be null, got ${JSON.stringify(mockRec?.claim)}`);
  }

  // costPerCompletedTask([]) → value null, claim null
  const cpt = costPerCompletedTask([]);
  cpt?.value === null && cpt?.claim === null
    ? ok('harness: costPerCompletedTask([]) → value null, claim null')
    : bad(`harness: costPerCompletedTask([]) wrong — ${JSON.stringify(cpt)}`);

  // ── baseline-report: constants + contract fns ─────────────────────────────────
  const { BASELINE_REPORT_SCHEMA_VERSION, baselineStatus, presentBaseline } = report;

  BASELINE_REPORT_SCHEMA_VERSION === 'cdk-baseline-report/1'
    ? ok('report: BASELINE_REPORT_SCHEMA_VERSION === "cdk-baseline-report/1"')
    : bad(`report: schema version is "${BASELINE_REPORT_SCHEMA_VERSION}"`);
  typeof baselineStatus === 'function'
    ? ok('report: baselineStatus exported') : bad('report: baselineStatus missing');
  typeof presentBaseline === 'function'
    ? ok('report: presentBaseline exported') : bad('report: presentBaseline missing');

  // baselineStatus on absent ledger → pending true, recorded 0, claim null
  const status = baselineStatus('/no/such/path/baseline-absent-test.jsonl');
  status?.pending === true && status?.recorded === 0 && status?.claim === null
    ? ok('report: baselineStatus(absent ledger) → pending true, recorded 0, claim null')
    : bad(`report: baselineStatus absent ledger wrong — ${JSON.stringify(status)}`);

  // ── File-size invariant (each ≤308 non-empty lines) ──────────────────────────
  const [scenLines, harnessLines, reportLines] = await Promise.all([
    lineCount(scenPath), lineCount(harnessPath), lineCount(reportPath),
  ]);
  scenLines <= 308
    ? ok(`size: baseline-scenarios.mjs ${scenLines} non-empty lines ≤308`)
    : bad(`size: baseline-scenarios.mjs has ${scenLines} lines (>308 — RED gate)`);
  harnessLines <= 308
    ? ok(`size: baseline-harness.mjs ${harnessLines} non-empty lines ≤308`)
    : bad(`size: baseline-harness.mjs has ${harnessLines} lines (>308 — RED gate)`);
  reportLines <= 308
    ? ok(`size: baseline-report.mjs ${reportLines} non-empty lines ≤308`)
    : bad(`size: baseline-report.mjs has ${reportLines} lines (>308 — RED gate)`);

  // ── Determinism invariant (no Date.now/Math.random/new Date) ─────────────────
  for (const [name, filePath] of [['baseline-scenarios.mjs', scenPath], ['baseline-harness.mjs', harnessPath], ['baseline-report.mjs', reportPath]]) {
    const det = await checkDeterministic(filePath);
    det.error ? bad(`determinism: ${name} ${det.error}`) : ok(`determinism: ${name} has no Date.now/Math.random/new Date calls`);
  }

  // ── Zero-dep invariant ────────────────────────────────────────────────────────
  let zeroDepsOk = true;
  for (const [name, filePath] of [['baseline-scenarios.mjs', scenPath], ['baseline-harness.mjs', harnessPath], ['baseline-report.mjs', reportPath]]) {
    const zd = await checkModuleZeroDep(filePath);
    if (zd.error) { bad(`zero-dep Wave 7: ${name} ${zd.error}`); zeroDepsOk = false; }
  }
  if (zeroDepsOk) ok('zero-dep invariant: all three Wave 7 modules import only node:/* or relative paths');
}
