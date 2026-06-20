/**
 * Self-check — Session Autonomy Receipt estimator (workstream 1).
 *
 * Asserts the honesty contract of session-autonomy-estimator.mjs +
 * estimator-confidence.mjs against the FROZEN kernel they assemble over:
 *  - a go/bug-fix sessionProfile matches wf0018-compozy-c2 → claimType
 *    'estimated' with a finite multiplier ≈ baseline/observed (NEVER 'measured');
 *  - a js/feature profile yields 'insufficient-evidence' with NO multiplier;
 *  - missing usage → insufficient-evidence + NO_USAGE_TELEMETRY;
 *  - a valid direct A/B baseline yields 'measured';
 *  - estimated is never relabeled measured (#1);
 *  - the 1.3983× pilot is never emitted as a constant (only via the scoped
 *    profile, applied to the session's observed tokens).
 *
 * Cohesion note (constitution §1): one cohesive assertion suite for one feature;
 * splitting ok()/bad() here would be premature abstraction.
 * Zero runtime dependencies — node:* only.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @private — local zero-dep auditor (imports must be node:/* or relative). */
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

const ECON = 'templates/contextkit/tools/scripts/economics';
const GO_BUGFIX_PROFILE = { language: 'go', taskType: 'bug-fix', repoSizeLoc: 217000 };
const JS_FEATURE_PROFILE = { language: 'js', taskType: 'feature', repoSizeLoc: 5000 };

/**
 * Runs the Session Autonomy Receipt estimator self-checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root
 */
