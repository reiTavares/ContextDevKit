/**
 * Self-check — EACP Wave 8 quota-store persistence layer (WF0018 / #240).
 *
 * Surface 5 continuation: quota-store.mjs was split from quota-snapshots.mjs
 * for the 308-line budget. This suite covers the persistence contract:
 *   - appendSnapshot idempotent (same fingerprint not duplicated on retry).
 *   - appendSnapshot calls assertNoTranscriptContent (rejects a record with
 *     transcript-content fields — ADR-0081).
 *   - Linkage fields (source/sessionId/runId/taskId) round-trip from
 *     buildSnapshot through appendSnapshot+readSnapshots.
 *   - claude-code host: adapter declares quotaAvailable=false (must not
 *     capture as method='api' through a quota endpoint that does not exist).
 *
 * Placed in its own file because selfcheck-eacp-autonomy.mjs is at 269 lines
 * and adding the idempotent + transcript tests would breach the 308-line cap.
 *
 * Zero runtime dependencies — node:* only.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Runs EACP Wave 8 quota-store persistence checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root
 */
export async function runEacpQuotaStoreChecks({ ok, bad }, { KIT }) {
  console.log('Checking EACP Wave 8 quota-store persistence (WF0018 / #240)...');
  const econ = 'templates/contextkit/tools/scripts/economics';
  const quotaPath   = resolve(KIT, `${econ}/quota-snapshots.mjs`);
  const storePath   = resolve(KIT, `${econ}/quota-store.mjs`);
  const adapterPath = resolve(KIT, `${econ}/adapters/claude-code.mjs`);

  let quotaLib, storeLib, adapterLib;
  try {
    quotaLib   = await import(pathToFileURL(quotaPath).href);
    ok('quota-snapshots.mjs imports cleanly (quota-store suite)');
  } catch (err) { bad(`quota-snapshots.mjs import failed: ${err?.message ?? err}`); return; }
  try {
    storeLib   = await import(pathToFileURL(storePath).href);
    ok('quota-store.mjs imports cleanly');
  } catch (err) { bad(`quota-store.mjs import failed: ${err?.message ?? err}`); return; }
  try {
    adapterLib = await import(pathToFileURL(adapterPath).href);
    ok('claude-code adapter imports cleanly (quota-store suite)');
  } catch (err) { bad(`claude-code adapter import failed: ${err?.message ?? err}`); return; }

  const { buildSnapshot } = quotaLib;
  const { appendSnapshot, readSnapshots } = storeLib;
  const { ADAPTER, declares } = adapterLib;

  // ── Idempotent retry ──────────────────────────────────────────────────────
  let tmpDir;
  try {
    tmpDir = mkdtempSync(join(tmpdir(), 'eacp-qs-'));
    const idemFile = join(tmpDir, 'idem.jsonl');
    const recIdem = buildSnapshot({ host: 'idem-h', remainingPct: 50, captureMethod: 'manual' });
    appendSnapshot(recIdem, idemFile);
    appendSnapshot(recIdem, idemFile); // retry — must be no-op
    const idemCount = readSnapshots(idemFile).length;
    idemCount === 1
      ? ok('quota-store: appendSnapshot idempotent (same fingerprint not duplicated on retry)')
      : bad(`quota-store: idempotent test failed — expected 1 record, got ${idemCount}`);
    rmSync(tmpDir, { recursive: true, force: true });
  } catch (err) {
    bad(`quota-store: idempotent test threw: ${err?.message ?? err}`);
    if (tmpDir) { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ } }
  }

  // ── Transcript content rejection (ADR-0081) ───────────────────────────────
  let contentRejected = false;
  try {
    const cleanRec = buildSnapshot({ host: 'tr-h', remainingPct: 30, captureMethod: 'manual' });
    // Spread frozen record + inject forbidden field; appendSnapshot must reject.
    appendSnapshot({ ...cleanRec, content: 'transcript text' }, join(tmpdir(), 'nope-qs.jsonl'));
  } catch { contentRejected = true; }
  contentRejected
    ? ok('quota-store: appendSnapshot rejects record with transcript content (ADR-0081)')
    : bad('quota-store: appendSnapshot must reject a record carrying transcript content');

  // ── Linkage fields round-trip ─────────────────────────────────────────────
  let tmpDir2;
  try {
    tmpDir2 = mkdtempSync(join(tmpdir(), 'eacp-link-'));
    const linkFile = join(tmpDir2, 'link.jsonl');
    const linked = buildSnapshot({
      host: 'lh', remainingPct: 70, captureMethod: 'manual',
      sessionId: 'ses-42', runId: 'run-7', taskId: 'tsk-3', source: 'cli',
    });
    appendSnapshot(linked, linkFile);
    const [read] = readSnapshots(linkFile);
    read.sessionId === 'ses-42' && read.runId === 'run-7' &&
    read.taskId === 'tsk-3' && read.source === 'cli'
      ? ok('quota-store: linkage fields (sessionId/runId/taskId/source) round-trip through append+read')
      : bad(`quota-store: linkage fields wrong after round-trip: ${JSON.stringify(read)}`);
    rmSync(tmpDir2, { recursive: true, force: true });
  } catch (err) {
    bad(`quota-store: linkage round-trip threw: ${err?.message ?? err}`);
    if (tmpDir2) { try { rmSync(tmpDir2, { recursive: true, force: true }); } catch { /* best-effort */ } }
  }

  // ── claude-code host must NOT use 'api' capture (no quota endpoint) ───────
  declares().quotaAvailable === false
    ? ok('quota-store: claude-code declares quotaAvailable=false (must use manual, not api)')
    : bad('quota-store: claude-code adapter quotaAvailable should be false');
  ADAPTER === 'claude-code'
    ? ok('quota-store: ADAPTER === "claude-code" (host string, not "api")')
    : bad(`quota-store: ADAPTER should be "claude-code", got "${ADAPTER}"`);

  // ── Zero-dep: quota-store.mjs ─────────────────────────────────────────────
  let storeContent = '';
  try { storeContent = await readFile(storePath, 'utf-8'); }
  catch (err) { bad(`quota-store: zero-dep read failed: ${err?.message ?? err}`); return; }
  const importRegex = /^import\s+(?:[^"'`]*\s+)?from\s+['"`]([^'"`]+)['"`]/gm;
  let match; let zeroDep = true;
  while ((match = importRegex.exec(storeContent)) !== null) {
    const spec = match[1];
    if (!spec.startsWith('.') && !spec.startsWith('node:')) {
      bad(`zero-dep Wave 8: quota-store.mjs imports from "${spec}"`); zeroDep = false;
    }
  }
  if (zeroDep) ok('zero-dep invariant: quota-store.mjs imports only node:/* or relative paths');
}
