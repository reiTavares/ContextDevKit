/**
 * Self-check — Economy Savings Ledger (CDK-266, economy-savings.mjs).
 *
 * Asserts the savings ledger module is internally sound:
 * - ECONOMY_SAVINGS_SCHEMA_VERSION matches expected string.
 * - LEVERS has exactly 4 entries (all four lever names).
 * - recordSaving with valid input returns a frozen record (no `claim` key).
 * - Frozen record has correct schemaVersion, lever, savedTokens, capturedAt=null.
 * - recordSaving with opts.now = 1234567890 → capturedAt = 1234567890.
 * - recordSaving with negative savedTokens → skipped marker.
 * - recordSaving with NaN savedTokens → skipped marker.
 * - recordSaving with unknown lever → skipped marker.
 * - appendSaving + readSavings round-trip in os.tmpdir() fixture (2 records).
 * - readSavings on missing file → [].
 * - appendSaving throws when given a skipped marker.
 * - savingsSummary sums byLever correctly + totalSaved + distinct sessions.
 * - presentSavings output contains 'observed' and marks a dormant lever.
 * - presentSavings on zeroed summary → contains 'none observed yet'.
 * - Zero-dep invariant: economy-savings.mjs imports only node:* or relative paths.
 *
 * Mirrors the structure of selfcheck-eacp-routing.mjs exactly.
 *
 * Cohesion note (constitution §1, +10% tolerance): one cohesive assertion suite
 * for a single module — splitting ok()/bad() across files would be premature
 * abstraction with no second consumer. Kept under the 308-line cap.
 *
 * Zero runtime dependencies — node:* only.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @private — matches checkModuleZeroDep from other selfcheck-eacp-* files. */
async function checkModuleZeroDep(modPath) {
  let content = '';
  try {
    content = await readFile(modPath, 'utf-8');
  } catch (err) {
    return { error: `could not read: ${err?.message ?? err}` };
  }
  const importRegex = /^import\s+(?:[^"'`]*\s+)?from\s+['"`]([^'"`]+)['"`]/gm;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const spec = match[1];
    if (!spec.startsWith('.') && !spec.startsWith('node:')) {
      return { error: `imports from "${spec}"` };
    }
  }
  return { error: null };
}

/**
 * Runs Economy Savings Ledger checks.
 * @param {{ ok: (m: string) => void, bad: (m: string, err?: unknown) => void }} reporter
 * @param {{ KIT: string }} ctx - path to templates/contextkit
 */
