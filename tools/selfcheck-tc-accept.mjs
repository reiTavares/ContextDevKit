/**
 * Self-check — Task-Compiler acceptance gate (WF0022 / ADR-0090 §C).
 *
 * Verifies the acceptance gate surface exported by
 * `templates/contextkit/tools/scripts/economy/tc-accept.mjs`:
 *   1.  TC_ACCEPT_SCHEMA_VERSION === 'cdk-tc-accept/1'.
 *   2.  '// consumes: economy/tc-validate' annotation present in source.
 *   3.  Zero hot-path dep invariant (node:/* and relative paths only).
 *   4.  prose result → acceptResult returns accepted:false (prose rejected).
 *   5.  malformed envelope → acceptResult returns accepted:false.
 *   6.  injectFullSuiteGate — adds gate criterion when absent.
 *   7.  injectFullSuiteGate — leaves criteria unchanged when already present.
 *   8.  evaluateAcceptance — skipped objective criterion → accepted:false.
 *   9.  evaluateAcceptance — all passing criteria → accepted:true.
 *  10.  evaluateAcceptance — unknown kind → throws TypeError.
 *  11.  evaluateAcceptance — non-array input → throws TypeError.
 *  12.  acceptResult — affected-green + full-suite-red → NOT accepted.
 *  13.  acceptResult — affected-green + full-suite-green → accepted:true.
 *  14.  acceptResult — escalation trigger → escalate:true, NOT accepted.
 *  15.  acceptResult — clean result, all criteria pass, full suite green → ACCEPTED.
 *  16.  presentAcceptance — ACCEPTED verdict string contains 'ACCEPTED'.
 *  17.  presentAcceptance — NEEDS-WORK verdict contains 'NEEDS-WORK'.
 *  18.  presentAcceptance — null input → safe string (no throw).
 *
 * ADR-0090. Zero runtime dependencies — node:* only.
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
 * Builds a minimal valid WorkerOutputEnvelope for test scenarios.
 * @param {Function} emptyEnvelopeFn
 * @returns {object}
 */
function buildValidEnvelope(emptyEnvelopeFn) {
  const env = emptyEnvelopeFn('ok');
  env.verification = { command: 'node test.mjs', exitCode: 0 };
  env.artifact     = 'result';
  return env;
}

/**
 * Builds a minimal flat criteria list with all criteria observed as 'pass'.
 * @returns {{ criteria: Array<object>, observed: object }}
 */
function buildPassingCriteriaAndObserved() {
  const criteria = [
    { kind: 'exitCode', label: 'verify-exit', expected: 0, objective: true },
  ];
  const observed = {
    'verify-exit': { exitCode: 0 },
    suiteExitCode: 0,
  };
  return { criteria, observed };
}

// ---------------------------------------------------------------------------
// Exported runner
// ---------------------------------------------------------------------------

/**
 * Runs Task-Compiler acceptance gate self-checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root
 */
