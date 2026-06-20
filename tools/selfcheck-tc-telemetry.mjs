/**
 * Self-check — Task-Compiler packet-cost + escalation telemetry (WF0022 / ADR-0087).
 *
 * Verifies the telemetry surface exported by
 * `templates/contextkit/tools/scripts/economy/tc-telemetry.mjs`:
 *   1.  TC_TELEMETRY_SCHEMA_VERSION constant value.
 *   2.  recordPacketCost — valid record writes to tmp JSONL ledger.
 *   3.  recordPacketCost — missing taskId throws TypeError.
 *   4.  recordPacketCost — negative inputTokens throws RangeError.
 *   5.  recordPacketCost — non-boolean qaGreen throws TypeError.
 *   6.  recordEscalation — valid record writes to tmp JSONL ledger.
 *   7.  recordEscalation — missing fromTier throws TypeError.
 *   8.  readTelemetry — round-trip: written events are read back correctly.
 *   9.  readTelemetry — missing file returns [].
 *  10.  summarizeTelemetry — packet-cost count and cost aggregation.
 *  11.  summarizeTelemetry — escalation rate math correct.
 *  12.  summarizeTelemetry — avgCostPerQaGreenTask null when no qa-green events.
 *  13.  summarizeTelemetry — avgCostPerQaGreenTask computed correctly.
 *  14.  presentTelemetry — output contains key labels.
 *  15.  `// consumes:` declaration line exists in tc-telemetry.mjs.
 *  16.  Zero hot-path dep invariant (no non-node:/* or non-relative imports).
 *
 * ADR-0087. Zero runtime dependencies — node:* only.
 */
import { readFile, mkdir, rm } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { tmpdir }                from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Zero-dep checker (mirrors selfcheck-tc-packet.mjs)
// ---------------------------------------------------------------------------

/**
 * Checks that a module file imports only node:/* and relative paths.
 * @param {string} modPath
 * @returns {Promise<{error: string|null}>}
 */
async function checkModuleZeroDep(modPath) {
  let content = '';
  try { content = await readFile(modPath, 'utf-8'); } catch (err) {
    return { error: `could not read: ${err?.message ?? err}` };
  }
  const importRegex = /^import\s+(?:[^"'`]*\s+)?from\s+['"`]([^'"`]+)['"`]/gm;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const spec = match[1];
    if (!spec.startsWith('.') && !spec.startsWith('node:') && !spec.startsWith('../')) {
      return { error: `imports from "${spec}"` };
    }
  }
  return { error: null };
}

// ---------------------------------------------------------------------------
// Exported runner
// ---------------------------------------------------------------------------

/**
 * Runs Task-Compiler telemetry self-checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root
 */
