/**
 * Self-check suite for WF-0065 — Native Lifecycle Orchestration
 * (ADR-0128 §14/§15/§17). Validates the invariants the kit must never regress:
 * the SessionStart readiness probe produces ready / packet-missing / degraded /
 * disabled states without ever dispatching an agent (§14), the UserPromptSubmit
 * directive is emitted only for a real code obligation and stays silent for
 * no-code/degraded (§15), the subagent spawn-record evidence distinguishes
 * planned vs dispatched vs completed — an agent named in a prompt never counts
 * (§17) — the PreCompact domain journey round-trips, and every lifecycle
 * function is fail-open (immutable rule 2). Wired into `tools/selfcheck.mjs`.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const RT = 'templates/contextkit/runtime/domain-engineering';
const HOOKS = 'templates/contextkit/runtime/hooks';

/**
 * @param {{ ok: Function, bad: Function }} report
 * @param {{ KIT: string }} ctx
 */
export async function runDomainLifecycleChecks({ ok, bad }, { KIT }) {
  console.log('Checking WF-0065 native lifecycle orchestration...');
  const imp = async (rel) => import(pathToFileURL(resolve(KIT, RT, rel)).href);
  const TPL = resolve(KIT, 'templates'); // policy tables live under templates/contextkit/policy

  let readiness; let directive; let spawn; let journey;
  try {
    readiness = await imp('readiness.mjs');
    directive = await imp('directive.mjs');
    spawn = await imp('spawn-record.mjs');
    journey = await imp('journey.mjs');
    ok('domain-engineering lifecycle modules import cleanly');
  } catch (err) {
    bad(`lifecycle import failed: ${err?.message ?? err}`);
    return;
  }

  checkReadiness(readiness, TPL, { ok, bad });
  checkDirective(directive, { ok, bad });
  checkSpawnRecords(spawn, { ok, bad });
  checkContinuity(journey, { ok, bad });
  checkNoDispatch(readiness, spawn, { ok, bad });
  checkFailOpen(readiness, directive, spawn, journey, { ok, bad });
  checkHooksExitZero(KIT, { ok, bad });
  await checkPackaging(readiness, KIT, { ok, bad });
}