export async function runTcAcceptChecks({ ok, bad }, { KIT }) {
  console.log('Checking Task-Compiler acceptance gate (tc-accept)...');

  const modPath = resolve(
    KIT, 'templates/contextkit/tools/scripts/economy/tc-accept.mjs'
  );

  let lib;
  try {
    lib = await import(pathToFileURL(modPath).href);
    ok('tc-accept.mjs imports cleanly');
  } catch (err) {
    bad(`tc-accept.mjs import failed: ${err?.message ?? err}`);
    return;
  }

  const {
    TC_ACCEPT_SCHEMA_VERSION,
    evaluateAcceptance,
    injectFullSuiteGate,
    acceptResult,
    presentAcceptance,
  } = lib;

  // Import emptyEnvelope from tc-validate for building test envelopes.
  const validatePath = resolve(
    KIT, 'templates/contextkit/tools/scripts/economy/tc-validate.mjs'
  );
  let validateLib;
  try {
    validateLib = await import(pathToFileURL(validatePath).href);
  } catch (err) {
    bad(`tc-validate.mjs import failed (needed for helpers): ${err?.message ?? err}`);
    return;
  }
  const { emptyEnvelope } = validateLib;

  // ── 1. Schema version constant ────────────────────────────────────────────
  TC_ACCEPT_SCHEMA_VERSION === 'cdk-tc-accept/1'
    ? ok('TC_ACCEPT_SCHEMA_VERSION is "cdk-tc-accept/1"')
    : bad(`TC_ACCEPT_SCHEMA_VERSION wrong: ${TC_ACCEPT_SCHEMA_VERSION}`);

  // ── 2. '// consumes:' annotation present in source ───────────────────────
  const source = await readFile(modPath, 'utf-8');
  source.includes('// consumes: economy/tc-validate')
    ? ok('source: "// consumes: economy/tc-validate" annotation present')
    : bad('source: missing "// consumes: economy/tc-validate" annotation');

  // ── 3. Zero hot-path dep invariant ───────────────────────────────────────
  const depCheck = await checkZeroDep(modPath);
  depCheck.error === null
    ? ok('zero-dep invariant: tc-accept.mjs imports only node:/* or relative paths')
    : bad(`zero-dep invariant: tc-accept.mjs ${depCheck.error}`);

  // ── 4. prose result → rejected ───────────────────────────────────────────
  const proseVerdict = acceptResult(null, 'here is my prose answer', {});
  proseVerdict.accepted === false
    ? ok('acceptResult: prose result → accepted:false')
    : bad(`acceptResult prose: expected accepted:false, got ${JSON.stringify(proseVerdict)}`);

  // ── 5. malformed envelope → rejected ─────────────────────────────────────
  const malformedVerdict = acceptResult(null, { bogus: true }, {});
  malformedVerdict.accepted === false
    ? ok('acceptResult: malformed envelope → accepted:false')
    : bad(`acceptResult malformed: expected accepted:false, got ${JSON.stringify(malformedVerdict)}`);

  // ── 6. injectFullSuiteGate — adds gate when absent ───────────────────────
  const emptyCriteria  = [];
  const injectedResult = injectFullSuiteGate(emptyCriteria);
  const hasGate = injectedResult.some((c) => c?.label === 'full-suite-at-gate');
  hasGate
    ? ok('injectFullSuiteGate: adds full-suite-at-gate when absent')
    : bad('injectFullSuiteGate: did not add full-suite-at-gate criterion');

  // ── 7. injectFullSuiteGate — unchanged when gate already present ──────────
  const withGate    = [{ kind: 'exitCode', label: 'full-suite-at-gate', expected: 0, objective: true }];
  const doubleInject = injectFullSuiteGate(withGate);
  const gateCount   = doubleInject.filter((c) => c?.label === 'full-suite-at-gate').length;
  gateCount === 1
    ? ok('injectFullSuiteGate: leaves criteria unchanged when gate already present')
    : bad(`injectFullSuiteGate: expected 1 gate criterion, got ${gateCount}`);

  // ── 8. evaluateAcceptance — skipped objective criterion → NOT accepted ────
  const skippedCriteria = [
    // file_exists with no observation → skipped
    { kind: 'file_exists', label: 'check-file', objective: true },
  ];
  const skippedEval = evaluateAcceptance(skippedCriteria, {});
  skippedEval.accepted === false
    ? ok('evaluateAcceptance: skipped objective criterion → accepted:false')
    : bad(`evaluateAcceptance skipped: expected accepted:false, got ${JSON.stringify(skippedEval)}`);

  // ── 9. evaluateAcceptance — all passing → accepted:true ──────────────────
  const passCriteria = [
    { kind: 'exitCode', label: 'suite', expected: 0, objective: true },
  ];
  const passObserved = { suite: { exitCode: 0 } };
  const passEval     = evaluateAcceptance(passCriteria, passObserved);
  passEval.accepted === true
    ? ok('evaluateAcceptance: all passing criteria → accepted:true')
    : bad(`evaluateAcceptance pass: expected accepted:true, got ${JSON.stringify(passEval)}`);

  // ── 10. evaluateAcceptance — unknown kind → throws TypeError ──────────────
  let unknownKindThrew = false;
  try {
    evaluateAcceptance([{ kind: 'unsupported_kind', label: 'bad', objective: true }], {});
  } catch (err) {
    unknownKindThrew = err instanceof TypeError;
  }
  unknownKindThrew
    ? ok('evaluateAcceptance: unknown kind throws TypeError')
    : bad('evaluateAcceptance: expected TypeError on unknown kind, did not throw');

  // ── 11. evaluateAcceptance — non-array input → throws TypeError ───────────
  let nonArrayThrew = false;
  try {
    evaluateAcceptance('not-an-array', {});
  } catch (err) {
    nonArrayThrew = err instanceof TypeError;
  }
  nonArrayThrew
    ? ok('evaluateAcceptance: non-array input throws TypeError')
    : bad('evaluateAcceptance: expected TypeError on non-array, did not throw');

  // ── 12. affected-green + full-suite-red → NOT accepted ───────────────────
  const validEnv12   = buildValidEnvelope(emptyEnvelope);
  const { criteria: c12, observed: obs12 } = buildPassingCriteriaAndObserved();
  const obs12bad = { ...obs12, affectedGreen: true, suiteExitCode: 1 };
  const verdict12 = acceptResult(null, validEnv12, { ...obs12bad, criteria: c12 });
  verdict12.accepted === false
    ? ok('acceptResult: affected-green + full-suite-red → NOT accepted')
    : bad(`acceptResult affected/suite: expected accepted:false, got ${JSON.stringify(verdict12)}`);

  // ── 13. affected-green + full-suite-green → ACCEPTED ─────────────────────
  const validEnv13   = buildValidEnvelope(emptyEnvelope);
  const { criteria: c13, observed: obs13 } = buildPassingCriteriaAndObserved();
  const obs13good = { ...obs13, affectedGreen: true, suiteExitCode: 0 };
  const verdict13 = acceptResult(null, validEnv13, { ...obs13good, criteria: c13 });
  verdict13.accepted === true
    ? ok('acceptResult: affected-green + full-suite-green → ACCEPTED')
    : bad(`acceptResult affected+suite green: expected accepted:true, got ${JSON.stringify(verdict13)}`);

  // ── 14. escalation trigger → escalate:true, NOT accepted ─────────────────
  const validEnv14   = buildValidEnvelope(emptyEnvelope);
  const { criteria: c14, observed: obs14 } = buildPassingCriteriaAndObserved();
  const obs14esc = { ...obs14, securityOrPiiFindings: true, criteria: c14 };
  const verdict14 = acceptResult(null, validEnv14, obs14esc);
  (verdict14.escalate === true && verdict14.accepted === false)
    ? ok('acceptResult: escalation trigger → escalate:true, NOT accepted')
    : bad(`acceptResult escalation: expected escalate:true+accepted:false, got ${JSON.stringify(verdict14)}`);

  // ── 15. clean result, all criteria pass, full suite green → ACCEPTED ──────
  const validEnv15   = buildValidEnvelope(emptyEnvelope);
  const { criteria: c15, observed: obs15 } = buildPassingCriteriaAndObserved();
  const obs15clean = { ...obs15, criteria: c15 };
  const verdict15  = acceptResult(null, validEnv15, obs15clean);
  verdict15.accepted === true
    ? ok('acceptResult: clean result, all criteria pass, full suite green → ACCEPTED')
    : bad(`acceptResult clean: expected accepted:true, got ${JSON.stringify(verdict15)}`);

  // ── 16. presentAcceptance — ACCEPTED verdict contains 'ACCEPTED' ──────────
  const presentAccepted = presentAcceptance(verdict15);
  presentAccepted.includes('ACCEPTED')
    ? ok('presentAcceptance: ACCEPTED verdict string contains "ACCEPTED"')
    : bad(`presentAcceptance ACCEPTED: "${presentAccepted}"`);

  // ── 17. presentAcceptance — NEEDS-WORK verdict contains 'NEEDS-WORK' ──────
  const presentNeeds = presentAcceptance(verdict12);
  presentNeeds.includes('NEEDS-WORK')
    ? ok('presentAcceptance: NEEDS-WORK verdict contains "NEEDS-WORK"')
    : bad(`presentAcceptance NEEDS-WORK: "${presentNeeds}"`);

  // ── 18. presentAcceptance — null input → safe string (no throw) ───────────
  let safeStr = '';
  let presentThrew = false;
  try {
    safeStr = presentAcceptance(null);
  } catch {
    presentThrew = true;
  }
  (!presentThrew && typeof safeStr === 'string' && safeStr.length > 0)
    ? ok('presentAcceptance: null input → safe non-empty string (no throw)')
    : bad(`presentAcceptance null: threw=${presentThrew}, output="${safeStr}"`);
}

// ---------------------------------------------------------------------------
// Standalone guard — mirrors selfcheck-tc-validate.mjs pattern
// ---------------------------------------------------------------------------

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let failures = 0;
  const ok  = (_m) => {};
  const bad = (m) => { failures++; console.error(`FAIL: ${m}`); };
  const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  runTcAcceptChecks({ ok, bad }, { KIT })
    .then(() => process.exit(failures ? 1 : 0))
    .catch((err) => { console.error('selfcheck-tc-accept: unexpected error:', err); process.exit(1); });
}