export async function runTcTelemetryChecks({ ok, bad }, { KIT }) {
  console.log('Checking Task-Compiler telemetry (WF0022)...');

  const modPath = resolve(KIT, 'templates/contextkit/tools/scripts/economy/tc-telemetry.mjs');

  let lib;
  try {
    lib = await import(pathToFileURL(modPath).href);
    ok('tc-telemetry.mjs imports cleanly');
  } catch (err) {
    bad(`tc-telemetry.mjs import failed: ${err?.message ?? err}`);
    return;
  }

  const {
    TC_TELEMETRY_SCHEMA_VERSION,
    recordPacketCost,
    recordEscalation,
    readTelemetry,
    summarizeTelemetry,
    presentTelemetry,
  } = lib;

  // ── 1. Schema version constant ────────────────────────────────────────────
  TC_TELEMETRY_SCHEMA_VERSION === 'cdk-tc-telemetry/1'
    ? ok('schema version is "cdk-tc-telemetry/1"')
    : bad(`schema version wrong: ${TC_TELEMETRY_SCHEMA_VERSION}`);

  // ── Tmp dir setup ─────────────────────────────────────────────────────────
  const tmpDir = join(tmpdir(), `tc-telemetry-selfcheck-${process.pid}`);
  const ledger = join(tmpDir, 'tc-telemetry.jsonl');
  await mkdir(tmpDir, { recursive: true });

  try {
    // ── 2. recordPacketCost — valid record ──────────────────────────────────
    try {
      recordPacketCost({
        taskId: 'task-001', route: 'SONNET', model: 'claude-sonnet-4-6',
        inputTokens: 1000, outputTokens: 200,
        compileCost: 0.001, executionCost: 0.003, qaGreen: true,
        capturedAt: null,
      }, ledger);
      ok('recordPacketCost writes valid record without throwing');
    } catch (err) {
      bad(`recordPacketCost valid record threw: ${err?.message}`);
    }

    // ── 3. recordPacketCost — missing taskId throws TypeError ───────────────
    let threw3 = false;
    try { recordPacketCost({ route: 'SONNET', model: 'm', inputTokens: 0, outputTokens: 0, compileCost: 0, executionCost: 0, qaGreen: true }, ledger); }
    catch (err) { threw3 = err instanceof TypeError; }
    threw3
      ? ok('recordPacketCost throws TypeError on missing taskId')
      : bad('recordPacketCost should throw TypeError on missing taskId');

    // ── 4. recordPacketCost — negative inputTokens throws RangeError ────────
    let threw4 = false;
    try { recordPacketCost({ taskId: 't', route: 'SONNET', model: 'm', inputTokens: -1, outputTokens: 0, compileCost: 0, executionCost: 0, qaGreen: true }, ledger); }
    catch (err) { threw4 = err instanceof RangeError; }
    threw4
      ? ok('recordPacketCost throws RangeError on negative inputTokens')
      : bad('recordPacketCost should throw RangeError on negative inputTokens');

    // ── 5. recordPacketCost — non-boolean qaGreen throws TypeError ──────────
    let threw5 = false;
    try { recordPacketCost({ taskId: 't', route: 'SONNET', model: 'm', inputTokens: 0, outputTokens: 0, compileCost: 0, executionCost: 0, qaGreen: null }, ledger); }
    catch (err) { threw5 = err instanceof TypeError; }
    threw5
      ? ok('recordPacketCost throws TypeError on non-boolean qaGreen')
      : bad('recordPacketCost should throw TypeError on non-boolean qaGreen');

    // ── 6. recordEscalation — valid record ──────────────────────────────────
    try {
      recordEscalation({
        taskId: 'task-001', fromTier: 'scripts', toTier: 'haiku',
        trigger: 'syntax-error', retryCount: 1, capturedAt: null,
      }, ledger);
      ok('recordEscalation writes valid record without throwing');
    } catch (err) {
      bad(`recordEscalation valid record threw: ${err?.message}`);
    }

    // ── 7. recordEscalation — missing fromTier throws TypeError ─────────────
    let threw7 = false;
    try { recordEscalation({ taskId: 't', toTier: 'haiku', trigger: 'x', retryCount: 0 }, ledger); }
    catch (err) { threw7 = err instanceof TypeError; }
    threw7
      ? ok('recordEscalation throws TypeError on missing fromTier')
      : bad('recordEscalation should throw TypeError on missing fromTier');

    // ── 8. readTelemetry — round-trip ────────────────────────────────────────
    const readBack = readTelemetry(ledger);
    readBack.length === 2
      ? ok(`readTelemetry round-trip: got ${readBack.length} events`)
      : bad(`readTelemetry round-trip: expected 2 events, got ${readBack.length}`);

    readBack[0]?.eventKind === 'packet-cost' && readBack[0]?.taskId === 'task-001'
      ? ok('readTelemetry: first event is packet-cost for task-001')
      : bad(`readTelemetry: first event wrong: ${JSON.stringify(readBack[0])}`);

    readBack[1]?.eventKind === 'escalation' && readBack[1]?.fromTier === 'scripts'
      ? ok('readTelemetry: second event is escalation from scripts')
      : bad(`readTelemetry: second event wrong: ${JSON.stringify(readBack[1])}`);

    // ── 9. readTelemetry — missing file returns [] ───────────────────────────
    const missingRead = readTelemetry(join(tmpDir, 'nonexistent.jsonl'));
    Array.isArray(missingRead) && missingRead.length === 0
      ? ok('readTelemetry returns [] for missing file')
      : bad(`readTelemetry should return [] for missing file, got: ${JSON.stringify(missingRead)}`);

    // ── 10. summarizeTelemetry — packet-cost count and aggregation ───────────
    const summary = summarizeTelemetry(readBack);
    summary.packetCostCount === 1
      ? ok('summarizeTelemetry: packetCostCount === 1')
      : bad(`summarizeTelemetry: packetCostCount should be 1, got ${summary.packetCostCount}`);

    Math.abs(summary.totalCostUsd - 0.004) < 1e-9
      ? ok('summarizeTelemetry: totalCostUsd === 0.004')
      : bad(`summarizeTelemetry: totalCostUsd wrong: ${summary.totalCostUsd}`);

    // ── 11. summarizeTelemetry — escalation rate math ─────────────────────────
    summary.escalationRate === 1.0
      ? ok('summarizeTelemetry: escalationRate === 1.0')
      : bad(`summarizeTelemetry: escalationRate should be 1.0, got ${summary.escalationRate}`);

    // ── 12. summarizeTelemetry — avgCost null when no qa-green tasks ──────────
    const noGreen = summarizeTelemetry([
      { eventKind: 'packet-cost', taskId: 't', route: 'HAIKU', model: 'm',
        inputTokens: 100, outputTokens: 50, compileCost: 0, executionCost: 0.001,
        totalCost: 0.001, qaGreen: false, capturedAt: null },
    ]);
    noGreen.avgCostPerQaGreenTask === null
      ? ok('summarizeTelemetry: avgCostPerQaGreenTask null when no qa-green events')
      : bad(`summarizeTelemetry: avgCostPerQaGreenTask should be null, got ${noGreen.avgCostPerQaGreenTask}`);

    // ── 13. summarizeTelemetry — avgCostPerQaGreenTask computed correctly ────
    const twoGreen = summarizeTelemetry([
      { eventKind: 'packet-cost', taskId: 'a', route: 'R', model: 'm',
        inputTokens: 0, outputTokens: 0, compileCost: 0.002, executionCost: 0.002,
        totalCost: 0.004, qaGreen: true, capturedAt: null },
      { eventKind: 'packet-cost', taskId: 'b', route: 'R', model: 'm',
        inputTokens: 0, outputTokens: 0, compileCost: 0.001, executionCost: 0.001,
        totalCost: 0.002, qaGreen: true, capturedAt: null },
    ]);
    Math.abs(twoGreen.avgCostPerQaGreenTask - 0.003) < 1e-9
      ? ok('summarizeTelemetry: avgCostPerQaGreenTask === 0.003 (avg of 0.004 and 0.002)')
      : bad(`summarizeTelemetry: avgCostPerQaGreenTask wrong: ${twoGreen.avgCostPerQaGreenTask}`);

    // ── 14. presentTelemetry — output contains key labels ────────────────────
    const rendered = presentTelemetry(summary);
    const hasLabels = rendered.includes('cdk-tc-telemetry/1')
      && rendered.includes('packet-cost events')
      && rendered.includes('escalation rate')
      && rendered.includes('cost by route');
    hasLabels
      ? ok('presentTelemetry: output contains required labels')
      : bad(`presentTelemetry: missing labels in output:\n${rendered}`);

  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  // ── 15. `// consumes:` declaration line exists ────────────────────────────
  let modSrc = '';
  try { modSrc = await readFile(modPath, 'utf-8'); } catch { /* handled below */ }
  modSrc.includes('// consumes:')
    ? ok('tc-telemetry.mjs has a // consumes: declaration line')
    : bad('tc-telemetry.mjs is missing a // consumes: declaration line');

  // ── 16. Zero hot-path dep invariant ──────────────────────────────────────
  const depResult = await checkModuleZeroDep(modPath);
  depResult.error === null
    ? ok('zero-dep invariant: tc-telemetry.mjs imports only node:/* or relative paths')
    : bad(`zero-dep invariant: tc-telemetry.mjs ${depResult.error}`);
}

// ---------------------------------------------------------------------------
// Standalone guard — mirrors selfcheck-tc-packet.mjs pattern
// ---------------------------------------------------------------------------

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let failures = 0;
  const ok  = (_m) => {};
  const bad = (m) => { failures++; console.error(`FAIL: ${m}`); };
  const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  runTcTelemetryChecks({ ok, bad }, { KIT })
    .then(() => process.exit(failures ? 1 : 0))
    .catch((err) => { console.error('selfcheck-tc-telemetry: unexpected error:', err); process.exit(1); });
}
