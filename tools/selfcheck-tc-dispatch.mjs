#!/usr/bin/env node
/**
 * Self-check — Task-Compiler ephemeral dispatch (TC-16 / WF0022 / ADR-0083).
 *
 * Verifies tc-dispatch.mjs + tc-dispatch-core.mjs:
 *  1.  Module imports cleanly.
 *  2.  TC_DISPATCH_SCHEMA_VERSION === 'cdk-tc-dispatch/1'.
 *  3.  probeHostCapability: pure — identical on two consecutive calls.
 *  4.  probeHostCapability: result is frozen.
 *  5.  probeHostCapability: returns { capable, reason, execPath } shape.
 *  6.  probeHostCapability: TC_DISPATCH_DISABLE=1 → capable:false.
 *  7.  probeHostCapability: CLAUDE_CODE_TOOL_CALL set → capable:false.
 *  8.  planDispatch: throws DispatchValidationError on null unit.
 *  9.  planDispatch: throws DispatchValidationError on invalid plain object.
 * 10.  planDispatch: dry-run default → dryRun===true (no spawn).
 * 11.  planDispatch: mode is 'ephemeral' or 'in-session' (explicit, never absent).
 * 12.  planDispatch: TC_DISPATCH_DISABLE → mode='in-session' with explicit reason.
 * 13.  planDispatch: returned plan is frozen.
 * 14.  planDispatch: accepts recipe unit (id + version + steps).
 * 15.  planDispatch: accepts work-packet unit (schemaVersion=cdk-work-packet/*).
 * 16.  planDispatch: plan.advisory === true.
 * 17.  executeDispatch: throws DispatchValidationError when plan.dryRun===true.
 * 18.  executeDispatch: in-session recipe path returns ADR-0083 envelope.
 * 19.  executeDispatch: envelope has all required ADR-0083 keys.
 * 20.  executeDispatch: dispatchMode==='in-session' on fallback.
 * 21.  presentDispatchPlan: output contains mode and reason.
 * 22.  Zero hot-path dep: tc-dispatch.mjs imports only node:/* or relative.
 * 23.  Zero hot-path dep: tc-dispatch-core.mjs imports only node:/* or relative.
 *
 * Coverage of mandatory abc assertions:
 *   (a) Probe is side-effect-free: checks 3 + 4 (pure + frozen).
 *   (b) Fallback is explicit when capability absent: checks 12 + 20.
 *   (c) Dry-run default produces a plan and does NOT spawn: checks 10 + 17.
 *
 * Standalone: `node tools/selfcheck-tc-dispatch.mjs` → exit 0 all-pass.
 * Library: import { runTcDispatchChecks } from './selfcheck-tc-dispatch.mjs'
 */
import { readFile }                     from 'node:fs/promises';
import { resolve, dirname }             from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const KIT_DEFAULT = resolve(__dirname, '..');

/** @param {string} p @returns {Promise<{error:string|null}>} */
async function checkZeroDep(p) {
  let src = '';
  try { src = await readFile(p, 'utf-8'); } catch (e) { return { error: `read: ${e?.message}` }; }
  const re = /^import\s+(?:[^"'`]*\s+)?from\s+['"`]([^'"`]+)['"`]/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (!m[1].startsWith('.') && !m[1].startsWith('node:')) return { error: `imports "${m[1]}"` };
  }
  return { error: null };
}

const RECIPE = { id: 'dispatch-test/1', version: '1.0.0', entry: 's1',
  steps: [{ id: 's1', kind: 'noop' }] };

const PACKET = Object.freeze({
  schemaVersion: 'cdk-work-packet/1', objective: 'fix', taskClass: 'bugfix',
  files: [], acceptanceCriteria: [], verification: [],
  outputContract: { artifactFirst: true }, confidence: 'derived',
  coverage: 'symbol', closure: true, capturedAt: null, claim: null, cost: null,
});

/**
 * Runs Task-Compiler ephemeral dispatch self-checks.
 * @param {{ ok:(m:string)=>void, bad:(m:string)=>void }} reporter
 * @param {{ KIT: string }} ctx
 */
