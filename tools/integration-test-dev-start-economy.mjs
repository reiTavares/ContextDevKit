#!/usr/bin/env node
/**
 * AEP-W4 / card 350 — hermetic fresh-session integration proof.
 *
 * No install, network, user home or dogfood writes: every lifecycle/event ledger
 * lives below a disposable project root.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const BOOT = resolve(KIT, 'templates/contextkit/tools/scripts/economy/dev-start-bootstrap.mjs');
const LIFE = resolve(KIT, 'templates/contextkit/runtime/execution/economy-lifecycle.mjs');
const EVENTS = resolve(KIT, 'templates/contextkit/tools/scripts/economy/economy-events.mjs');
const ROUTE = resolve(KIT, 'templates/contextkit/tools/scripts/routing/routing-decision.mjs');
const CLASSIFY = resolve(KIT, 'templates/contextkit/tools/scripts/routing/task-classifier.mjs');
const PROJECT_MAP = resolve(KIT, 'templates/contextkit/tools/scripts/project-map.mjs');
const TOKEN_REPORT = resolve(KIT, 'templates/contextkit/tools/scripts/token-report.mjs');
const ROUTING_ECONOMICS = resolve(KIT, 'templates/contextkit/tools/scripts/economics/routing-economics.mjs');

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.error(`  ✗ ${m}`); failures += 1; };
const check = (condition, message, detail = '') => condition ? ok(message) : bad(`${message}${detail ? ` — ${detail}` : ''}`);
const pickEntry = (mod, names) => names.map((name) => [name, mod?.[name]]).find(([, value]) => typeof value === 'function');
const pick = (mod, names) => pickEntry(mod, names)?.[1];
const json = (value) => JSON.stringify(value);

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'aep-dev-start-'));
  mkdirSync(resolve(root, 'src'), { recursive: true });
  mkdirSync(resolve(root, 'contextkit', 'memory'), { recursive: true });
  writeFileSync(resolve(root, 'package.json'), JSON.stringify({ name: 'aep-fixture', type: 'module' }));
  writeFileSync(resolve(root, 'contextkit', 'config.json'), JSON.stringify({
    level: 7,
    eacp: { enabled: true },
    routing: { enabled: true, mode: 'shadow', minLevel: 4, runnerFirstMaxCommands: 3 },
  }));
  writeFileSync(resolve(root, 'src', 'economy-target.mjs'), 'export function targetEconomy() { return 1; }\n');
  execFileSync(process.execPath, [PROJECT_MAP, '--dense'], { cwd: root, encoding: 'utf8' });
  return root;
}

function stageName(value) {
  return [
    value?.stage, value?.name, value?.event, value?.type, value?.action,
    value?.lever, value?.lifecycle, value?.reason,
  ].filter(Boolean).join(':');
}

function ordered(items, patterns) {
  const names = items.map(stageName);
  let cursor = -1;
  for (const pattern of patterns) {
    const found = names.findIndex((name, index) => index > cursor && pattern.test(name));
    if (found < 0) return { pass: false, names };
    cursor = found;
  }
  return { pass: true, names };
}

function collectStages(plan) {
  return [
    ...(Array.isArray(plan?.stages) ? plan.stages : []),
    ...(Array.isArray(plan?.bootstrapStages) ? plan.bootstrapStages : []),
    ...(Array.isArray(plan?.events) ? plan.events : []),
    ...(Array.isArray(plan?.lifecycle) ? plan.lifecycle : []),
    ...(Array.isArray(plan?.stageOrder) ? plan.stageOrder : []),
  ];
}

function noFableSelection(value) {
  if (!value || typeof value !== 'object') return true;
  for (const [key, item] of Object.entries(value)) {
    if (/executor|selectedTier|actualTier|recommendedTier|model/i.test(key) && /fable/i.test(String(item))) return false;
    if (typeof item === 'object' && !noFableSelection(item)) return false;
  }
  return true;
}

async function invokeBootstrap(entry, root, objective, eventFile, mode = 'shadow') {
  if (entry[0] === 'runDevStartBootstrap') {
    const result = await entry[1]([
      '--json', '--host', 'test', '--session-id', `sess-${mode}`, '--task-id', '350', objective,
    ], root);
    return result?.plan ?? result;
  }
  return entry[1]({
    root,
    objective,
    requestId: `req-${mode}`,
    sessionId: `sess-${mode}`,
    taskId: '350',
    now: 1_750_000_000_000,
    eventFile,
    eventsFile: eventFile,
    logFile: eventFile,
    routing: { enabled: true, mode, minLevel: 4, canaryPct: 100, runnerFirstMaxCommands: 3 },
  });
}

async function main() {
  console.log('\n🧪 AEP-W4 automatic /dev-start economy integration\n');

  let bootMod; let lifeMod; let eventMod; let routeMod; let classifyMod; let routingEconomicsMod;
  try {
    [bootMod, lifeMod, eventMod, routeMod, classifyMod, routingEconomicsMod] = await Promise.all([
      import(pathToFileURL(BOOT).href),
      import(pathToFileURL(LIFE).href),
      import(pathToFileURL(EVENTS).href),
      import(pathToFileURL(ROUTE).href),
      import(pathToFileURL(CLASSIFY).href),
      import(pathToFileURL(ROUTING_ECONOMICS).href),
    ]);
    ok('bootstrap, lifecycle, event and routing modules import');
  } catch (err) {
    bad(`module import failed: ${err?.message ?? err}`);
    process.exit(1);
  }

  const bootstrap = pickEntry(bootMod, ['devStartBootstrap', 'bootstrapDevStart', 'runDevStartBootstrap', 'buildDevStartBootstrap']);
  const readEvents = pick(eventMod, ['readEconomyEvents', 'readEvents']);
  const eventsFileFor = pick(eventMod, ['economyEventsFile', 'eventsFileFor', 'economyEventFile', 'eventFileFor']);
  check(Boolean(bootstrap), 'bootstrap entrypoint is exported');
  check(Boolean(readEvents), 'economy event reader is exported');
  check(Boolean(lifeMod), 'economy lifecycle module is present');
  if (!bootstrap || !readEvents) process.exit(1);

  const root = fixture();
  try {
    const eventFile = eventsFileFor
      ? eventsFileFor(root)
      : resolve(root, 'contextkit', 'memory', 'economy-events.jsonl');
    const objective = 'update targetEconomy in src/economy-target.mjs';
    const fresh = await invokeBootstrap(bootstrap, root, objective, eventFile);
    const freshEvents = await readEvents(eventFile);
    await invokeBootstrap(bootstrap, root, objective, eventFile);
    const repeatedEvents = await readEvents(eventFile);
    const planOrder = ordered(collectStages(fresh), [
      /objective/i,
      /resume|checkpoint/i,
      /project.?map|map/i,
      /intake|classif/i,
      /orchestrat|request/i,
      /context.*(expand|pack|profile)|ready/i,
    ]);
    check(planOrder.pass, 'bootstrap plan evaluates map before context expansion', planOrder.names.join(' → '));
    const eventOrder = ordered(freshEvents, [
      /objective/i,
      /resume|checkpoint/i,
      /project.?map|map/i,
      /intake|classif/i,
      /orchestrat|request/i,
    ]);
    check(freshEvents.length > 0 && eventOrder.pass, 'persisted bootstrap events keep the expected order',
      eventOrder.names.join(' → ') || 'no persisted events');

    check(repeatedEvents.length === freshEvents.length,
      'repeated bootstrap is idempotent for the same request and stage set');
    const serialized = json({ fresh, freshEvents });
    const objectiveAt = serialized.search(/objective/i);
    const classifyAt = serialized.search(/classif/i);
    check(objectiveAt >= 0 && classifyAt > objectiveAt, 'objective is resolved before classification');
    check(!serialized.includes(objective), 'telemetry stores an objective fingerprint, not raw objective text');
    check(/project.?map/i.test(serialized) && /hit|fresh|matched|found/i.test(serialized),
      'fresh Project Map produces an explicit hit/fresh reason');
    check(/run-compact/i.test(serialized), 'bootstrap emits run-compact lifecycle or execution hint');
    check(/shadow_mode/.test(serialized) && !/"applied"\s*:\s*true/.test(serialized),
      'shadow routing records shadow_mode and no applied claim');
    check(noFableSelection({ fresh, freshEvents }), 'bootstrap never selects Fable');

    const missFile = resolve(root, 'contextkit', 'memory', 'economy-events-miss.jsonl');
    const miss = await invokeBootstrap(bootstrap, root, 'inspect src/missing-quantum-pineapple.mjs', missFile);
    check(/miss|not_found|no_match|unavailable/i.test(json(miss)), 'Project Map miss has an explicit reason');

    appendFileSync(resolve(root, 'src', 'economy-target.mjs'), 'export const changedAfterMap = true;\n');
    const staleFile = resolve(root, 'contextkit', 'memory', 'economy-events-stale.jsonl');
    const stale = await invokeBootstrap(bootstrap, root, objective, staleFile);
    check(/stale|signature_mismatch|outdated/i.test(json(stale)), 'stale Project Map has an explicit reason');

    const cfg = { mode: 'active', runnerFirstMaxCommands: 3, allowAutomaticFable: false };
    const mechanical = classifyMod.classifyTask({ kind: 'shell' }, cfg);
    const unknownFacts = routeMod.decideRoute(mechanical, {}, cfg);
    const explicitFacts = routeMod.decideRoute(mechanical, {
      commandCount: 1,
      expectedOutput: 'short',
      needsInterpretation: false,
      batch: false,
    }, cfg);
    check(unknownFacts.runnerFirst === false && unknownFacts.executor !== 'runner',
      'runner-first is ineligible when command facts are unknown');
    check(explicitFacts.runnerFirst === true && explicitFacts.executor === 'runner',
      'runner-first activates only with explicit deterministic command facts');
    const injectedFable = routeMod.decideRoute({ complexity: 'complex', risk: 'high', executor: 'fable' }, {}, cfg);
    check(injectedFable.executor !== 'fable', 'routing defensively blocks automatic Fable');
    const reasonSummary = routingEconomicsMod.analyzeDecisionRecords([
      { mode: 'shadow', applied: false, reasonCodes: ['shadow_mode', 'runner_command_facts_missing'] },
    ]);
    check(reasonSummary.reasons.some((entry) => entry.reason === 'runner_command_facts_missing'),
      'routing economics retains reasonCodes from lifecycle telemetry');

    const emptyTranscripts = resolve(root, 'empty-transcripts');
    mkdirSync(emptyTranscripts, { recursive: true });
    const reportRaw = execFileSync(process.execPath, [TOKEN_REPORT, '--json', '--from', emptyTranscripts], {
      cwd: root,
      encoding: 'utf8',
    });
    const report = JSON.parse(reportRaw);
    const reportText = json(report);
    check(report.sessions === 0, 'Token Report fixture has an empty transcript set');
    check(/economy/i.test(reportText) && /lifecycle|shadow_mode|cdk-economy-event\/1/i.test(reportText),
      'Token Report still emits economy lifecycle sections with no transcript usage');

    check(existsSync(eventFile), 'bootstrap persists lifecycle events to the canonical ledger');
    const validBeforeMalformed = existsSync(eventFile) ? readFileSync(eventFile, 'utf8') : '';
    writeFileSync(eventFile, `${validBeforeMalformed}{ malformed event\n`);
    let malformedRead = [];
    try { malformedRead = await readEvents(eventFile); } catch (err) { bad(`malformed event broke reader: ${err?.message ?? err}`); }
    check(malformedRead.length === freshEvents.length, 'malformed lifecycle events fail-open without losing valid events');
  } catch (err) {
    bad(`integration crashed: ${err?.stack ?? err}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  console.log(failures === 0 ? '\n✅ AEP-W4 integration passed.\n' : `\n❌ ${failures} AEP-W4 integration check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
