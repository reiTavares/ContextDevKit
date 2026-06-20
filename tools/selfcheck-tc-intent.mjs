/**
 * Self-check — Task-Compiler intent scorer (WF0022 / ADR-0087..0090).
 *
 * Verifies the deterministic scorer surface exported by
 * `templates/contextkit/tools/scripts/economy/tc-intent.mjs`:
 *   1.  TC_INTENT_SCHEMA_VERSION constant value.
 *   2.  FLOOR_PATH_PATTERNS is a frozen array of strings.
 *   3.  isFloorPath — detects a security path.
 *   4.  isFloorPath — passes a safe path.
 *   5.  scoreIntent — band condition → escalate.
 *   6.  scoreIntent — floor path → escalate (non-narrowable).
 *   7.  scoreIntent — skipped signal → escalate.
 *   8.  scoreIntent — clean low-ambiguity closed input → narrow.
 *   9.  scoreIntent — schema-version field present in output.
 *  10.  scoreIntent — output is frozen (immutable).
 *  11.  scoreIntent — malformed input throws TypeError (fail-fast).
 *  12.  scoreIntent — missing title throws TypeError.
 *  13.  presentIntent — renders verdict and tier for a narrow result.
 *  14.  presentIntent — renders escalate for an escalated result.
 *  15.  // consumes: complexity-rubric comment present in source.
 *  16.  Zero hot-path dep invariant (node:/* + relative only).
 *
 * ADR-0087. Zero runtime dependencies — node:* only.
 */
import { readFile }                    from 'node:fs/promises';
import { resolve, dirname }            from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Exported runner
// ---------------------------------------------------------------------------

/**
 * Runs Task-Compiler intent scorer self-checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root
 */
