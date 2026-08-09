/**
 * Self-check — EACP subscription-mode benchmark (card #254 / EACP-19, ADR-0104).
 *
 * Asserts benchmark-subscription.mjs is internally sound: schema version + unit
 * list, effectiveMtok (cache-read counted, weight knob, null on empty), quotaDelta
 * (remaining/used delta + skip on non-positive), armRate (effective-MTok primary,
 * quota-pct fallback, skip when neither), subscriptionPilot (ratio via
 * autonomyMultiplier, unit-mismatch skip, pilotSmoke, claim===null + baselineMeasured
 * ===false ALWAYS), presentSubscription, and the zero-dep invariant.
 *
 * Cohesion note (constitution §1): one cohesive assertion suite for one module.
 * Zero runtime dependencies — node:* only.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @private — verifies a module imports only node:* / relative specifiers. */
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

/**
 * Runs the EACP subscription-mode benchmark self-checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root
 */
export async function runEacpSubscriptionChecks({ ok, bad }, { KIT }) {
  console.log('Checking EACP subscription-mode benchmark (card #254 / ADR-0104)...');
  const econ = 'templates/contextkit/tools/scripts/economics';
  const subPath = resolve(KIT, `${econ}/benchmark-subscription.mjs`);

  let lib;
  try { lib = await import(pathToFileURL(subPath).href); ok('benchmark-subscription.mjs imports cleanly'); }
  catch (err) { bad(`benchmark-subscription.mjs import failed: ${err?.message ?? err}`); return; }

  const { SUBSCRIPTION_SCHEMA_VERSION, SUBSCRIPTION_UNITS,
          effectiveMtok, quotaDelta, armRate, subscriptionPilot, presentSubscription } = lib;

  // ── Constants ─────────────────────────────────────────────────────────────
  SUBSCRIPTION_SCHEMA_VERSION === 'eacp-benchmark-subscription/1'
    ? ok('subscription: SCHEMA_VERSION === "eacp-benchmark-subscription/1"')
    : bad(`subscription: SCHEMA_VERSION is "${SUBSCRIPTION_SCHEMA_VERSION}"`);
  Array.isArray(SUBSCRIPTION_UNITS) && SUBSCRIPTION_UNITS[0] === 'effective-mtok' && SUBSCRIPTION_UNITS[1] === 'quota-pct'
    ? ok('subscription: SUBSCRIPTION_UNITS = [effective-mtok (primary), quota-pct]')
    : bad(`subscription: SUBSCRIPTION_UNITS wrong: ${JSON.stringify(SUBSCRIPTION_UNITS)}`);

  // ── effectiveMtok ─────────────────────────────────────────────────────────
  // 500k input + 500k output + 1M cacheCreate + 2M cacheRead = 4M → 4.0 MTok (weight 1).
  const em = effectiveMtok({ input: 500000, output: 500000, cacheCreate: 1000000, cacheRead: 2000000 });
  Math.abs(em - 4.0) < 1e-9
    ? ok('effectiveMtok: cache-read counted at weight 1.0 → 4.0 MTok')
    : bad(`effectiveMtok: expected 4.0, got ${em}`);
  // weight 0 drops the 2M cache-read → 2.0 MTok.
  Math.abs(effectiveMtok({ input: 500000, output: 500000, cacheCreate: 1000000, cacheRead: 2000000 }, { cacheReadWeight: 0 }) - 2.0) < 1e-9
    ? ok('effectiveMtok: cacheReadWeight=0 discounts cache-read → 2.0 MTok')
    : bad('effectiveMtok: cacheReadWeight knob not honored');
  effectiveMtok({}) === null && effectiveMtok(null) === null
    ? ok('effectiveMtok: empty/null → null (no fabricated total)')
    : bad('effectiveMtok: empty/null should be null');

  // ── quotaDelta ────────────────────────────────────────────────────────────
  const qd = quotaDelta({ remainingPct: 80 }, { remainingPct: 65 });
  qd.consumedPct === 15 && qd.confidence === 'inferred' && qd.method === 'remaining-delta'
    ? ok('quotaDelta: remaining 80→65 → consumed 15%, inferred')
    : bad(`quotaDelta: remaining-delta wrong: ${JSON.stringify(qd)}`);
  const qu = quotaDelta({ usedPct: 10 }, { usedPct: 22 });
  qu.consumedPct === 12 && qu.method === 'used-delta'
    ? ok('quotaDelta: used 10→22 → consumed 12% (used-delta fallback)')
    : bad(`quotaDelta: used-delta wrong: ${JSON.stringify(qu)}`);
  quotaDelta({ remainingPct: 50 }, { remainingPct: 60 })?.status === 'skipped'
    ? ok('quotaDelta: non-positive consumption → skipped (no fabricated delta)')
    : bad('quotaDelta: non-positive delta should skip');
  quotaDelta({}, {})?.status === 'skipped'
    ? ok('quotaDelta: no pct fields → skipped') : bad('quotaDelta: empty should skip');

  // ── armRate ───────────────────────────────────────────────────────────────
  const good = { acceptanceMet: true, testsRun: true, qaGreen: true, externalCriteria: true, evaluatorNotOperator: true };
  const rMtok = armRate({ tasks: [good, good], tokens: { input: 1000000, output: 1000000 } });
  rMtok.unit === 'effective-mtok' && rMtok.qaGreen === 2 && Math.abs(rMtok.units - 2.0) < 1e-9
    ? ok('armRate: tokens present → unit effective-mtok, qaGreen 2, units 2.0')
    : bad(`armRate: effective-mtok path wrong: ${JSON.stringify(rMtok)}`);
  const rQuota = armRate({ tasks: [good], quotaDeltaPct: 8 });
  rQuota.unit === 'quota-pct' && rQuota.units === 8
    ? ok('armRate: no tokens, quotaDeltaPct → unit quota-pct, units 8')
    : bad(`armRate: quota-pct fallback wrong: ${JSON.stringify(rQuota)}`);
  armRate({ tasks: [good] })?.status === 'skipped'
    ? ok('armRate: no denominator → skipped') : bad('armRate: missing denominator should skip');

  // ── subscriptionPilot ─────────────────────────────────────────────────────
  // arm C: 8 green over 2 MTok; arm A: 5 green over 2 MTok → ratio (8/2)/(5/2)=1.6.
  const greenN = (n) => Array.from({ length: n }, () => ({ ...good }));
  const pilot = subscriptionPilot(
    { tasks: [...greenN(5), { acceptanceMet: false }], tokens: { input: 1000000, output: 1000000 } },
    { tasks: greenN(8), tokens: { input: 1000000, output: 1000000 } },
    { host: 'claude-code-max' },
  );
  pilot.schemaVersion === SUBSCRIPTION_SCHEMA_VERSION && pilot.unit === 'effective-mtok' &&
  Math.abs(pilot.multiplier.multiplier - 1.6) < 1e-9
    ? ok('subscriptionPilot: A(5/2) vs C(8/2) → ratio 1.6×, unit effective-mtok')
    : bad(`subscriptionPilot: ratio/unit wrong: ${JSON.stringify(pilot.multiplier)}`);
  pilot.multiplier.confidence === 'inferred'
    ? ok('subscriptionPilot: effective-mtok substitute → confidence "inferred"')
    : bad(`subscriptionPilot: expected "inferred", got "${pilot.multiplier.confidence}"`);
  pilot.claim === null && pilot.multiplier.claim === null && pilot.baselineMeasured === false
    ? ok('subscriptionPilot: claim===null + baselineMeasured===false ALWAYS')
    : bad(`subscriptionPilot: honesty invariants broken: ${JSON.stringify({ c: pilot.claim, b: pilot.baselineMeasured })}`);
  pilot.host === 'claude-code-max' && Array.isArray(pilot.controlsHeldEqual) && pilot.controlsHeldEqual.length > 0
    ? ok('subscriptionPilot: host recorded + controlsHeldEqual carried from design')
    : bad('subscriptionPilot: host/controls metadata missing');

  // pilotSmoke flag propagates + reasonUnavailable reflects it
  const smoke = subscriptionPilot(
    { tasks: greenN(2), tokens: { input: 1000000, output: 0 } },
    { tasks: greenN(3), tokens: { input: 1000000, output: 0 } },
    { pilotSmoke: true },
  );
  smoke.pilotSmoke === true && /smoke/i.test(smoke.multiplier.reasonUnavailable)
    ? ok('subscriptionPilot: pilotSmoke=true flagged + reasonUnavailable notes it')
    : bad(`subscriptionPilot: pilotSmoke not honored: ${JSON.stringify({ s: smoke.pilotSmoke, r: smoke.multiplier.reasonUnavailable })}`);

  // unit mismatch → skipped (no denominator-shopping)
  subscriptionPilot(
    { tasks: greenN(2), tokens: { input: 1000000 } },
    { tasks: greenN(2), quotaDeltaPct: 5 },
  )?.status === 'skipped'
    ? ok('subscriptionPilot: unit mismatch (mtok vs quota-pct) → skipped (no denominator-shopping)')
    : bad('subscriptionPilot: unit mismatch should skip');

  // invalid arm → skipped
  subscriptionPilot(null, { tasks: greenN(2), tokens: { input: 1000000 } })?.status === 'skipped'
    ? ok('subscriptionPilot: null armA → skipped') : bad('subscriptionPilot: null arm should skip');

  // ── presentSubscription ───────────────────────────────────────────────────
  presentSubscription(null).includes('skipped')
    ? ok('presentSubscription: null → "skipped"') : bad('presentSubscription: null should be skipped');
  const rendered = presentSubscription(pilot);
  rendered.includes('1.6000') && /claim:\s*null/i.test(rendered) && rendered.toLowerCase().includes('target')
    ? ok('presentSubscription: shows ratio + "claim: null" + targets framing')
    : bad(`presentSubscription: output wrong: ${rendered.slice(0, 200)}`);
  presentSubscription(smoke).includes('SMOKE')
    ? ok('presentSubscription: pilotSmoke → renders SMOKE warning')
    : bad('presentSubscription: smoke warning missing');

  // ── Zero-dep invariant ────────────────────────────────────────────────────
  const zd = await checkModuleZeroDep(subPath);
  zd.error ? bad(`zero-dep: benchmark-subscription.mjs ${zd.error}`)
           : ok('zero-dep invariant: benchmark-subscription.mjs imports only node:/* or relative paths');
}
