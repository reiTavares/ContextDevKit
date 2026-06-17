/**
 * Self-check — EACP Wave 4 budget guards + report surface (cards #238).
 *
 * Asserts the budget evaluation engine (budgets.mjs) and the human-facing
 * bypass + presentation surface (budgets-report.mjs) are internally sound:
 * - Schema version constant + BUDGET_MODES/BUDGET_SCOPES shapes.
 * - evaluateBudget: warn/over-limit/hardCap/pressure-escalation/skipped cases.
 * - recommendCheaperModel: ladder step-down, floor clamp, unknown tier.
 * - auditRecord: ts from context, deterministic (no Date.now drift).
 * - applyBypass: forces 'observe', records provenance, throws on bad bypass,
 *   returns skipped advisory unchanged.
 * - presentBudget: skipped → "skipped"; populated → "Budget guard".
 * - Zero-dep invariant on both budget modules.
 *
 * Mirrors the structure of selfcheck-eacp-pressure.mjs exactly.
 *
 * Cohesion note (constitution §1, +10% tolerance): one cohesive assertion
 * suite for a single wave — splitting ok()/bad() across files would be
 * premature abstraction with no second consumer. Kept under the 308 cap.
 *
 * Zero runtime dependencies — node:* only.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @private — copy from selfcheck-eacp-pressure.mjs (not exported there). */
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

/**
 * Runs EACP Wave 4 budget engine + report surface checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root
 */