/** §14 — readiness probe fixtures: ready / packet-missing / degraded / disabled. */
function checkReadiness({ checkDomainEngineeringReadiness, buildReadinessState, renderReadinessBanner }, TPL, { ok, bad }) {
  const on = { enabled: true, sessionStartReadiness: true };

  const ready = checkDomainEngineeringReadiness(TPL, { config: on });
  ready.status === 'ready' && ready.enabled === true && ready.missingCapabilities.length === 0
    ? ok('readiness fixture: policies present + enabled ⇒ ready') : bad(`ready fixture wrong: ${JSON.stringify(ready)}`);

  const packetMissing = checkDomainEngineeringReadiness(TPL, { config: on, pending: { pendingImplementationPacket: true } });
  packetMissing.status === 'packet-missing'
    ? ok('readiness fixture: pending packet ⇒ packet-missing') : bad(`packet-missing fixture wrong: ${packetMissing.status}`);

  const tmp = mkdtempSync(join(tmpdir(), 'wf65-rd-'));
  try {
    const degraded = checkDomainEngineeringReadiness(tmp, { config: on });
    degraded.status === 'degraded' && degraded.missingCapabilities.length > 0
      ? ok('readiness fixture: no policy tables ⇒ degraded (never a false ready)') : bad(`degraded fixture wrong: ${JSON.stringify(degraded)}`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }

  const disabled = checkDomainEngineeringReadiness(TPL, { config: null });
  disabled.status === 'disabled' && disabled.enabled === false
    ? ok('readiness fixture: default-off config ⇒ disabled') : bad(`disabled fixture wrong: ${disabled.status}`);
  renderReadinessBanner(disabled) === '' ? ok('disabled readiness renders no banner (non-adopting project silent)') : bad('disabled state must render no banner');

  // Pure ladder is default-refuse: only a fully-installed, gap-free state is ready.
  const pure = buildReadinessState({ enabled: true, sessionStartReadiness: true, missingCapabilities: ['x'] });
  pure.status === 'degraded' ? ok('buildReadinessState: a missing capability blocks ready') : bad('missing capability must degrade, not pass');
}

/** §15 — directive emission: code obligation only; silent for no-code/degraded. */
function checkDirective({ extendExecutionContract }, { ok, bad }) {
  extendExecutionContract(null) === '' ? ok('directive: no envelope ⇒ silent') : bad('directive should be silent without an envelope');

  const noCode = extendExecutionContract({ requestId: 'r', implementation: { profile: 'no-code', squadRequired: false } });
  noCode === '' ? ok('directive: no-code profile ⇒ silent (§15)') : bad('no-code profile must emit no directive');

  const code = extendExecutionContract({
    requestId: 'r1', context: { businessId: 'BIZ-0003' },
    implementation: { profile: 'domain-driven', squadRequired: true, requiredAgents: ['implementation-engineer'], requiredSkills: ['ddd'], requiredArtifacts: ['implementation-packet'] },
  });
  code.includes('‹CONTEXTKIT-IMPLEMENTATION') && code.includes('implementation-engineer') && code.includes('implementation-packet') && code.includes('owner=BIZ-0003')
    ? ok('directive: code obligation ⇒ machine-readable directive with agents/skills/artifacts (§15)') : bad(`code directive malformed: ${code}`);
  code.includes('named in a prompt does NOT count')
    ? ok('directive carries the §17 evidence ruling reminder') : bad('directive should carry the evidence-ruling note');

  const degraded = extendExecutionContract({ requestId: 'r', implementation: { degraded: true } });
  degraded.includes('status=degraded') && !degraded.includes('required agents')
    ? ok('directive: degraded block ⇒ advisory note, no obligation (§15)') : bad(`degraded directive wrong: ${degraded}`);
}

/** §17 — planned-vs-dispatched-vs-completed evidence; named-only never counts. */
function checkSpawnRecords({ compareSpawn, recordSpawn, recordSpawnStop, summarizeSpawnEvidence }, { ok, bad }) {
  const named = compareSpawn({ planned: ['ie'], dispatched: [], completed: [] });
  !named.satisfied && named.plannedNotDispatched.length === 1
    ? ok('spawn: an agent named/planned but never dispatched never satisfies (§17 evidence ruling)') : bad(`named-only wrongly satisfied: ${JSON.stringify(named)}`);

  const dispatchedOnly = compareSpawn({ planned: ['ie'], dispatched: ['ie'], completed: [] });
  !dispatchedOnly.satisfied && dispatchedOnly.reasonCodes.includes('SPAWN_DISPATCHED_NOT_COMPLETED')
    ? ok('spawn: dispatched without completion never satisfies (§17)') : bad('dispatched-only must not satisfy');

  const full = compareSpawn({ planned: ['a', 'b'], dispatched: ['a', 'b', 'x'], completed: ['a', 'b'] });
  full.satisfied && full.extraneous.join(',') === 'x'
    ? ok('spawn: all planned completed ⇒ satisfied; extra dispatch flagged, not fatal') : bad(`full-satisfy wrong: ${JSON.stringify(full)}`);

  const tmp = mkdtempSync(join(tmpdir(), 'wf65-sp-'));
  try {
    recordSpawn(tmp, { taskId: 'T', agent: 'ie', packetId: 'p1', spawnId: 's1', at: 1 });
    let ev = summarizeSpawnEvidence(tmp, 'T', ['ie']);
    !ev.satisfied ? ok('spawn round-trip: dispatched, not yet completed ⇒ unsatisfied') : bad('pre-stop must be unsatisfied');
    const stop = recordSpawnStop(tmp, { taskId: 'T', agent: 'ie', receiptRef: 'reports/agents/T.json', at: 2 });
    ev = summarizeSpawnEvidence(tmp, 'T', ['ie']);
    stop.persisted && ev.satisfied ? ok('spawn round-trip: completion stamp ⇒ satisfied with a real receipt ref') : bad(`post-stop wrong: ${JSON.stringify(ev)}`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/** PreCompact — the domain journey round-trips (build → render). */
function checkContinuity({ buildDomainJourney, renderDomainJourneyLine }, { ok, bad }) {
  buildDomainJourney({ readiness: null }) === null
    ? ok('continuity: no readiness state ⇒ no journey (non-adopting session silent)') : bad('null readiness must yield no journey');

  const j = buildDomainJourney({
    readiness: { pendingImplementationPacket: true },
    implementation: { profile: 'modular', requiredAgents: ['ie'] },
    spawnEvidence: { satisfied: false, plannedNotDispatched: ['ie'], dispatchedNotCompleted: [] },
  });
  j && j.activeProfile === 'modular' && j.pendingImplementationPacket && j.spawnSatisfied === false
    ? ok('continuity: journey preserves profile + pending packet + squad gap') : bad(`journey shape wrong: ${JSON.stringify(j)}`);

  const line = renderDomainJourneyLine(j);
  line.includes('profile modular') && line.includes('packet pending') && line.includes('squad incomplete')
    ? ok('continuity: resume line surfaces the preserved journey') : bad(`resume line wrong: ${line}`);
  renderDomainJourneyLine(null) === '' ? ok('continuity: no journey ⇒ no resume line') : bad('null journey must render nothing');
}

/** §14 — SessionStart never dispatches an agent: the probe writes no spawn record. */
function checkNoDispatch({ checkDomainEngineeringReadiness }, { readSpawnRecords }, { ok, bad }) {
  const tmp = mkdtempSync(join(tmpdir(), 'wf65-nd-'));
  try {
    checkDomainEngineeringReadiness(tmp, { config: { enabled: true, sessionStartReadiness: true } });
    const subagentsDir = join(tmp, 'contextkit', 'pipeline', 'state');
    const noState = !existsSync(subagentsDir);
    const noRecords = readSpawnRecords(tmp, 'any-task').length === 0;
    noState && noRecords
      ? ok('no-request ⇒ no-dispatch: the readiness probe records zero spawns (§14)') : bad('readiness probe must never dispatch or record a spawn');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/** Immutable rule 2 — every lifecycle function is fail-open (never throws on garbage). */
function checkFailOpen(readiness, directive, spawn, journey, { ok, bad }) {
  try {
    readiness.checkDomainEngineeringReadiness(null, { config: 42 });
    directive.extendExecutionContract('garbage');
    directive.extendExecutionContract({ implementation: 'not-an-object' });
    spawn.recordSpawn(null, {});
    spawn.recordSpawnStop(null, { taskId: 'x' });
    spawn.compareSpawn(undefined);
    journey.buildDomainJourney(undefined);
    journey.renderDomainJourneyLine(123);
    ok('fail-open: every lifecycle function degrades on garbage input, never throws (rule 2)');
  } catch (err) {
    bad(`fail-open violated — a lifecycle function threw: ${err?.message ?? err}`);
  }
}

/** Immutable rule 2 — the modified hooks exit 0 even on malformed stdin. */
function checkHooksExitZero(KIT, { ok, bad }) {
  const tmp = mkdtempSync(join(tmpdir(), 'wf65-hk-'));
  const hooks = ['subagent-gate.mjs', 'compaction-continuity.mjs', 'execution-contract-hook.mjs'];
  try {
    let allZero = true;
    for (const name of hooks) {
      for (const input of ['not-json', '{"hook_event_name":"PreCompact"}']) {
        const code = runHook(resolve(KIT, HOOKS, name), tmp, input);
        if (code !== 0) { allZero = false; bad(`hook ${name} exited ${code} on input "${input}" (rule 2)`); }
      }
    }
    if (allZero) ok('lifecycle-extended hooks exit 0 on malformed + inert stdin (immutable rule 2)');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/**
 * LO4 packaging — the capability is advisory-by-default, host-neutral and
 * single-flag disablable. Guards the packaging invariants so they cannot
 * silently regress: (1) the lifecycle CORE modules import no host adapter (they
 * shape data; the HOOKS own host I/O), so every native host renders the same
 * evidence; (2) the default config is OFF and a single `enabled:false` flag
 * disables the whole capability; (3) an enabled-but-disabled readiness resolves
 * to `disabled` with an empty banner (advisory never blocks; hosts stay green).
 */
async function checkPackaging({ checkDomainEngineeringReadiness }, KIT, { ok, bad }) {
  const { readFileSync } = await import('node:fs');
  const CORE = ['readiness.mjs', 'directive.mjs', 'spawn-record.mjs', 'journey.mjs', 'config.mjs'];
  const leaks = CORE.filter((f) => {
    try { return /host-adapter/.test(readFileSync(resolve(KIT, RT, f), 'utf-8')); } catch { return false; }
  });
  leaks.length === 0
    ? ok('packaging: lifecycle core imports no host adapter — host-neutral, native hosts render identical evidence')
    : bad(`packaging: host coupling leaked into the core: ${leaks.join(', ')}`);

  const cfg = await import(pathToFileURL(resolve(KIT, RT, 'config.mjs')).href);
  cfg.DEFAULT_DOMAIN_ENGINEERING_CONFIG.enabled === false
    ? ok('packaging: capability is default-OFF (advisory-by-default; native hosts stay green disabled)')
    : bad('packaging: capability must default to disabled');

  // Single-flag disable: enabled:false ⇒ disabled regardless of sessionStartReadiness.
  const off = checkDomainEngineeringReadiness(resolve(KIT, 'templates'), { config: { enabled: false, sessionStartReadiness: true } });
  off.status === 'disabled' && off.enabled === false
    ? ok('packaging: a single enabled:false flag disables the capability (reversible disable path)')
    : bad(`packaging: enabled:false must disable, got ${off.status}`);
}

/** Spawns a hook with an injected cwd + stdin; returns its exit code (0 = fail-open). */
function runHook(hookPath, cwd, input) {
  try {
    execFileSync(process.execPath, [hookPath], { cwd, input, stdio: ['pipe', 'pipe', 'pipe'] });
    return 0;
  } catch (err) {
    return typeof err?.status === 'number' ? err.status : 1;
  }
}
