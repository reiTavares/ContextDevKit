/**
 * Self-check — Task-Compiler result validator (WF0022 / ADR-0087..0090).
 *
 * Verifies the validator surface exported by
 * `templates/contextkit/tools/scripts/economy/tc-validate.mjs`:
 *   1. TC_VALIDATE_SCHEMA_VERSION constant value.
 *   2. validateResult — prose string → valid:false, rejectedAsProse:true.
 *   3. validateResult — null → valid:false, rejectedAsProse:true.
 *   4. validateResult — array → valid:false, rejectedAsProse:true.
 *   5. validateResult — malformed object → valid:false, reasons non-empty.
 *   6. validateResult — well-formed envelope → valid:true, envelope populated.
 *   7. validateResult — reasons are empty on valid envelope.
 *   8. reobserveClaims — no fsCheck → unverified claims (pure, no I/O).
 *   9. reobserveClaims — empty changed → no claims.
 *  10. reobserveClaims — advisoryOnly is always true.
 *  11. presentValidation — prose-rejected string mentions 'prose'.
 *  12. presentValidation — valid envelope string contains VALID.
 *  13. presentValidation — invalid envelope string lists reasons.
 *  14. TC_VALIDATE_SCHEMA_VERSION comment present in source.
 *  15. '// consumes:' annotation present in source.
 *  16. Zero hot-path dep invariant (no non-node:/* or non-relative imports).
 *
 * ADR-0087. Zero runtime dependencies — node:* only.
 */
import { readFile }                    from 'node:fs/promises';
import { resolve, dirname }            from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Checks that a module file imports only node:/* and relative paths.
 * @param {string} modPath
 * @returns {Promise<{ error: string | null }>}
 */