export async function runEacpBudgetChecks({ ok, bad }, { KIT }) {
  console.log('Checking EACP Wave 4 budget guards + report surface (card #238)...');
  const econ = 'templates/contextkit/tools/scripts/economics';
  const modDefs = [
    ['budgets.mjs',        resolve(KIT, `${econ}/budgets.mjs`)],
    ['budgets-report.mjs', resolve(KIT, `${econ}/budgets-report.mjs`)],
  ];

  const libs = {};
  for (const [name, path] of modDefs) {
    try {
      libs[name] = await import(pathToFileURL(path).href);
      ok(`${name} imports cleanly`);
    } catch (err) {
      bad(`${name} import failed: ${err?.message ?? err}`);
      return; // Cannot assert anything without the modules.
    }
  }

  const budLib = libs['budgets.mjs'];
  const repLib = libs['budgets-report.mjs'];

  // ── Schema version + shape constants ─────────────────────────────────────

  // 1. Schema version
  budLib.BUDGET_SCHEMA_VERSION === 'eacp-budget/1'
    ? ok('budgets: BUDGET_SCHEMA_VERSION === "eacp-budget/1"')
    : bad(`budgets: BUDGET_SCHEMA_VERSION is "${budLib.BUDGET_SCHEMA_VERSION}"`);

  // 2. BUDGET_MODES shape — 6-element frozen array starting with 'observe'
  Array.isArray(budLib.BUDGET_MODES) && budLib.BUDGET_MODES.length === 6 &&
  budLib.BUDGET_MODES[0] === 'observe' && budLib.BUDGET_MODES[5] === 'block'
    ? ok('budgets: BUDGET_MODES is 6-element array from "observe" to "block"')
    : bad(`budgets: BUDGET_MODES shape wrong: ${JSON.stringify(budLib.BUDGET_MODES)}`);

  // 3. BUDGET_SCOPES includes 'session', 'run', 'day'
  const scopes = budLib.BUDGET_SCOPES;
  Array.isArray(scopes) && ['session', 'run', 'day'].every(s => scopes.includes(s))
    ? ok('budgets: BUDGET_SCOPES includes "session", "run", "day"')
    : bad(`budgets: BUDGET_SCOPES missing expected values: ${JSON.stringify(scopes)}`);

  // ── evaluateBudget ────────────────────────────────────────────────────────

  // 4. Warn band: 90/100, warnAtPct 80 → mode 'warn', budgetExhausted false
  const warnAdv = budLib.evaluateBudget(
    { tokens: 90 },
    { scope: 'session', limit: 100, warnAtPct: 80 },
    {},
  );
  warnAdv.mode === 'warn' && warnAdv.budgetExhausted === false
    ? ok('evaluateBudget: 90/100 warnAtPct 80 → mode "warn", budgetExhausted false')
    : bad(`evaluateBudget: warn band wrong — mode="${warnAdv.mode}" budgetExhausted=${warnAdv.budgetExhausted}`);

  // 5. Over limit: 120/100 → mode 'downgrade', budgetExhausted true
  const overAdv = budLib.evaluateBudget(
    { tokens: 120 },
    { scope: 'session', limit: 100 },
    {},
  );
  overAdv.mode === 'downgrade' && overAdv.budgetExhausted === true
    ? ok('evaluateBudget: 120/100 → mode "downgrade", budgetExhausted true')
    : bad(`evaluateBudget: over-limit wrong — mode="${overAdv.mode}" budgetExhausted=${overAdv.budgetExhausted}`);

  // 6. HardCap block: spend 200/100, hardCap 150 → mode 'block'
  const blockAdv = budLib.evaluateBudget(
    { tokens: 200 },
    { scope: 'session', limit: 100, hardCap: 150 },
    {},
  );
  blockAdv.mode === 'block' && blockAdv.budgetExhausted === true
    ? ok('evaluateBudget: 200/100 hardCap 150 → mode "block", budgetExhausted true')
    : bad(`evaluateBudget: hardCap block wrong — mode="${blockAdv.mode}" budgetExhausted=${blockAdv.budgetExhausted}`);

  // 7. Pressure escalation: 120/100 hardCap 150, pressureBand 'hot' → mode 'split'
  const splitAdv = budLib.evaluateBudget(
    { tokens: 120 },
    { scope: 'session', limit: 100, hardCap: 150 },
    { pressureBand: 'hot' },
  );
  splitAdv.mode === 'split' && splitAdv.budgetExhausted === true
    ? ok('evaluateBudget: 120/100 hardCap 150 pressureBand "hot" → mode "split", exhausted true')
    : bad(`evaluateBudget: pressure escalation wrong — mode="${splitAdv.mode}" budgetExhausted=${splitAdv.budgetExhausted}`);

  // 8. Skipped on null budget
  const skipNullAdv = budLib.evaluateBudget({ tokens: 50 }, null, {});
  skipNullAdv?.status === 'skipped'
    ? ok('evaluateBudget: null budget → skipped marker')
    : bad(`evaluateBudget: null budget should skip, got ${JSON.stringify(skipNullAdv)}`);

  // 9. Skipped on missing spend metric (tokens unit, usd provided)
  const skipMetricAdv = budLib.evaluateBudget(
    { usd: 5 },
    { scope: 'session', limit: 100 },
    {},
  );
  skipMetricAdv?.status === 'skipped'
    ? ok('evaluateBudget: spend metric (tokens) missing → skipped marker')
    : bad(`evaluateBudget: missing metric should skip, got ${JSON.stringify(skipMetricAdv)}`);

  // 10. CeilingMode 'observe' clamps a would-be 'block' down to 'observe'
  const ceilAdv = budLib.evaluateBudget(
    { tokens: 200 },
    { scope: 'session', limit: 100, hardCap: 150, ceilingMode: 'observe' },
    {},
  );
  ceilAdv.mode === 'observe'
    ? ok('evaluateBudget: ceilingMode "observe" clamps "block" → "observe"')
    : bad(`evaluateBudget: ceilingMode clamp wrong — mode="${ceilAdv.mode}"`);

  // ── recommendCheaperModel ─────────────────────────────────────────────────

  const ladder = ['fast', 'powerful', 'reasoning'];
  const tiers  = { fast: { alias: 'haiku' }, powerful: { alias: 'opus' }, reasoning: { alias: 'reason' } };
  const policy = { ladder, floorTier: 'fast', tiers };

  // 11. powerful → fast (one step down on ['fast','powerful','reasoning'])
  const rec = budLib.recommendCheaperModel('powerful', policy, {});
  rec !== null && rec.tier === 'fast'
    ? ok('recommendCheaperModel: "powerful" → "fast" (step down on ladder)')
    : bad(`recommendCheaperModel: step-down wrong — ${JSON.stringify(rec)}`);

  // 12. Floor clamp: criticalTask:true + floorTier 'powerful' → stays 'powerful' (atFloor, alreadyLowest)
  const policyWithFloor = { ladder, floorTier: 'powerful', tiers };
  const recFloor = budLib.recommendCheaperModel('powerful', policyWithFloor, { criticalTask: true });
  recFloor !== null && recFloor.tier === 'powerful' && recFloor.atFloor === true && recFloor.alreadyLowest === true
    ? ok('recommendCheaperModel: criticalTask + floorTier "powerful" keeps tier "powerful" (atFloor, alreadyLowest)')
    : bad(`recommendCheaperModel: floor clamp wrong — ${JSON.stringify(recFloor)}`);

  // 13. Unknown tier → null
  const recUnknown = budLib.recommendCheaperModel('mythical', policy, {});
  recUnknown === null
    ? ok('recommendCheaperModel: unknown tier → null')
    : bad(`recommendCheaperModel: unknown tier should be null, got ${JSON.stringify(recUnknown)}`);

  // ── auditRecord ───────────────────────────────────────────────────────────

  // 14. ts is null when context.ts absent
  const arNoTs = budLib.auditRecord({ scope: 'session', mode: 'warn' }, {});
  arNoTs.ts === null
    ? ok('auditRecord: ts is null when context.ts absent')
    : bad(`auditRecord: ts should be null when absent, got ${arNoTs.ts}`);

  // 15. ts === provided number
  const arWithTs = budLib.auditRecord({ scope: 'session', mode: 'warn' }, { ts: 12345 });
  arWithTs.ts === 12345
    ? ok('auditRecord: ts === provided context.ts number')
    : bad(`auditRecord: ts should be 12345, got ${arWithTs.ts}`);

  // 16. Deterministic: same inputs → identical output (no Date.now drift)
  const ar1 = budLib.auditRecord({ scope: 'run', mode: 'observe', ratio: 0.5, spend: 50, limit: 100 }, { ts: 9999 });
  const ar2 = budLib.auditRecord({ scope: 'run', mode: 'observe', ratio: 0.5, spend: 50, limit: 100 }, { ts: 9999 });
  JSON.stringify(ar1) === JSON.stringify(ar2)
    ? ok('auditRecord: deterministic — two calls with same inputs produce identical output')
    : bad(`auditRecord: non-deterministic — ${JSON.stringify(ar1)} vs ${JSON.stringify(ar2)}`);

  // ── applyBypass ───────────────────────────────────────────────────────────

  // 17. Forces mode 'observe' and records audit.bypass.by
  const bypassed = repLib.applyBypass(overAdv, { by: 'alice', reason: 'approved for sprint demo' });
  bypassed.mode === 'observe' && bypassed.budgetExhausted === false &&
  bypassed.audit?.bypass?.by === 'alice'
    ? ok('applyBypass: forces mode "observe", budgetExhausted false, records audit.bypass.by')
    : bad(`applyBypass: bypass application wrong — ${JSON.stringify(bypassed)}`);

  // 18. Throws TypeError on {by: ''}
  let didThrow = false;
  try {
    repLib.applyBypass(overAdv, { by: '', reason: 'reason' });
  } catch (err) {
    didThrow = err instanceof TypeError;
  }
  didThrow
    ? ok('applyBypass: throws TypeError on {by: ""} (empty string)')
    : bad('applyBypass: should throw TypeError on missing/empty by, but did not');

  // 19. Returns skipped advisory unchanged
  const skipInput = { status: 'skipped', reason: 'test' };
  const bypassedSkip = repLib.applyBypass(skipInput, { by: 'bob', reason: 'ok' });
  bypassedSkip === skipInput
    ? ok('applyBypass: returns skipped advisory unchanged (does not wrap skipped)')
    : bad(`applyBypass: skipped advisory should be returned as-is, got ${JSON.stringify(bypassedSkip)}`);

  // ── presentBudget ─────────────────────────────────────────────────────────

  // 20. Skipped marker → output contains 'skipped'
  const preSkipped = repLib.presentBudget({ status: 'skipped', reason: 'no budget' });
  typeof preSkipped === 'string' && preSkipped.includes('skipped')
    ? ok('presentBudget: skipped advisory → string contains "skipped"')
    : bad(`presentBudget: skipped should contain "skipped", got: ${preSkipped}`);

  // 21. Populated advisory → output contains 'Budget guard'
  const preFull = repLib.presentBudget(warnAdv);
  typeof preFull === 'string' && preFull.includes('Budget guard')
    ? ok('presentBudget: populated advisory → string contains "Budget guard"')
    : bad(`presentBudget: populated should contain "Budget guard", got: ${preFull.slice(0, 200)}`);

  // ── ask-mode budgetExhausted; all scopes; fail-open; resolver integration (#238) ──

  // 22. ask mode + over-limit → budgetExhausted===true
  const askAdv = budLib.evaluateBudget({tokens:110},{scope:'session',limit:100,ceilingMode:'ask'},{});
  askAdv.mode === 'ask' && askAdv.budgetExhausted === true
    ? ok('evaluateBudget: ceilingMode "ask" + over-limit → mode "ask", budgetExhausted true')
    : bad(`evaluateBudget: ask mode wrong — mode="${askAdv.mode}" budgetExhausted=${askAdv.budgetExhausted}`);

  // 23. All 13 BUDGET_SCOPES produce non-skipped result with valid spend/limit
  const scopeFails = budLib.BUDGET_SCOPES.filter(scope => {
    const r = budLib.evaluateBudget({tokens:50},{scope,limit:100},{});
    return r?.status === 'skipped' || typeof r?.spend !== 'number' || typeof r?.limit !== 'number';
  });
  scopeFails.length === 0
    ? ok(`evaluateBudget: all ${budLib.BUDGET_SCOPES.length} BUDGET_SCOPES produce non-skipped result`)
    : bad(`evaluateBudget: scopes with bad result: ${scopeFails.join(', ')}`);

  // 24. Invalid spend type → skipped (fail-open, constitution §8)
  budLib.evaluateBudget('invalid',{scope:'session',limit:100},{})?.status === 'skipped'
    ? ok('evaluateBudget: non-object spend → skipped (fail-open, constitution §8)')
    : bad('evaluateBudget: invalid spend should skip');

  // 25. Resolver integration (ADR-0044 D3): grade4+budgetExhausted→edit='suggest', swarm='manual'
  const raPath = resolve(KIT, 'templates/contextkit/runtime/config/resolve-autonomy.mjs');
  let raLib;
  try { raLib = await import(pathToFileURL(raPath).href); }
  catch (err) { bad(`resolve-autonomy import failed: ${err?.message ?? err}`); raLib = null; }
  if (raLib) {
    const cfg4 = { autonomy: { grade: 4 }, deliberations: { active: true } };
    const editRes = raLib.resolveAutonomy('edit', cfg4, null, { budgetExhausted: true });
    editRes.mode === 'suggest'
      ? ok('resolver: grade4+budgetExhausted → edit="suggest" (never blocks, ADR-0044 D3)')
      : bad(`resolver: grade4+budgetExhausted edit wrong: "${editRes.mode}"`);
    const swarmRes = raLib.resolveAutonomy('swarm-dispatch', cfg4, null, { budgetExhausted: true });
    swarmRes.mode === 'manual'
      ? ok('resolver: grade4+budgetExhausted → swarm-dispatch="manual" (fan-out blocked)')
      : bad(`resolver: grade4+budgetExhausted swarm-dispatch wrong: "${swarmRes.mode}"`);
  }

  // ── Zero-dep invariant ────────────────────────────────────────────────────

  // 26. Both budget modules satisfy the zero-dep contract
  let zeroDepsOk = true;
  for (const [name, path] of modDefs) {
    const result = await checkModuleZeroDep(name, path);
    if (result.error) {
      bad(`zero-dep Wave 4 budget: ${name} ${result.error}`);
      zeroDepsOk = false;
    }
  }
  if (zeroDepsOk) ok('zero-dep invariant: both Wave 4 budget modules import only node:/* or relative paths');
}