export async function runTcDispatchChecks({ ok, bad }, { KIT }) {
  console.log('Checking tc-dispatch.mjs (TC-16 / WF0022 / ADR-0083)...');

  const modPath  = resolve(KIT, 'templates/contextkit/tools/scripts/economy/tc-dispatch.mjs');
  const corePath = resolve(KIT, 'templates/contextkit/tools/scripts/economy/tc-dispatch-core.mjs');

  // ── 1. Import ─────────────────────────────────────────────────────────────
  let lib;
  try { lib = await import(pathToFileURL(modPath).href); ok('tc-dispatch.mjs imports cleanly'); }
  catch (err) { bad(`import failed: ${err?.message ?? err}`); return; }

  const { TC_DISPATCH_SCHEMA_VERSION, probeHostCapability, planDispatch,
    executeDispatch, presentDispatchPlan, DispatchValidationError } = lib;

  // ── 2. Schema version ─────────────────────────────────────────────────────
  TC_DISPATCH_SCHEMA_VERSION === 'cdk-tc-dispatch/1'
    ? ok('TC_DISPATCH_SCHEMA_VERSION === "cdk-tc-dispatch/1"')
    : bad(`TC_DISPATCH_SCHEMA_VERSION is "${TC_DISPATCH_SCHEMA_VERSION}"`);

  // ── 3. Probe is pure: two calls yield identical results ───────────────────
  const p1 = probeHostCapability(), p2 = probeHostCapability();
  p1.capable === p2.capable && p1.reason === p2.reason
    ? ok('probeHostCapability: pure — identical on two consecutive calls')
    : bad(`probeHostCapability: differs between calls: ${JSON.stringify(p1)} vs ${JSON.stringify(p2)}`);

  // ── 4. Probe result is frozen ─────────────────────────────────────────────
  let froze4 = false;
  try { p1.capable = !p1.capable; } catch { froze4 = true; }
  froze4 || p1.capable === p2.capable
    ? ok('probeHostCapability: result is frozen')
    : bad('probeHostCapability: result is NOT frozen — mutation succeeded');

  // ── 5. Probe returns expected shape ───────────────────────────────────────
  typeof p1.capable === 'boolean' && typeof p1.reason === 'string'
    && (p1.execPath === null || typeof p1.execPath === 'string')
    ? ok('probeHostCapability: returns { capable:bool, reason:string, execPath:string|null }')
    : bad(`probeHostCapability: unexpected shape: ${JSON.stringify(p1)}`);

  // ── 6. TC_DISPATCH_DISABLE=1 → capable:false ─────────────────────────────
  const saved6 = process.env['TC_DISPATCH_DISABLE'];
  process.env['TC_DISPATCH_DISABLE'] = '1';
  const p6 = probeHostCapability();
  p6.capable === false ? ok('TC_DISPATCH_DISABLE=1 → capable:false')
    : bad(`TC_DISPATCH_DISABLE=1 did not set capable:false (got ${p6.capable})`);
  if (saved6 === undefined) delete process.env['TC_DISPATCH_DISABLE'];
  else process.env['TC_DISPATCH_DISABLE'] = saved6;

  // ── 7. CLAUDE_CODE_TOOL_CALL → capable:false ─────────────────────────────
  const saved7 = process.env['CLAUDE_CODE_TOOL_CALL'];
  process.env['CLAUDE_CODE_TOOL_CALL'] = 'test-tool-id';
  const p7 = probeHostCapability();
  p7.capable === false ? ok('CLAUDE_CODE_TOOL_CALL → capable:false')
    : bad(`CLAUDE_CODE_TOOL_CALL did not suppress capable (got ${p7.capable})`);
  if (saved7 === undefined) delete process.env['CLAUDE_CODE_TOOL_CALL'];
  else process.env['CLAUDE_CODE_TOOL_CALL'] = saved7;

  // ── 8. planDispatch throws on null ───────────────────────────────────────
  let t8 = false;
  try { planDispatch(null); } catch (e) { t8 = e instanceof DispatchValidationError; }
  t8 ? ok('planDispatch: throws DispatchValidationError on null')
     : bad('planDispatch: did not throw on null unit');

  // ── 9. planDispatch throws on invalid plain object ────────────────────────
  let t9 = false;
  try { planDispatch({ foo: 'bar' }); } catch (e) { t9 = e instanceof DispatchValidationError; }
  t9 ? ok('planDispatch: throws DispatchValidationError on invalid plain object')
     : bad('planDispatch: did not throw on invalid plain object');

  // ── 10. dry-run default → dryRun===true (no spawn) ───────────────────────
  const dryPlan = planDispatch(RECIPE);
  dryPlan.dryRun === true
    ? ok('planDispatch: dry-run default → dryRun===true (does NOT spawn)')
    : bad(`planDispatch: dryRun is ${dryPlan.dryRun} (expected true)`);

  // ── 11. mode is 'ephemeral' or 'in-session' (never absent) ───────────────
  dryPlan.mode === 'ephemeral' || dryPlan.mode === 'in-session'
    ? ok(`planDispatch: mode="${dryPlan.mode}" (explicit, expected ephemeral|in-session)`)
    : bad(`planDispatch: mode="${dryPlan.mode}" (unexpected)`);

  // ── 12. TC_DISPATCH_DISABLE → in-session fallback with reason ────────────
  const saved12 = process.env['TC_DISPATCH_DISABLE'];
  process.env['TC_DISPATCH_DISABLE'] = '1';
  const fbPlan = planDispatch(RECIPE);
  fbPlan.mode === 'in-session' && typeof fbPlan.reason === 'string' && fbPlan.reason.length > 0
    ? ok('planDispatch: TC_DISPATCH_DISABLE → mode="in-session" + explicit reason')
    : bad(`planDispatch: fallback unexpected mode="${fbPlan.mode}" reason="${fbPlan.reason}"`);
  if (saved12 === undefined) delete process.env['TC_DISPATCH_DISABLE'];
  else process.env['TC_DISPATCH_DISABLE'] = saved12;

  // ── 13. Returned plan is frozen ───────────────────────────────────────────
  let frozen13 = false;
  try { dryPlan.mode = 'tampered'; } catch { frozen13 = true; }
  frozen13 || dryPlan.mode === 'ephemeral' || dryPlan.mode === 'in-session'
    ? ok('planDispatch: returned plan is frozen')
    : bad('planDispatch: returned plan is NOT frozen');

  // ── 14. Recipe unit accepted ──────────────────────────────────────────────
  let t14 = false;
  try { planDispatch(RECIPE); t14 = true; } catch {}
  t14 ? ok('planDispatch: accepts recipe unit') : bad('planDispatch: rejected valid recipe');

  // ── 15. Work-packet unit accepted ────────────────────────────────────────
  let t15 = false;
  try { planDispatch(PACKET); t15 = true; } catch {}
  t15 ? ok('planDispatch: accepts work-packet unit')
      : bad('planDispatch: rejected valid work-packet');

  // ── 16. plan.advisory === true ────────────────────────────────────────────
  dryPlan.advisory === true
    ? ok('planDispatch: plan.advisory === true')
    : bad(`planDispatch: plan.advisory is ${dryPlan.advisory} (expected true)`);

  // ── 17. executeDispatch throws when dryRun===true ────────────────────────
  let t17 = false;
  try { executeDispatch({ ...dryPlan, dryRun: true }); }
  catch (e) { t17 = e instanceof DispatchValidationError; }
  t17 ? ok('executeDispatch: throws DispatchValidationError on dryRun===true')
      : bad('executeDispatch: did not throw on dryRun===true');

  // ── 18-20. executeDispatch in-session recipe path ────────────────────────
  const saved18 = process.env['TC_DISPATCH_DISABLE'];
  process.env['TC_DISPATCH_DISABLE'] = '1';
  const livePlan = planDispatch(RECIPE, { execute: true });
  if (saved18 === undefined) delete process.env['TC_DISPATCH_DISABLE'];
  else process.env['TC_DISPATCH_DISABLE'] = saved18;

  let env18 = null;
  try { env18 = executeDispatch(livePlan); ok('executeDispatch: in-session recipe completed'); }
  catch (e) { bad(`executeDispatch: threw: ${e?.message ?? e}`); }

  if (env18) {
    // 19. Envelope shape
    const keys = ['version','status','changed','verification','blockers','findings','artifact','dispatchMode'];
    const missing = keys.filter(k => !(k in env18));
    missing.length === 0 ? ok(`executeDispatch: envelope has all ADR-0083 keys`)
      : bad(`executeDispatch: missing envelope keys: ${missing.join(', ')}`);

    // 20. dispatchMode in-session
    env18.dispatchMode === 'in-session'
      ? ok('executeDispatch: dispatchMode="in-session" on fallback')
      : bad(`executeDispatch: dispatchMode="${env18.dispatchMode}" (expected in-session)`);
  } else {
    bad('executeDispatch: cannot check envelope — execution threw');
    bad('executeDispatch: cannot check dispatchMode — execution threw');
  }

  // ── 21. presentDispatchPlan ───────────────────────────────────────────────
  const pres = presentDispatchPlan(dryPlan);
  typeof pres === 'string' && pres.includes(dryPlan.mode) && pres.includes('reason')
    ? ok('presentDispatchPlan: output contains mode and reason')
    : bad(`presentDispatchPlan: output missing expected content`);

  // ── 22-23. Zero-dep invariants ────────────────────────────────────────────
  const zd1 = await checkZeroDep(modPath);
  zd1.error === null ? ok('zero-dep: tc-dispatch.mjs imports only node:/* or relative')
    : bad(`zero-dep: tc-dispatch.mjs ${zd1.error}`);

  const zd2 = await checkZeroDep(corePath);
  zd2.error === null ? ok('zero-dep: tc-dispatch-core.mjs imports only node:/* or relative')
    : bad(`zero-dep: tc-dispatch-core.mjs ${zd2.error}`);
}

// ---------------------------------------------------------------------------
// Standalone runner
// ---------------------------------------------------------------------------
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  let p = 0, f = 0;
  const r = { ok: m => { p++; console.log(`  ok  ${m}`); },
              bad: m => { f++; console.error(`  BAD ${m}`); } };
  await runTcDispatchChecks(r, { KIT: KIT_DEFAULT });
  console.log(`\n${p + f} checks: ${p} ok, ${f} bad`);
  process.exit(f > 0 ? 1 : 0);
}