export async function runTcIntentChecks({ ok, bad }, { KIT }) {
  console.log('Checking Task-Compiler intent scorer (WF0022)...');

  const modPath = resolve(KIT, 'templates/contextkit/tools/scripts/economy/tc-intent.mjs');

  let lib;
  try {
    lib = await import(pathToFileURL(modPath).href);
    ok('tc-intent.mjs imports cleanly');
  } catch (err) {
    bad(`tc-intent.mjs import failed: ${err?.message ?? err}`);
    return;
  }

  const {
    TC_INTENT_SCHEMA_VERSION,
    FLOOR_PATH_PATTERNS,
    isFloorPath,
    scoreIntent,
    presentIntent,
  } = lib;

  // ── 1. Schema version constant ────────────────────────────────────────────
  TC_INTENT_SCHEMA_VERSION === 'cdk-tc-intent/1'
    ? ok('schema version is "cdk-tc-intent/1"')
    : bad(`schema version wrong: ${TC_INTENT_SCHEMA_VERSION}`);

  // ── 2. FLOOR_PATH_PATTERNS is frozen and non-empty ────────────────────────
  const isArray   = Array.isArray(FLOOR_PATH_PATTERNS);
  const isFrozen  = isArray && Object.isFrozen(FLOOR_PATH_PATTERNS);
  const nonEmpty  = isArray && FLOOR_PATH_PATTERNS.length > 0;
  const allString = isArray && FLOOR_PATH_PATTERNS.every((p) => typeof p === 'string');

  (isArray && isFrozen && nonEmpty && allString)
    ? ok('FLOOR_PATH_PATTERNS is a frozen non-empty array of strings')
    : bad(`FLOOR_PATH_PATTERNS shape wrong: isArray=${isArray} frozen=${isFrozen} nonEmpty=${nonEmpty} allStr=${allString}`);

  // ── 3. isFloorPath — detects a security path ──────────────────────────────
  isFloorPath('src/auth/middleware.mjs') === true
    ? ok('isFloorPath detects "auth" in path')
    : bad('isFloorPath should return true for "src/auth/middleware.mjs"');

  isFloorPath('services/crypto/hash.mjs') === true
    ? ok('isFloorPath detects "crypto" in path')
    : bad('isFloorPath should return true for "services/crypto/hash.mjs"');

  // ── 4. isFloorPath — passes a safe path ───────────────────────────────────
  isFloorPath('src/utils/string-helpers.mjs') === false
    ? ok('isFloorPath returns false for a safe utility path')
    : bad('isFloorPath should return false for "src/utils/string-helpers.mjs"');

  // ── 5. scoreIntent — band condition → escalate ────────────────────────────
  const bandResult = scoreIntent({ title: 'fix' });
  bandResult.escalate === true && bandResult.result === 'escalate'
    ? ok('band input (very short title, no files) → escalate')
    : bad(`band input should escalate: ${JSON.stringify({ r: bandResult.result, esc: bandResult.escalate })}`);

  // ── 6. scoreIntent — floor path → escalate ────────────────────────────────
  const floorResult = scoreIntent({
    title:   'update auth middleware to validate JWT expiry',
    files:   ['src/auth/jwt-validator.mjs', 'src/auth/middleware.mjs'],
    signals: { explicit: 'refactor' },
  });
  floorResult.escalate === true && floorResult.result === 'escalate'
    ? ok('floor-path input → escalate (non-narrowable)')
    : bad(`floor-path input should escalate: ${JSON.stringify({ r: floorResult.result, esc: floorResult.escalate })}`);

  // ── 7. scoreIntent — skipped signal → escalate ────────────────────────────
  const skippedResult = scoreIntent({ title: 'skipped' });
  skippedResult.escalate === true && skippedResult.result === 'escalate'
    ? ok('skipped title → escalate')
    : bad(`skipped input should escalate: result=${skippedResult.result}`);

  const skippedFilesResult = scoreIntent({
    title: 'add helper function for sorting',
    files: ['skipped'],
  });
  skippedFilesResult.escalate === true
    ? ok('skipped files array → escalate')
    : bad(`skipped files should escalate: result=${skippedFilesResult.result}`);

  // ── 8. scoreIntent — clean low-ambiguity closed input → narrow ────────────
  const narrowResult = scoreIntent({
    title:   'add pagination feature to the list endpoint',
    files:   ['src/api/list-endpoint.mjs', 'src/utils/paginate.mjs'],
    signals: { epic: 'FEAT-42', estimate: 'S' },
  });
  narrowResult.result === 'narrow' && narrowResult.escalate === false
    ? ok('clean bounded input → narrow decision')
    : bad(
        `clean input should narrow: result=${narrowResult.result} escalate=${narrowResult.escalate} ` +
        `confidence=${narrowResult.confidence?.toFixed(2)} reasons=${JSON.stringify(narrowResult.reasons)}`,
      );

  // ── 9. Schema-version field present in output ─────────────────────────────
  narrowResult.schemaVersion === 'cdk-tc-intent/1'
    ? ok('scoreIntent output carries schemaVersion')
    : bad(`scoreIntent output missing schemaVersion: ${narrowResult.schemaVersion}`);

  // ── 10. Output is frozen (immutable) ──────────────────────────────────────
  let mutationThrew = false;
  try {
    // @ts-ignore — intentional mutation test
    narrowResult.result = 'tampered';
  } catch {
    mutationThrew = true;
  }
  (mutationThrew || narrowResult.result === 'narrow')
    ? ok('scoreIntent output is frozen — mutation rejected')
    : bad('scoreIntent output is NOT frozen — mutation succeeded');

  // ── 11. Malformed input (null) → TypeError ────────────────────────────────
  let nullThrew = false;
  try { scoreIntent(null); } catch (err) { nullThrew = err instanceof TypeError; }
  nullThrew
    ? ok('scoreIntent(null) throws TypeError (fail-fast)')
    : bad('scoreIntent(null) should throw TypeError');

  // ── 12. Missing title → TypeError ─────────────────────────────────────────
  let noTitleThrew = false;
  try { scoreIntent({ files: ['src/foo.mjs'] }); } catch (err) { noTitleThrew = err instanceof TypeError; }
  noTitleThrew
    ? ok('scoreIntent with no title throws TypeError')
    : bad('scoreIntent with no title should throw TypeError');

  // ── 13. presentIntent — renders verdict and tier for a narrow result ───────
  const narrowStr = presentIntent(narrowResult);
  const narrowOk  = narrowStr.includes('NARROW') && narrowStr.includes(narrowResult.tier);
  narrowOk
    ? ok('presentIntent renders NARROW verdict and tier')
    : bad(`presentIntent narrow output missing fields:\n${narrowStr}`);

  // ── 14. presentIntent — renders escalate for an escalated result ───────────
  const escalateStr = presentIntent(floorResult);
  escalateStr.includes('ESCALATE')
    ? ok('presentIntent renders ESCALATE verdict')
    : bad(`presentIntent escalate output wrong:\n${escalateStr}`);

  // ── 15. // consumes: complexity-rubric comment present in source ───────────
  let srcContent = '';
  try { srcContent = await readFile(modPath, 'utf-8'); } catch (err) {
    bad(`could not read tc-intent.mjs source: ${err?.message ?? err}`);
  }
  srcContent.includes('// consumes: complexity-rubric')
    ? ok('source contains "// consumes: complexity-rubric" declaration')
    : bad('source missing "// consumes: complexity-rubric" declaration');

  // ── 16. Zero hot-path dep invariant ──────────────────────────────────────
  const importRegex = /^import\s+(?:[^"'`]*\s+)?from\s+['"`]([^'"`]+)['"`]/gm;
  let depViolation = null;
  let match;
  while ((match = importRegex.exec(srcContent)) !== null) {
    const spec = match[1];
    if (!spec.startsWith('.') && !spec.startsWith('node:')) { depViolation = spec; break; }
  }
  depViolation === null
    ? ok('zero-dep invariant: tc-intent.mjs imports only node:/* or relative paths')
    : bad(`zero-dep invariant: tc-intent.mjs imports from "${depViolation}"`);
}

// ---------------------------------------------------------------------------
// Standalone guard — mirrors selfcheck-tc-packet.mjs pattern
// ---------------------------------------------------------------------------

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let failures = 0;
  const ok  = (_m) => {};
  const bad = (m) => { failures++; console.error(`FAIL: ${m}`); };
  const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  runTcIntentChecks({ ok, bad }, { KIT })
    .then(() => process.exit(failures ? 1 : 0))
    .catch((err) => { console.error('selfcheck-tc-intent: unexpected error:', err); process.exit(1); });
}