export async function runEconomySavingsChecks({ ok, bad }, { KIT }) {
  console.log('Checking Economy Savings Ledger (CDK-266, economy-savings.mjs)...');
  const savingsPath = resolve(KIT, 'templates/contextkit/tools/scripts/economy/economy-savings.mjs');

  let lib;
  try {
    lib = await import(pathToFileURL(savingsPath).href);
    ok('economy-savings.mjs imports cleanly');
  } catch (err) {
    bad(`economy-savings.mjs import failed: ${err?.message ?? err}`);
    return;
  }

  const {
    ECONOMY_SAVINGS_SCHEMA_VERSION,
    LEVERS,
    recordSaving,
    appendSaving,
    readSavings,
    savingsSummary,
    presentSavings,
  } = lib;

  // ── 1. Schema version constant ────────────────────────────────────────────
  ECONOMY_SAVINGS_SCHEMA_VERSION === 'cdk-economy-savings/1'
    ? ok('ECONOMY_SAVINGS_SCHEMA_VERSION === "cdk-economy-savings/1"')
    : bad(`ECONOMY_SAVINGS_SCHEMA_VERSION is "${ECONOMY_SAVINGS_SCHEMA_VERSION}"`);

  // ── 2. LEVERS — exactly 4 entries ────────────────────────────────────────
  Array.isArray(LEVERS) &&
  LEVERS.length === 4 &&
  LEVERS.includes('boot-delta') &&
  LEVERS.includes('run-compact') &&
  LEVERS.includes('project-map') &&
  LEVERS.includes('routing')
    ? ok('LEVERS has exactly 4 entries (boot-delta, run-compact, project-map, routing)')
    : bad(`LEVERS shape wrong: ${JSON.stringify(LEVERS)}`);

  // ── 3. recordSaving valid input → frozen record, no `claim` key ──────────
  const rec1 = recordSaving({ lever: 'boot-delta', savedTokens: 120, sessionId: 'ses-1' });
  const isFrozen = Object.isFrozen(rec1);
  const hasClaim = Object.prototype.hasOwnProperty.call(rec1, 'claim');
  const isSkip   = rec1?.status === 'skipped';
  isFrozen && !hasClaim && !isSkip
    ? ok('recordSaving: valid input → frozen record without a `claim` key')
    : bad(`recordSaving: frozen=${isFrozen} hasClaim=${hasClaim} skipped=${isSkip} — ${JSON.stringify(rec1)}`);

  // ── 4. Correct schemaVersion, lever, savedTokens; capturedAt=null (no opts.now) ──
  rec1.schemaVersion === 'cdk-economy-savings/1' &&
  rec1.lever === 'boot-delta' &&
  rec1.savedTokens === 120 &&
  rec1.capturedAt === null
    ? ok('recordSaving: schemaVersion/lever/savedTokens correct; capturedAt=null when no opts.now')
    : bad(`recordSaving: field values wrong — ${JSON.stringify(rec1)}`);

  // ── 5. opts.now injected → capturedAt = opts.now ─────────────────────────
  const rec2 = recordSaving({ lever: 'run-compact', savedTokens: 50 }, { now: 1234567890 });
  rec2.capturedAt === 1234567890
    ? ok('recordSaving: opts.now = 1234567890 → capturedAt = 1234567890')
    : bad(`recordSaving: capturedAt should be 1234567890, got ${rec2.capturedAt}`);

  // ── 6. Negative savedTokens → skipped marker ─────────────────────────────
  const negRec = recordSaving({ lever: 'routing', savedTokens: -1 });
  negRec?.status === 'skipped'
    ? ok('recordSaving: negative savedTokens → skipped marker')
    : bad(`recordSaving: negative tokens should skip, got ${JSON.stringify(negRec)}`);

  // ── 7. NaN savedTokens → skipped marker ──────────────────────────────────
  const nanRec = recordSaving({ lever: 'project-map', savedTokens: NaN });
  nanRec?.status === 'skipped'
    ? ok('recordSaving: NaN savedTokens → skipped marker')
    : bad(`recordSaving: NaN tokens should skip, got ${JSON.stringify(nanRec)}`);

  // ── 8. Unknown lever → skipped marker ────────────────────────────────────
  const badLever = recordSaving({ lever: 'nonexistent', savedTokens: 10 });
  badLever?.status === 'skipped'
    ? ok('recordSaving: unknown lever → skipped marker')
    : bad(`recordSaving: bad lever should skip, got ${JSON.stringify(badLever)}`);

  // ── 9. appendSaving + readSavings round-trip ──────────────────────────────
  let tmpDir;
  try {
    tmpDir = mkdtempSync(join(tmpdir(), 'cdk-sav-'));
    const savFile = join(tmpDir, 'savings.jsonl');
    const r1 = recordSaving({ lever: 'boot-delta',   savedTokens: 100, sessionId: 'ses-A' });
    const r2 = recordSaving({ lever: 'run-compact',  savedTokens: 200, sessionId: 'ses-B' });
    await appendSaving(r1, savFile);
    await appendSaving(r2, savFile);
    const read = await readSavings(savFile);
    read.length === 2 &&
    read[0].lever === 'boot-delta' &&
    read[1].lever === 'run-compact'
      ? ok('appendSaving + readSavings: 2 records written and read back correctly')
      : bad(`round-trip failed: read ${read.length} records — ${JSON.stringify(read)}`);
    rmSync(tmpDir, { recursive: true, force: true });
  } catch (err) {
    bad(`appendSaving/readSavings round-trip threw: ${err?.message ?? err}`);
    if (tmpDir) { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ } }
  }

  // ── 10. readSavings on missing file → [] ─────────────────────────────────
  const missing = await readSavings(join(tmpdir(), 'no-such-savings-file.jsonl'));
  Array.isArray(missing) && missing.length === 0
    ? ok('readSavings: missing file → []')
    : bad(`readSavings: missing file should return [], got ${JSON.stringify(missing)}`);

  // ── 11. appendSaving throws on a skipped marker ───────────────────────────
  let appendThrew = false;
  try {
    await appendSaving({ status: 'skipped', reason: 'test' }, join(tmpdir(), 'nope-sav.jsonl'));
  } catch { appendThrew = true; }
  appendThrew
    ? ok('appendSaving: throws TypeError when given a skipped marker')
    : bad('appendSaving: must throw when given a skipped marker');

  // ── 12. savingsSummary: byLever sums, totalSaved, distinct sessions ───────
  const records = [
    recordSaving({ lever: 'boot-delta',  savedTokens: 300, sessionId: 'ses-X' }),
    recordSaving({ lever: 'boot-delta',  savedTokens: 100, sessionId: 'ses-X' }),
    recordSaving({ lever: 'run-compact', savedTokens: 500, sessionId: 'ses-Y' }),
  ];
  const summary = savingsSummary(records);
  summary.byLever['boot-delta']  === 400 &&
  summary.byLever['run-compact'] === 500 &&
  summary.byLever['project-map'] === 0   &&
  summary.byLever['routing']     === 0   &&
  summary.totalSaved === 900             &&
  summary.sessions   === 2              &&
  summary.entries    === 3
    ? ok('savingsSummary: byLever sums, totalSaved=900, sessions=2, entries=3')
    : bad(`savingsSummary: values wrong — ${JSON.stringify(summary)}`);

  // ── 13. presentSavings: 'observed' in output + dormant lever marked ───────
  const presented = presentSavings(summary);
  typeof presented === 'string' &&
  presented.includes('observed')    &&
  presented.includes('dormant')
    ? ok('presentSavings: output contains "observed" and marks a dormant lever with "dormant"')
    : bad(`presentSavings: missing "observed" or "dormant" — got: ${presented.slice(0, 300)}`);

  // ── 14. presentSavings on zeroed summary → contains 'none observed yet' ───
  const zeroSummary = savingsSummary([]);
  const zeroPresented = presentSavings(zeroSummary);
  typeof zeroPresented === 'string' && zeroPresented.includes('none observed yet')
    ? ok('presentSavings: zeroed summary → contains "none observed yet"')
    : bad(`presentSavings: zero path should contain "none observed yet", got: ${zeroPresented}`);

  // ── 15. Zero-dep invariant ────────────────────────────────────────────────
  const zdResult = await checkModuleZeroDep(savingsPath);
  if (zdResult.error) {
    bad(`zero-dep invariant: economy-savings.mjs ${zdResult.error}`);
  } else {
    ok('zero-dep invariant: economy-savings.mjs imports only node:/* or relative paths');
  }
}
