/**
 * Self-check — economy-dispatch.mjs (WF0020 dispatch-plan helper).
 *
 * Asserts the dispatch-plan builder and presenter are internally sound:
 *   1.  buildDispatchPlan() returns contextProfile === 'subagent'
 *   2.  buildDispatchPlan() returns useRunCompact === true
 *   3.  buildDispatchPlan() returns loopBreak as an object
 *   4.  buildDispatchPlan() returns advisory === true
 *   5.  disabled path: cfg {economy:{enabled:false}} → disabled:true, no extra keys
 *   6.  schema version constant equals 'cdk-dispatch-plan/1'
 *   7.  presentDispatchPlan mentions 'run-compact' in the output string
 *   8.  presentDispatchPlan on disabled plan still mentions 'run-compact'
 *   9.  zero-dep invariant: economy-dispatch.mjs imports only node:* or relative paths
 *
 * Mirrors the structure of selfcheck-eacp-pressure.mjs and selfcheck-eacp-budget.mjs.
 *
 * Cohesion note (constitution §1, +10% tolerance): one cohesive assertion
 * suite for a single module — splitting ok()/bad() across files would be
 * premature abstraction with no second consumer. Kept well under the 308 cap.
 *
 * Zero runtime dependencies — node:* only (relative import of the module under test).
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Internal helper: zero-dep scanner (matches pattern in selfcheck-eacp-pressure.mjs)
// ---------------------------------------------------------------------------

/**
 * Scan a module file for non-relative, non-node: imports.
 * @param {string} name  — display name
 * @param {string} modPath — absolute path to the module
 * @returns {Promise<{ error: string|null }>}
 */