export async function runSessionAutonomyEstimatorChecks({ ok, bad }, { KIT }) {
  console.log('Checking Session Autonomy Receipt estimator (workstream 1)...');
  const estPath  = resolve(KIT, `${ECON}/session-autonomy/session-autonomy-estimator.mjs`);
  const confPath = resolve(KIT, `${ECON}/session-autonomy/estimator-confidence.mjs`);

  let estLib, confLib;
  try { estLib = await import(pathToFileURL(estPath).href); ok('session-autonomy-estimator.mjs imports cleanly'); }
  catch (err) { bad(`session-autonomy-estimator.mjs import failed: ${err?.message ?? err}`); return; }
  try { confLib = await import(pathToFileURL(confPath).href); ok('estimator-confidence.mjs imports cleanly'); }
  catch (err) { bad(`estimator-confidence.mjs import failed: ${err?.message ?? err}`); return; }

  const { SESSION_AUTONOMY_ESTIMATOR_VERSION, estimateSessionAutonomy } = estLib;
  const { resolveClaimType, resolveConfidence } = confLib;

  SESSION_AUTONOMY_ESTIMATOR_VERSION === '1.0.0'
    ? ok('estimator: SESSION_AUTONOMY_ESTIMATOR_VERSION === "1.0.0"')
    : bad(`estimator: version is "${SESSION_AUTONOMY_ESTIMATOR_VERSION}"`);

  typeof resolveClaimType === 'function' && typeof resolveConfidence === 'function'
    ? ok('confidence: resolveClaimType + resolveConfidence exported')
    : bad('confidence: missing resolveClaimType/resolveConfidence export');

  // ── estimated path: go/bug-fix matches wf0018-compozy-c2 ──────────────────
  const observed = 100000;
  const estimated = estimateSessionAutonomy({
    observedUsage: { observedTokens: observed },
    acceptance: { accepted: 8 },
    sessionProfile: GO_BUGFIX_PROFILE,
  });
  estimated.claimType === 'estimated'
    ? ok('estimated: go/bug-fix profile → claimType "estimated"')
    : bad(`estimated: claimType is "${estimated.claimType}" (expected estimated)`);
  estimated.estimator.calibrationId === 'wf0018-compozy-c2'
    ? ok('estimated: calibrationId === "wf0018-compozy-c2"')
    : bad(`estimated: calibrationId is "${estimated.estimator.calibrationId}"`);
  const mult = estimated.usage.tokenEfficiencyMultiplier;
  (typeof mult === 'number' && Number.isFinite(mult) && Math.abs(mult - 1.3983) < 1e-6)
    ? ok('estimated: tokenEfficiencyMultiplier ≈ baseline/observed (1.3983×, scoped)')
    : bad(`estimated: multiplier is ${mult} (expected ≈1.3983)`);
  Math.abs(estimated.usage.estimatedBaselineTokens - observed * 1.3983) < 1e-3
    ? ok('estimated: estimatedBaselineTokens = observed × scoped ratio (not a constant)')
    : bad(`estimated: estimatedBaselineTokens is ${estimated.usage.estimatedBaselineTokens}`);
  estimated.claimType !== 'measured'
    ? ok('estimated: NEVER relabeled "measured" (#1)')
    : bad('estimated: was relabeled measured — invariant #1 violated');
  Object.isFrozen(estimated) && Object.isFrozen(estimated.usage) && Object.isFrozen(estimated.autonomy)
    ? ok('estimated: result + usage + autonomy blocks are frozen')
    : bad('estimated: result blocks not frozen');

  // ── insufficient: js/feature profile, no calibration match ────────────────
  const noMatch = estimateSessionAutonomy({
    observedUsage: { observedTokens: observed },
    sessionProfile: JS_FEATURE_PROFILE,
  });
  noMatch.claimType === 'insufficient-evidence'
    ? ok('insufficient: js/feature profile → "insufficient-evidence"')
    : bad(`insufficient: claimType is "${noMatch.claimType}"`);
  noMatch.usage.tokenEfficiencyMultiplier === null && noMatch.autonomy.multiplier === null
    ? ok('insufficient: NO multiplier fabricated (all numbers null)')
    : bad('insufficient: a number was fabricated without evidence (#24 violated)');
  noMatch.confidence.reasons.includes('insufficient-calibrated-evidence')
    ? ok('insufficient: machine-readable reason "insufficient-calibrated-evidence" present')
    : bad(`insufficient: reason missing, got ${JSON.stringify(noMatch.confidence.reasons)}`);

  // ── missing usage → NO_USAGE_TELEMETRY ────────────────────────────────────
  const noUsage = estimateSessionAutonomy({ sessionProfile: GO_BUGFIX_PROFILE });
  noUsage.claimType === 'insufficient-evidence'
    && noUsage.confidence.reasons.includes('no-usage-telemetry')
    ? ok('no-usage: missing usage → insufficient-evidence + NO_USAGE_TELEMETRY')
    : bad(`no-usage: got "${noUsage.claimType}" / ${JSON.stringify(noUsage.confidence.reasons)}`);
  noUsage.usage.observedTokens === null
    ? ok('no-usage: observedTokens stays null (never 0)')
    : bad(`no-usage: observedTokens is ${noUsage.usage.observedTokens} (must be null)`);

  // ── measured: a valid direct A/B baseline ─────────────────────────────────
  const measured = estimateSessionAutonomy({
    observedUsage: { observedTokens: observed },
    acceptance: { accepted: 8 },
    directBaseline: {
      baselineTokens: 140000, sameTask: true, sameAcceptance: true, isolated: true,
    },
  });
  measured.claimType === 'measured'
    ? ok('measured: valid direct A/B baseline → claimType "measured"')
    : bad(`measured: claimType is "${measured.claimType}" (expected measured)`);
  (typeof measured.autonomy.multiplier === 'number' && Number.isFinite(measured.autonomy.multiplier))
    ? ok('measured: autonomy.multiplier is finite')
    : bad(`measured: multiplier is ${measured.autonomy.multiplier}`);
  measured.estimator.calibrationId === null
    ? ok('measured: calibrationId null (direct A/B, not a profile)')
    : bad(`measured: calibrationId is "${measured.estimator.calibrationId}"`);

  // ── direct baseline that is NOT isolated must NOT mint measured ────────────
  const fakeDirect = estimateSessionAutonomy({
    observedUsage: { observedTokens: observed },
    directBaseline: { baselineTokens: 140000, sameTask: true, sameAcceptance: true, isolated: false },
    sessionProfile: JS_FEATURE_PROFILE,
  });
  fakeDirect.claimType !== 'measured'
    ? ok('guard: a non-isolated baseline never mints "measured"')
    : bad('guard: a non-isolated baseline was accepted as measured');

  // ── resolveConfidence policy spot-checks ──────────────────────────────────
  resolveConfidence({ hasDirectBaseline: true, telemetryCompleteness: 1, qaGreen: true, interventions: 0 })
    .level === 'high'
    ? ok('confidence: direct A/B + complete + non-inferiority → high')
    : bad('confidence: high tier policy wrong');
  resolveConfidence({ calibrationMatch: true, telemetryCompleteness: 1, qaGreen: true })
    .level === 'medium'
    ? ok('confidence: matched profile + complete telemetry + QA-green → medium')
    : bad('confidence: medium tier policy wrong');
  resolveConfidence({}).level === 'insufficient'
    ? ok('confidence: no evidence → insufficient')
    : bad('confidence: empty input must be insufficient');

  // ── zero-dep invariant on both shipped modules ────────────────────────────
  let zeroDepsOk = true;
  for (const path of [estPath, confPath]) {
    const result = await checkModuleZeroDep(path);
    if (result.error) { bad(`zero-dep: ${path} ${result.error}`); zeroDepsOk = false; }
  }
  if (zeroDepsOk) ok('zero-dep invariant: both estimator modules import only node:/* or relative paths');
}

// ── Standalone runner ───────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('selfcheck-session-autonomy-estimator.mjs')) {
  let failures = 0;
  const ok = (m) => console.log(`  OK   ${m}`);
  const bad = (m) => { failures++; console.error(`  BAD  ${m}`); };
  const KIT = resolve(process.argv[1], '..', '..');
  runSessionAutonomyEstimatorChecks({ ok, bad }, { KIT })
    .then(() => {
      console.log(failures === 0
        ? '\nAll-OK — Session Autonomy Receipt estimator checks passed.'
        : `\n${failures} check(s) FAILED.`);
      process.exit(failures ? 1 : 0);
    })
    .catch((err) => { console.error(`Runner threw: ${err?.stack ?? err}`); process.exit(1); });
}
