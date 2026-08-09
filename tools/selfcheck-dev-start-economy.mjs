#!/usr/bin/env node
/**
 * AEP-W4 / card 350 — focused behavioral self-check.
 *
 * Exercises the public contracts introduced by W1-W3 without depending on their
 * exact helper names. The accepted aliases are intentionally narrow: small API
 * naming changes are tolerated, but a missing behavior is still RED.
 */
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const BOOT = resolve(KIT, 'templates/contextkit/tools/scripts/economy/dev-start-bootstrap.mjs');
const LIFE = resolve(KIT, 'templates/contextkit/runtime/execution/economy-lifecycle.mjs');
const EVENTS = resolve(KIT, 'templates/contextkit/tools/scripts/economy/economy-events.mjs');

const pick = (mod, names) => names.map((name) => [name, mod?.[name]]).find(([, value]) => typeof value === 'function');
const truth = (value, key) => value?.[key] === true || value?.status?.[key] === true ||
  value?.lifecycle?.[key] === true || value?.status === key || value?.lifecycle === key;
const reasonOf = (value) => value?.reason ?? value?.reasonCode ?? value?.reasonCodes?.[0] ??
  value?.reasons?.[0] ?? value?.status?.reason ?? value?.lifecycle?.reason ?? '';
const schemaOf = (value) => value?.schemaVersion ?? value?.schema ?? '';
const text = (value) => JSON.stringify(value);

async function reconcile(fn, event, ack) {
  return fn(event, ack);
}

async function appendEvent(fn, file, event) {
  return fn.length >= 2 ? fn(event, file) : fn({ file, event });
}