async function checkZeroDep(modPath) {
  let content = '';
  try { content = await readFile(modPath, 'utf-8'); } catch (err) {
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
 * Builds a minimal valid WorkerOutputEnvelope using emptyEnvelope so the
 * test does not hardcode the shape (evolution-safe).
 * @param {Function} emptyEnvelopeFn
 * @returns {object}
 */
function buildValidEnvelope(emptyEnvelopeFn) {
  const env = emptyEnvelopeFn('ok');
  env.verification = { command: 'node test.mjs', exitCode: 0 };
  env.artifact     = 'result';
  return env;
}

// ---------------------------------------------------------------------------
// Exported runner
// ---------------------------------------------------------------------------

/**
 * Runs Task-Compiler result validator self-checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root
 */
export async function runTcValidateChecks({ ok, bad }, { KIT }) {
  console.log('Checking Task-Compiler result validator (tc-validate)...');

  const modPath = resolve(KIT, 'templates/contextkit/tools/scripts/economy/tc-validate.mjs');

  let lib;
  try {
    lib = await import(pathToFileURL(modPath).href);
    ok('tc-validate.mjs imports cleanly');
  } catch (err) {
    bad(`tc-validate.mjs import failed: ${err?.message ?? err}`);
    return;
  }

  const {
    TC_VALIDATE_SCHEMA_VERSION,
    validateResult,
    reobserveClaims,
    presentValidation,
    emptyEnvelope,
  } = lib;

  // ── 1. Schema version constant ────────────────────────────────────────────
  TC_VALIDATE_SCHEMA_VERSION === 'cdk-tc-validate/1'
    ? ok('TC_VALIDATE_SCHEMA_VERSION is "cdk-tc-validate/1"')
    : bad(`TC_VALIDATE_SCHEMA_VERSION wrong: ${TC_VALIDATE_SCHEMA_VERSION}`);

  // ── 2. prose string → rejected ───────────────────────────────────────────
  const proseResult = validateResult('here is my answer in prose form');
  proseResult.valid === false && proseResult.rejectedAsProse === true
    ? ok('validateResult: prose string → valid:false, rejectedAsProse:true')
    : bad(`validateResult prose: ${JSON.stringify(proseResult)}`);

  // ── 3. null → rejected ───────────────────────────────────────────────────
  const nullResult = validateResult(null);
  nullResult.valid === false && nullResult.rejectedAsProse === true
    ? ok('validateResult: null → valid:false, rejectedAsProse:true')
    : bad(`validateResult null: ${JSON.stringify(nullResult)}`);

  // ── 4. array → rejected ──────────────────────────────────────────────────
  const arrayResult = validateResult([{ version: 1 }]);
  arrayResult.valid === false && arrayResult.rejectedAsProse === true
    ? ok('validateResult: array → valid:false, rejectedAsProse:true')
    : bad(`validateResult array: ${JSON.stringify(arrayResult)}`);

  // ── 5. malformed object → valid:false with reasons ───────────────────────
  const malformedResult = validateResult({ bogus: true });
  malformedResult.valid === false && Array.isArray(malformedResult.reasons) && malformedResult.reasons.length > 0
    ? ok('validateResult: malformed object → valid:false with reasons')
    : bad(`validateResult malformed: ${JSON.stringify(malformedResult)}`);

  // ── 6. well-formed envelope → valid:true ─────────────────────────────────
  const wellFormed  = buildValidEnvelope(emptyEnvelope);
  const goodResult  = validateResult(wellFormed);
  goodResult.valid === true && goodResult.envelope !== null
    ? ok('validateResult: well-formed envelope → valid:true, envelope populated')
    : bad(`validateResult well-formed: ${JSON.stringify(goodResult)}`);

  // ── 7. reasons empty on valid envelope ───────────────────────────────────
  goodResult.reasons.length === 0
    ? ok('validateResult: reasons array is empty for a valid envelope')
    : bad(`validateResult valid envelope has non-empty reasons: ${JSON.stringify(goodResult.reasons)}`);

  // ── 8. reobserveClaims — no fsCheck → unverified ─────────────────────────
  const envWithChange = buildValidEnvelope(emptyEnvelope);
  envWithChange.changed = [{ path: 'src/foo.mjs', why: 'fix' }];
  const claimsResult = reobserveClaims(envWithChange);
  claimsResult.unverified.length === 1 && claimsResult.observable[0]?.status === 'unverified'
    ? ok('reobserveClaims: without fsCheck, changed files are unverified (pure)')
    : bad(`reobserveClaims no-fsCheck: ${JSON.stringify(claimsResult)}`);

  // ── 9. reobserveClaims — empty changed → no claims ───────────────────────
  const envEmpty    = buildValidEnvelope(emptyEnvelope);
  const emptyClaims = reobserveClaims(envEmpty);
  emptyClaims.observable.length === 0 && emptyClaims.unverified.length === 0
    ? ok('reobserveClaims: empty changed → no observable claims')
    : bad(`reobserveClaims empty: ${JSON.stringify(emptyClaims)}`);

  // ── 10. advisoryOnly is always true ──────────────────────────────────────
  emptyClaims.advisoryOnly === true && claimsResult.advisoryOnly === true
    ? ok('reobserveClaims: advisoryOnly is always true')
    : bad(`reobserveClaims advisoryOnly: empty=${emptyClaims.advisoryOnly} claims=${claimsResult.advisoryOnly}`);

  // ── 11. presentValidation — prose rejection mentions prose ────────────────
  const prosePresent = presentValidation(proseResult);
  prosePresent.includes('prose') || prosePresent.includes('INVALID')
    ? ok('presentValidation: prose-rejected result mentions rejection')
    : bad(`presentValidation prose: "${prosePresent}"`);

  // ── 12. presentValidation — valid envelope says VALID ────────────────────
  const validPresent = presentValidation(goodResult);
  validPresent.includes('VALID')
    ? ok('presentValidation: valid envelope string contains "VALID"')
    : bad(`presentValidation valid: "${validPresent}"`);

  // ── 13. presentValidation — invalid lists reasons ─────────────────────────
  const invalidPresent = presentValidation(malformedResult);
  invalidPresent.includes('INVALID') && invalidPresent.includes('reasons')
    ? ok('presentValidation: invalid envelope string lists reasons')
    : bad(`presentValidation invalid: "${invalidPresent}"`);

  // ── 14. TC_VALIDATE_SCHEMA_VERSION comment present in source ─────────────
  const source = await readFile(modPath, 'utf-8');
  source.includes("TC_VALIDATE_SCHEMA_VERSION = 'cdk-tc-validate/1'")
    ? ok('source: TC_VALIDATE_SCHEMA_VERSION constant is present')
    : bad('source: TC_VALIDATE_SCHEMA_VERSION constant not found');

  // ── 15. '// consumes:' annotation present ────────────────────────────────
  source.includes('// consumes: economy/output-contract')
    ? ok('source: "// consumes: economy/output-contract" annotation present')
    : bad('source: missing "// consumes:" annotation');

  // ── 16. Zero hot-path dep invariant ──────────────────────────────────────
  const depCheck = await checkZeroDep(modPath);
  depCheck.error === null
    ? ok('zero-dep invariant: tc-validate.mjs imports only node:/* or relative paths')
    : bad(`zero-dep invariant: tc-validate.mjs ${depCheck.error}`);
}

// ---------------------------------------------------------------------------
// Standalone guard — mirrors selfcheck-tc-packet.mjs pattern
// ---------------------------------------------------------------------------

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let failures = 0;
  const ok  = (_m) => {};
  const bad = (m) => { failures++; console.error(`FAIL: ${m}`); };
  const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  runTcValidateChecks({ ok, bad }, { KIT })
    .then(() => process.exit(failures ? 1 : 0))
    .catch((err) => { console.error('selfcheck-tc-validate: unexpected error:', err); process.exit(1); });
}
