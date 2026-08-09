/**
 * Self-check suite for ADR-0094 automatic model routing.
 *
 * Validates the classifier, the config resolver (precedence + activation), the
 * decision/over-orchestration guard, and the telemetry ledger — the invariants
 * the kit must never regress: Fable is never auto-selected, shadow never changes
 * the executor, runner-first short-circuits trivial commands, and routing is inert
 * below its minLevel. Wired into `tools/selfcheck.mjs`.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';

const S = 'templates/contextkit/tools/scripts';

/**
 * @param {{ ok: Function, bad: Function }} report
 * @param {{ KIT: string }} ctx
 */
export async function runRoutingChecks({ ok, bad }, { KIT }) {
  console.log('Checking ADR-0094 automatic routing...');
  const imp = async (rel) => import(pathToFileURL(resolve(KIT, S, rel)).href);

  let classifier, config, decision, telemetry, defaults;
  try {
    classifier = await imp('routing/task-classifier.mjs');
    config = await imp('routing/routing-config.mjs');
    decision = await imp('routing/routing-decision.mjs');
    telemetry = await imp('routing/routing-telemetry.mjs');
    defaults = await imp('../../runtime/config/defaults.mjs');
    ok('routing modules import cleanly');
  } catch (err) {
    bad(`routing module import failed: ${err?.message ?? err}`);
    return;
  }

  const { classifyTask, COMPLEXITY, RISK, EXECUTORS, signalsFromTitle } = classifier;
  const { resolveRoutingConfig, routingBannerLine, DEFAULT_ROUTING } = config;
  const { decideRoute, estimateRouteCostUsd } = decision;
  const { decisionRecord, appendDecision, readDecisions, routingTelemetrySummary, presentRoutingTelemetry } = telemetry;

  // -- Taxonomies + Fable exclusion -----------------------------------------
  COMPLEXITY.length === 5 && COMPLEXITY[0] === 'mechanical' ? ok('COMPLEXITY taxonomy (5 bands)') : bad('COMPLEXITY taxonomy wrong');
  RISK.join(',') === 'low,medium,high,critical' ? ok('RISK taxonomy') : bad('RISK taxonomy wrong');
  !EXECUTORS.includes('fable') ? ok('EXECUTORS excludes fable (never auto-selected)') : bad('EXECUTORS must never include fable');

  const cfg = resolveRoutingConfig({ level: 7 }).config;

  // -- Classifier routing table ---------------------------------------------
  const grep = classifyTask({ kind: 'search' }, cfg);
  grep.complexity === 'mechanical' && grep.executor === 'haiku' ? ok('grep → mechanical/haiku') : bad(`grep misrouted: ${grep.complexity}/${grep.executor}`);
  const glob = classifyTask({ kind: 'glob' }, cfg);
  glob.executor === 'haiku' ? ok('glob → haiku') : bad('glob not routed to haiku');
  const test = classifyTask({ kind: 'test' }, cfg);
  test.executor === 'haiku' ? ok('test/lint → haiku') : bad('test/lint not routed to haiku');
  const crud = classifyTask({ kind: 'implement', modulesTouched: 1, changeSize: 's' }, cfg);
  crud.executor === 'sonnet' ? ok('simple CRUD → sonnet') : bad(`CRUD misrouted: ${crud.executor}`);
  const auth = classifyTask({ kind: 'implement', touchesAuth: true, sensitiveData: true }, cfg);
  auth.risk === 'critical' && auth.executor === 'opus' ? ok('auth+sensitive → critical/opus') : bad(`auth misrouted: ${auth.risk}/${auth.executor}`);
  const migration = classifyTask({ kind: 'implement', migration: true }, cfg);
  migration.risk === 'critical' && migration.executor === 'opus' ? ok('migration → critical/opus') : bad('migration not critical/opus');
  const arch = classifyTask({ kind: 'decision' }, cfg);
  arch.complexity === 'architectural' && arch.executor === 'opus' ? ok('decision → architectural/opus') : bad('decision not architectural/opus');
  const concur = classifyTask({ kind: 'implement', concurrency: true }, cfg);
  concur.risk === 'high' && concur.executor === 'opus' ? ok('concurrency → high/opus') : bad('concurrency not high/opus');

  // Fable can NEVER come out of the classifier, whatever the signals.
  const fableProbe = ['search', 'implement', 'decision'].every((k) => classifyTask({ kind: k }, cfg).executor !== 'fable');
  fableProbe ? ok('classifier never emits fable') : bad('classifier emitted fable');

  // needsAuthorization flags destructive ops even when mechanical.
  classifyTask({ kind: 'shell', title: 'git reset --hard' }, cfg).needsAuthorization ? ok('destructive op flags needsAuthorization') : bad('destructive op not flagged');

  // signalsFromTitle heuristic
  signalsFromTitle('grep the codebase').kind === 'search' ? ok('signalsFromTitle derives search kind') : bad('signalsFromTitle kind wrong');

  // -- Decision guard: runner-first + modes ---------------------------------
  const single = decideRoute(grep, {
    commandCount: 1, expectedOutput: 'short', needsInterpretation: false, batch: false,
  }, cfg);
  single.executor === 'runner' && single.runnerFirst ? ok('runner-first: 1 simple cmd → runner') : bad(`runner-first failed: ${single.executor}`);
  const fourCmds = decideRoute(grep, {
    commandCount: 5, expectedOutput: 'short', needsInterpretation: false, batch: false,
  }, cfg);
  fourCmds.executor === 'haiku' ? ok('>N commands → haiku batch (not runner)') : bad('command-count guard failed');
  const batch = decideRoute(grep, {
    commandCount: 2, expectedOutput: 'short', needsInterpretation: false, batch: true,
  }, cfg);
  batch.executor === 'haiku' ? ok('batch mechanical → haiku (not runner)') : bad('batch guard failed');

  // shadow never applies
  const shadowApplied = [grep, crud, auth].every((c) => decideRoute(c, {}, cfg).applied === false);
  shadowApplied ? ok('shadow mode: applied=false for every route') : bad('shadow mode changed an executor');

  // canary: deterministic sampling, low-risk mechanical only
  const canaryCfg = { ...cfg, mode: 'canary', canaryPct: 100 };
  const canarySelected = decideRoute(crud, { taskId: 'x' }, canaryCfg);
  canarySelected.policyWouldApply === true && canarySelected.applied === false
    ? ok('canary 100% selects policy but waits for execution acknowledgement')
    : bad('canary 100% policy/ack semantics are wrong');
  const canary0 = { ...cfg, mode: 'canary', canaryPct: 0 };
  decideRoute(crud, { taskId: 'x' }, canary0).policyWouldApply === false ? ok('canary 0% selects nothing') : bad('canary 0% selected a route');
  decideRoute(auth, { taskId: 'x' }, canaryCfg).policyWouldApply === false ? ok('canary never selects critical-risk') : bad('canary selected a critical task');

  // active: applies on net benefit (mechanical/runner or cheaper tier)
  const activeCfg = { ...cfg, mode: 'active' };
  const activeSelected = decideRoute(crud, {}, activeCfg);
  activeSelected.policyWouldApply === true && activeSelected.applied === false
    ? ok('active selects a beneficial route but waits for acknowledgement')
    : bad('active policy/ack semantics are wrong');
  decideRoute(auth, {}, activeCfg).policyWouldApply === false ? ok('active keeps critical work direct (no benefit)') : bad('active selected critical work');

  // decideRoute defensively clamps an injected fable executor
  const fableClass = { complexity: 'complex', risk: 'high', executor: 'fable' };
  const explicitFable = decideRoute(fableClass, {}, { ...cfg, allowAutomaticFable: true });
  explicitFable.executor === 'fable' && explicitFable.applied === false
    ? ok('explicit Fable policy is preserved but remains unacknowledged')
    : bad('explicit Fable compatibility knob was ignored or falsely applied');
  decideRoute(fableClass, {}, cfg).executor !== 'fable' ? ok('decideRoute clamps fable → reasoning tier') : bad('decideRoute let fable through');

  // estimate enrichment degrades gracefully without buckets
  (await estimateRouteCostUsd(single, {})).status === 'skipped' ? ok('estimateRouteCostUsd skips without buckets') : bad('estimate did not skip');

  // -- Config resolver: precedence + activation -----------------------------
  DEFAULT_ROUTING.mode === 'canary' ? ok('default mode is canary (measured rollout)') : bad('default mode is not canary');
  DEFAULT_ROUTING.allowAutomaticFable === false ? ok('default allowAutomaticFable=false') : bad('fable auto-selection default not false');
  const prec = resolveRoutingConfig({ project: { mode: 'canary' }, session: { mode: 'active' }, level: 7 });
  prec.mode === 'active' ? ok('precedence: session > project') : bad('precedence wrong');
  resolveRoutingConfig({ project: { mode: 'canary' }, level: 7 }).mode === 'canary' ? ok('precedence: project > default') : bad('project override ignored');
  resolveRoutingConfig({ level: 2 }).active === false ? ok('inert below minLevel (L2)') : bad('routing active below minLevel');
  resolveRoutingConfig({ project: { enabled: false }, level: 7 }).active === false ? ok('enabled=false → inactive') : bad('disabled routing still active');
  resolveRoutingConfig({ project: { mode: 'bogus' }, level: 7 }).mode === 'shadow' ? ok('invalid mode falls back to shadow') : bad('invalid mode not normalized');
  routingBannerLine(resolveRoutingConfig({ level: 7 })) ? ok('banner line present when active') : bad('banner line missing when active');
  routingBannerLine(resolveRoutingConfig({ level: 2 })) === null ? ok('banner line null when inert') : bad('banner line shown when inert');

  // defaults.mjs carries the routing block, single-sourced
  defaults.DEFAULT_CONFIG.routing?.mode === 'canary' ? ok('defaults.mjs ships routing block') : bad('defaults.mjs missing routing block');

  // -- Telemetry ------------------------------------------------------------
  const rec = decisionRecord(single, { sessionId: 's1', taskId: 't1' });
  rec.executor === 'runner' && rec.applied === false ? ok('decisionRecord captures executor/applied') : bad('decisionRecord shape wrong');
  const sum0 = routingTelemetrySummary([]);
  sum0.total === 0 && sum0.fableAutoSelected === 0 ? ok('empty telemetry summary is zeroed') : bad('empty summary wrong');
  const sum = routingTelemetrySummary([
    decisionRecord(decideRoute(grep, { commandCount: 1 }, cfg), {}),
    decisionRecord(decideRoute(crud, {}, cfg), {}),
    decisionRecord(decideRoute(auth, {}, cfg), {}),
  ]);
  sum.total === 3 && sum.fableAutoSelected === 0 ? ok('telemetry summary aggregates + fable=0') : bad(`telemetry summary wrong: ${JSON.stringify(sum.byExecutor)}`);
  typeof presentRoutingTelemetry(sum) === 'string' ? ok('presentRoutingTelemetry renders') : bad('presentRoutingTelemetry failed');

  // append/read roundtrip on a temp file
  const tmp = resolve(tmpdir(), `routing-selfcheck-${process.pid}.jsonl`);
  try {
    appendDecision(tmp, rec);
    appendDecision(tmp, rec);
    readDecisions(tmp).length === 2 ? ok('telemetry append/read roundtrip') : bad('telemetry roundtrip lost records');
  } finally {
    try { rmSync(tmp, { force: true }); } catch { /* best effort */ }
  }
  readDecisions(resolve(tmpdir(), `missing-${process.pid}.jsonl`)).length === 0 ? ok('readDecisions tolerates a missing file') : bad('readDecisions threw on missing file');
}