export async function runDevStartEconomyChecks({ ok, bad } = {}) {
  let failures = 0;
  const pass = ok ?? ((m) => console.log(`  ✓ ${m}`));
  const fail = bad ?? ((m) => { console.error(`  ✗ ${m}`); failures += 1; });
  const check = (condition, message, detail = '') => condition ? pass(message) : fail(`${message}${detail ? ` — ${detail}` : ''}`);

  console.log('Checking automatic /dev-start economy contracts (AEP-W4, #350)...');

  let bootMod; let lifeMod; let eventMod;
  try {
    [bootMod, lifeMod, eventMod] = await Promise.all([
      import(pathToFileURL(BOOT).href),
      import(pathToFileURL(LIFE).href),
      import(pathToFileURL(EVENTS).href),
    ]);
    pass('W1-W3 modules import cleanly');
  } catch (err) {
    fail(`W1-W3 module import failed: ${err?.message ?? err}`);
    return failures || 1;
  }

  const boot = pick(bootMod, ['devStartBootstrap', 'bootstrapDevStart', 'runDevStartBootstrap', 'buildDevStartBootstrap']);
  const parseArgs = pick(bootMod, ['parseDevStartArgs']);
  const makeEvent = pick(lifeMod, ['createEconomyEvent', 'economyEvent', 'createLifecycleEvent', 'lifecycleEvent']);
  const recordEvent = pick(eventMod, ['recordEconomyEvent', 'createEconomyEvent', 'economyEvent']);
  const makeAck = pick(lifeMod, ['createEconomyAck', 'economyAck', 'createExecutionAck', 'executionAck']);
  const applyAck = pick(lifeMod, ['reconcileDecisionExecution', 'applyEconomyAck', 'reconcileEconomyAck', 'acknowledgeEconomyDecision', 'reconcileLifecycle']);
  const append = pick(eventMod, ['appendEconomyEvent', 'appendEvent', 'writeEconomyEvent']);
  const read = pick(eventMod, ['readEconomyEvents', 'readEvents']);
  const summarize = pick(eventMod, ['summarizeEconomyEvents', 'economyEventSummary', 'lifecycleSummary', 'summarizeEvents']);

  for (const [label, found] of [
    ['bootstrap entrypoint', boot],
    ['bootstrap argument parser', parseArgs],
    ['lifecycle event builder', makeEvent],
    ['persistence event builder', recordEvent],
    ['execution acknowledgement builder', makeAck],
    ['acknowledgement reconciler', applyAck],
    ['event append', append],
    ['event read', read],
    ['event aggregation', summarize],
  ]) check(Boolean(found), `${label} is exported`);
  if (![makeEvent, recordEvent, makeAck, applyAck, append, read, summarize].every(Boolean)) return failures || 1;

  const parsed = parseArgs[1]([
    '--json', '--host', 'test', '--objective', '--',
    'inspect --host attacker --json && echo never-executed',
  ]);
  check(parsed.json === true && parsed.host === 'test', 'bootstrap options are parsed before the literal objective');
  check(parsed.objective === 'inspect --host attacker --json && echo never-executed',
    'objective flags and shell syntax remain literal data');

  const base = {
    requestId: 'req-350',
    sessionId: 'sess-350',
    taskId: '350',
    decisionId: 'route-350',
    lever: 'routing',
    mode: 'shadow',
    evaluated: true,
    eligible: true,
    recommended: true,
    directed: false,
    attempted: false,
    applied: false,
    skipped: true,
    failed: false,
    lifecycle: 'skipped',
    reason: 'shadow_mode',
  };

  let shadow;
  try {
    shadow = await makeEvent[1](base, { now: 1_750_000_000_000 });
    check(/cdk-economy-event\/1/.test(schemaOf(shadow)), 'lifecycle event carries cdk-economy-event/1');
    check(truth(shadow, 'evaluated') && truth(shadow, 'skipped') && !truth(shadow, 'applied'),
      'shadow lifecycle is evaluated and skipped, never applied');
    check(reasonOf(shadow) === 'shadow_mode', 'shadow lifecycle records reason=shadow_mode', reasonOf(shadow));
    check(!/savedTokens|observedSavings/.test(text(shadow)), 'shadow recommendation does not claim observed savings');
  } catch (err) {
    fail(`lifecycle event builder threw: ${err?.message ?? err}`);
    return failures || 1;
  }

  const activeDecision = {
    ...base,
    mode: 'active',
    lifecycle: 'directed',
    skipped: false,
    eligible: true,
    recommended: true,
    directed: true,
    applied: false,
    policyWouldApply: true,
    executor: 'haiku',
    recommendedTier: 'haiku',
    reason: 'route_directed',
  };
  const canaryDecision = { ...activeDecision, mode: 'canary' };
  for (const [mode, event] of [['active', activeDecision], ['canary', canaryDecision]]) {
    const withoutAck = await reconcile(applyAck[1], event, null);
    check(!truth(withoutAck, 'applied'), `${mode} route stays unapplied without acknowledgement`);
    check(/ack|receipt|unobserved|required|missing/i.test(reasonOf(withoutAck) + text(withoutAck)),
      `${mode} missing acknowledgement has an explicit reason`, reasonOf(withoutAck));
  }

  let ack;
  try {
    ack = await makeAck[1]({
      requestId: 'req-350',
      sessionId: 'sess-350',
      taskId: '350',
      decisionId: 'route-350',
      attempted: true,
      applied: true,
      executor: 'haiku',
      exitCode: 0,
      qualityEquivalent: true,
      evidenceRefs: ['test:selfcheck-dev-start-economy'],
    }, { now: 4 });
    check(/cdk-economy-ack\/1/.test(schemaOf(ack)), 'acknowledgement carries cdk-economy-ack/1');
    check(ack?.decisionId === 'route-350' || ack?.correlation?.decisionId === 'route-350',
      'acknowledgement preserves decision correlation');
  } catch (err) {
    fail(`acknowledgement builder threw: ${err?.message ?? err}`);
    return failures || 1;
  }

  const applied = await reconcile(applyAck[1], activeDecision, ack);
  check(truth(applied, 'attempted') && truth(applied, 'applied'), 'valid acknowledgement promotes attempted → applied');
  check(!/fable/i.test(String(applied?.executor ?? applied?.actualExecutor ?? '')), 'applied lifecycle never selects Fable');
  const appliedEvent = await makeEvent[1]({ ...activeDecision, lever: 'routing', executionAck: ack, reason: 'acknowledged' }, { now: 6 });
  const wrongSessionAck = await makeAck[1]({ ...ack, sessionId: 'sess-attacker' });
  const wrongSession = await reconcile(applyAck[1], activeDecision, wrongSessionAck);
  check(!truth(wrongSession, 'applied') && /session_id_mismatch/.test(text(wrongSession)),
    'acknowledgement with wrong session correlation is rejected');

  let fableResult = null;
  try {
    const fableAck = await makeAck[1]({ ...ack, executor: 'fable', applied: true }, { now: 5 });
    fableResult = await reconcile(applyAck[1], activeDecision, fableAck);
  } catch (err) {
    fableResult = { applied: false, reason: `blocked: ${err?.message ?? err}` };
  }
  check(!truth(fableResult, 'applied'), 'automatic Fable acknowledgement cannot become applied');

  const dir = mkdtempSync(resolve(tmpdir(), 'aep-selfcheck-'));
  const file = resolve(dir, 'economy-events.jsonl');
  try {
    const evaluatedRecord = await recordEvent[1]({
      lever: 'routing',
      lifecycle: 'evaluated',
      reason: 'route_evaluated',
      requestId: 'req-350',
      decisionId: 'route-350',
      sessionId: 'sess-350',
    }, { now: 1 });
    await appendEvent(append[1], file, evaluatedRecord);
    await appendEvent(append[1], file, shadow);
    await appendEvent(append[1], file, appliedEvent);
    appendFileSync(file, '{ malformed event\n', 'utf8');
    let records = [];
    try { records = await read[1](file); } catch (err) { fail(`event reader was not fail-open: ${err?.message ?? err}`); }
    check(Array.isArray(records) && records.length === 3, 'event reader skips malformed JSONL and preserves valid records',
      `read ${records?.length ?? 'non-array'}`);
    const summary = await summarize[1](records);
    const rendered = text(summary);
    check(/shadow_mode/.test(rendered), 'aggregation retains reason tallies');
    check(/evaluated/.test(rendered) && /applied/.test(rendered), 'aggregation exposes lifecycle counts');
    check(!/"fable"\s*:\s*[1-9]/i.test(rendered), 'aggregation reports no automatic Fable application');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  return failures;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = await runDevStartEconomyChecks();
  console.log(failures === 0 ? '\n✅ AEP-W4 self-check passed.\n' : `\n❌ ${failures} AEP-W4 self-check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}