async function checkModuleZeroDep(name, modPath) {
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

// ---------------------------------------------------------------------------
// Exported check runner
// ---------------------------------------------------------------------------

/**
 * Runs economy-dispatch.mjs self-checks.
 *
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root (absolute path)
 * @returns {Promise<void>}
 */
export async function runEconomyDispatchChecks({ ok, bad }, { KIT }) {
  console.log('Checking economy-dispatch.mjs (WF0020 dispatch-plan helper)...');

  const modPath = resolve(KIT, 'templates/contextkit/tools/scripts/economy/economy-dispatch.mjs');

  // Attempt to import the module under test.
  let lib;
  try {
    lib = await import(pathToFileURL(modPath).href);
    ok('economy-dispatch.mjs imports cleanly');
  } catch (err) {
    bad(`economy-dispatch.mjs import failed: ${err?.message ?? err}`);
    return; // Cannot assert anything without the module.
  }

  const { buildDispatchPlan, presentDispatchPlan, DISPATCH_PLAN_SCHEMA_VERSION } = lib;

  // ── 6. Schema version constant ────────────────────────────────────────────

  DISPATCH_PLAN_SCHEMA_VERSION === 'cdk-dispatch-plan/1'
    ? ok('DISPATCH_PLAN_SCHEMA_VERSION === "cdk-dispatch-plan/1"')
    : bad(`DISPATCH_PLAN_SCHEMA_VERSION is "${DISPATCH_PLAN_SCHEMA_VERSION}" (expected "cdk-dispatch-plan/1")`);

  // ── buildDispatchPlan default plan ───────────────────────────────────────

  let plan;
  try {
    plan = await buildDispatchPlan();
  } catch (err) {
    bad(`buildDispatchPlan() threw unexpectedly: ${err?.message ?? err}`);
    plan = null;
  }

  if (!plan) {
    bad('buildDispatchPlan() returned a falsy value — cannot continue plan assertions');
  } else {
    // 1. contextProfile === 'subagent'
    plan.contextProfile === 'subagent'
      ? ok('buildDispatchPlan(): contextProfile === "subagent"')
      : bad(`buildDispatchPlan(): contextProfile is "${plan.contextProfile}" (expected "subagent")`);

    // 2. useRunCompact === true
    plan.useRunCompact === true
      ? ok('buildDispatchPlan(): useRunCompact === true')
      : bad(`buildDispatchPlan(): useRunCompact is ${plan.useRunCompact} (expected true)`);

    // 3. loopBreak is an object
    plan.loopBreak !== null && typeof plan.loopBreak === 'object'
      ? ok('buildDispatchPlan(): loopBreak is a non-null object')
      : bad(`buildDispatchPlan(): loopBreak is ${JSON.stringify(plan.loopBreak)} (expected object)`);

    // 4. advisory === true
    plan.advisory === true
      ? ok('buildDispatchPlan(): advisory === true')
      : bad(`buildDispatchPlan(): advisory is ${plan.advisory} (expected true)`);

    // Verify plan is frozen (Object.isFrozen)
    Object.isFrozen(plan)
      ? ok('buildDispatchPlan(): returned plan is frozen')
      : bad('buildDispatchPlan(): returned plan is NOT frozen (should be Object.freeze())');
  }

  // ── 5. Disabled path ─────────────────────────────────────────────────────

  let disabledPlan;
  try {
    disabledPlan = await buildDispatchPlan({}, { economy: { enabled: false } });
  } catch (err) {
    bad(`buildDispatchPlan({economy:{enabled:false}}) threw: ${err?.message ?? err}`);
    disabledPlan = null;
  }

  if (!disabledPlan) {
    bad('buildDispatchPlan with disabled economy returned falsy — cannot assert disabled path');
  } else {
    disabledPlan.disabled === true
      ? ok('disabled path: {economy:{enabled:false}} → disabled:true')
      : bad(`disabled path: disabled is ${disabledPlan.disabled} (expected true)`);

    disabledPlan.schemaVersion === DISPATCH_PLAN_SCHEMA_VERSION
      ? ok('disabled path: schemaVersion is still present and correct')
      : bad(`disabled path: schemaVersion is "${disabledPlan.schemaVersion}" (expected "${DISPATCH_PLAN_SCHEMA_VERSION}")`);

    !('contextProfile' in disabledPlan)
      ? ok('disabled path: no contextProfile key on disabled plan')
      : bad('disabled path: unexpected contextProfile key on disabled plan');

    Object.isFrozen(disabledPlan)
      ? ok('disabled path: disabled plan is frozen')
      : bad('disabled path: disabled plan is NOT frozen');
  }

  // ── 7. presentDispatchPlan mentions run-compact (normal plan) ────────────

  if (plan) {
    let presented;
    try {
      presented = presentDispatchPlan(plan);
    } catch (err) {
      bad(`presentDispatchPlan(plan) threw: ${err?.message ?? err}`);
      presented = null;
    }

    if (presented !== null) {
      typeof presented === 'string' && presented.includes('run-compact')
        ? ok('presentDispatchPlan(plan): output string mentions "run-compact"')
        : bad(`presentDispatchPlan(plan): output does not mention "run-compact" — got: ${String(presented).slice(0, 120)}`);
    }
  }

  // ── 8. presentDispatchPlan on disabled plan still mentions run-compact ───

  if (disabledPlan) {
    let presentedDisabled;
    try {
      presentedDisabled = presentDispatchPlan(disabledPlan);
    } catch (err) {
      bad(`presentDispatchPlan(disabledPlan) threw: ${err?.message ?? err}`);
      presentedDisabled = null;
    }

    if (presentedDisabled !== null) {
      typeof presentedDisabled === 'string' && presentedDisabled.includes('run-compact')
        ? ok('presentDispatchPlan(disabled): output still mentions "run-compact"')
        : bad(`presentDispatchPlan(disabled): missing "run-compact" — got: ${String(presentedDisabled).slice(0, 120)}`);
    }
  }

  // ── 9. Zero-dep invariant ─────────────────────────────────────────────────

  const zeroDepResult = await checkModuleZeroDep('economy-dispatch.mjs', modPath);
  zeroDepResult.error === null
    ? ok('zero-dep invariant: economy-dispatch.mjs imports only node:* or relative paths')
    : bad(`zero-dep invariant: economy-dispatch.mjs ${zeroDepResult.error}`);
}
