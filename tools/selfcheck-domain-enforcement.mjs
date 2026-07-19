/**
 * Self-check suite for WF-0067 — Enforcement & Architectural Fitness (ADR-0128
 * §16/§19/§20/§23/§24/§29, ADR-0129). Regression guards: PreToolUse block-proof +
 * authoritative CMIS=100 (§5); fail-open allow-with-degraded-receipt (rule 2); 8
 * blocking fitness functions vs 6 OBSERVE_ONLY advisory (§24); Completion Gate
 * planned-vs-actual (§20); Project Map compare (§23); the staged cap (§29); the
 * false-block/false-pass negative matrix. Wired into `tools/selfcheck.mjs`.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const RT = 'templates/contextkit/runtime/domain-engineering';
const HOOKS = 'templates/contextkit/runtime/hooks';
const ARCH = 'templates/contextkit/tools/scripts/arch-debt';

/**
 * @param {{ ok: Function, bad: Function }} report
 * @param {{ KIT: string }} ctx
 */
export async function runDomainEnforcementChecks({ ok, bad }, { KIT }) {
  console.log('Checking WF-0067 enforcement & architectural fitness...');
  const impRt = async (rel) => import(pathToFileURL(resolve(KIT, RT, rel)).href);
  const impArch = async (rel) => import(pathToFileURL(resolve(KIT, ARCH, rel)).href);

  let codeGate; let conformance; let completion; let compare; let fitness;
  try {
    codeGate = await impRt('code-gate.mjs');
    conformance = await impRt('conformance.mjs');
    completion = await impRt('completion.mjs');
    compare = await impRt('project-map-compare.mjs');
    fitness = await impArch('domain-fitness.mjs');
    ok('WF-0067 enforcement modules import cleanly');
  } catch (err) {
    bad(`enforcement import failed: ${err?.message ?? err}`);
    return;
  }

  checkModeResolution(codeGate, { ok, bad });
  checkAuthoritativeFallback(codeGate, { ok, bad });
  checkBlockProof(codeGate, { ok, bad });
  checkFailOpenDegraded(codeGate, conformance, completion, compare, fitness, { ok, bad });
  checkConformance(conformance, { ok, bad });
  checkCompletion(completion, { ok, bad });
  checkProjectMapCompare(compare, { ok, bad });
  checkFitnessBlockingVsAdvisory(compare, fitness, { ok, bad });
  checkNegativeMatrix(codeGate, fitness, compare, { ok, bad });
  checkDispatchRequirement(codeGate, { ok, bad });
  await checkSubagentExemptionSeam(KIT, { ok, bad });
  checkHooksExitZero(KIT, { ok, bad });
  await checkPackaging(codeGate, KIT, { ok, bad });
}

/** §26/§29 — mode resolution is default-OFF (disabled ⇒ shadow), level-aware, staged-capped. */
function checkModeResolution({ resolveDomainMode, capMode }, { ok, bad }) {
  const off = resolveDomainMode(7, { enabled: false });
  off === 'shadow' ? ok('mode: disabled ⇒ shadow (default-OFF, zero authority)') : bad(`disabled should be shadow, got ${off}`);
  const on = { enabled: true, enforcement: { level4: 'advisory', level5: 'guarded', level6: 'guarded', level7: 'strict' } };
  resolveDomainMode(7, on) === 'strict' && resolveDomainMode(5, on) === 'guarded' && resolveDomainMode(4, on) === 'advisory'
    ? ok('mode: enabled ⇒ level→mode ladder (L4 advisory / L5-6 guarded / L7 strict)')
    : bad('mode ladder wrong when enabled');

  // §29 staged-rollout ceiling: rolloutStage may only LOWER the ladder-derived mode.
  const capped = { enabled: true, enforcement: { level7: 'strict', rolloutStage: 'advisory' } };
  resolveDomainMode(7, capped) === 'advisory'
    ? ok('staged-rollout: rolloutStage=advisory caps an L7-strict ladder to advisory (§29)') : bad(`staged cap failed: ${resolveDomainMode(7, capped)}`);
  const cappedShadow = { enabled: true, enforcement: { level7: 'strict', rolloutStage: 'shadow' } };
  resolveDomainMode(7, cappedShadow) === 'shadow' ? ok('staged-rollout: rolloutStage=shadow holds even L7 at shadow') : bad('shadow cap failed');
  // The cap can NEVER raise authority: a low ladder mode with a high cap stays low.
  capMode('advisory', 'strict') === 'advisory' ? ok('staged-rollout: a higher cap never RAISES a lower mode (floor-only, §29)') : bad('cap raised authority');
  capMode('guarded', null) === 'guarded' && capMode('guarded', 'bogus') === 'guarded' ? ok('staged-rollout: absent/invalid cap ⇒ no change') : bad('invalid cap changed the mode');
}

/** §5 — a real source write forces CMIS=100, overriding a textual no-code false negative. */
function checkAuthoritativeFallback({ evaluateCodeGate, authoritativeCmis }, { ok, bad }) {
  const cm = authoritativeCmis({ codeMutationIntentScore: 8, codeMutationVerdict: 'UNCERTAIN' }, { writeAttempt: true, pathClass: 'source-code', hardExcluded: false });
  cm.score === 100 && cm.authoritative === true
    ? ok('authoritative CMIS=100 on a real source write (§5)') : bad(`authoritative CMIS wrong: ${JSON.stringify(cm)}`);

  // A textual no-code block on a REAL source write must still be APPLICABLE (override).
  const v = evaluateCodeGate({ block: { profile: 'no-code', codeMutationIntentScore: 5 }, pathClass: 'source-code', mode: 'guarded', riskBand: 'high', writeAttempt: true, packetPresent: false, ownerPresent: true });
  v.applicability === 'APPLICABLE' && v.enforcement === 'BLOCK'
    ? ok('authoritative override: textual no-code + real source write ⇒ APPLICABLE + BLOCK (closes the false negative)')
    : bad(`authoritative override failed: ${JSON.stringify(v)}`);

  // No write attempt ⇒ textual CMIS passes through (not authoritative).
  const cm2 = authoritativeCmis({ codeMutationIntentScore: 8 }, { writeAttempt: false, pathClass: 'source-code' });
  cm2.authoritative === false && cm2.score === 8 ? ok('no write ⇒ textual CMIS passthrough (not authoritative)') : bad('passthrough wrong');
}

/** §16 — block-proof: a missing deterministic requirement blocks in guarded/high with a corrective. */
function checkBlockProof({ evaluateCodeGate }, { ok, bad }) {
  const base = { block: { profile: 'domain-driven', simulateImpactRequired: true }, pathClass: 'source-code', mode: 'guarded', riskBand: 'high', writeAttempt: true, ownerPresent: true };

  const packetMissing = evaluateCodeGate({ ...base, packetPresent: false, simulateImpactPresent: true });
  packetMissing.enforcement === 'BLOCK' && packetMissing.missing.includes('implementation-packet') && packetMissing.corrective.length > 0
    ? ok('block-proof: packet missing ⇒ BLOCK + corrective command') : bad(`packet-missing block failed: ${JSON.stringify(packetMissing)}`);

  const ownerMissing = evaluateCodeGate({ ...base, packetPresent: true, simulateImpactPresent: true, ownerPresent: false });
  ownerMissing.enforcement === 'BLOCK' && ownerMissing.missing.includes('owner')
    ? ok('block-proof: owner absent ⇒ BLOCK (real code write without an owner, Class A)') : bad(`owner-missing block failed: ${JSON.stringify(ownerMissing)}`);

  const simMissing = evaluateCodeGate({ ...base, packetPresent: true, simulateImpactPresent: false });
  simMissing.enforcement === 'BLOCK' && simMissing.missing.includes('simulate-impact')
    ? ok('block-proof: simulate-impact missing (profile requires it) ⇒ BLOCK') : bad(`simulate-impact block failed: ${JSON.stringify(simMissing)}`);

  // Trivial (low risk) passes with a receipt (WARN, not BLOCK) even with a missing packet.
  const trivial = evaluateCodeGate({ block: { profile: 'simple' }, pathClass: 'source-code', mode: 'guarded', riskBand: 'low', writeAttempt: true, packetPresent: false, ownerPresent: true });
  trivial.enforcement === 'WARN'
    ? ok('block-proof: guarded + trivial (low risk) passes with a receipt (WARN, never BLOCK)') : bad(`trivial should WARN, got ${trivial.enforcement}`);

  // All requirements satisfied ⇒ ALLOW.
  const okWrite = evaluateCodeGate({ block: { profile: 'simple', simulateImpactRequired: false }, pathClass: 'source-code', mode: 'strict', writeAttempt: true, packetPresent: true, ownerPresent: true });
  okWrite.enforcement === 'ALLOW' ? ok('block-proof: all requirements present ⇒ ALLOW') : bad(`satisfied write should ALLOW, got ${okWrite.enforcement}`);
}

/** §16 — fail-open: internal/degraded evaluation ⇒ allow-with-degraded-receipt, never a throw or false block. */
function checkFailOpenDegraded(codeGate, conformance, completion, compare, fitness, { ok, bad }) {
  const deg = codeGate.evaluateCodeGate({ block: { degraded: true }, pathClass: 'source-code', mode: 'strict', writeAttempt: true });
  deg.enforcement === 'DEGRADED' && deg.degraded === true
    ? ok('fail-open: degraded block ⇒ DEGRADED + ALLOW (allow-with-degraded-receipt, never a false pass/block)') : bad(`degraded path wrong: ${JSON.stringify(deg)}`);

  const explicitDeg = codeGate.evaluateCodeGate({ degradedInput: true, pathClass: 'source-code', mode: 'strict', writeAttempt: true });
  explicitDeg.enforcement === 'DEGRADED' ? ok('fail-open: degradedInput ⇒ DEGRADED') : bad('degradedInput not DEGRADED');

  try {
    codeGate.evaluateCodeGate(null);
    codeGate.evaluateCodeGate('garbage');
    codeGate.resolveDomainMode(NaN, 'nope');
    codeGate.authoritativeCmis(undefined, undefined);
    conformance.reconcileWrite(null);
    conformance.reconcileWrite('bad');
    completion.evaluateDomainCompletion(undefined);
    completion.obligationsForProfile(undefined, undefined);
    compare.compareDomainToProjectMap('x', 42);
    fitness.evaluateDomainFitness(null);
    fitness.domainFindingsFor('NOPE', undefined);
    ok('fail-open: every evaluator degrades on garbage input, never throws (rule 2)');
  } catch (err) {
    bad(`fail-open violated — an evaluator threw: ${err?.message ?? err}`);
  }
}

/** §19 — conformance drift grades by risk band. */
function checkConformance({ reconcileWrite }, { ok, bad }) {
  const within = reconcileWrite({ path: 'src/a.js', packet: { allowedPaths: ['src/**'] } });
  within.action === 'record' && within.drift.length === 0 ? ok('conformance: within touch-set ⇒ record (silent)') : bad(`within wrong: ${JSON.stringify(within)}`);

  const out = reconcileWrite({ path: 'other/x.js', packet: { allowedPaths: ['src/**'] } });
  out.action === 'require-packet-update' && out.riskBand === 'medium' ? ok('conformance: out-of-touch-set ⇒ require-packet-update / medium') : bad(`out wrong: ${JSON.stringify(out)}`);

  const forb = reconcileWrite({ path: 'secret/x.js', packet: { allowedPaths: ['src/**'], forbiddenPaths: ['secret/**'] } });
  forb.action === 'block-next-write' && forb.riskBand === 'high' ? ok('conformance: forbidden path ⇒ block-next-write / high') : bad(`forbidden wrong: ${JSON.stringify(forb)}`);

  const contract = reconcileWrite({ path: 'src/a.js', packet: { allowedPaths: ['src/**'], contractsToPreserve: ['api.v1'] }, contractsChanged: ['api.v1'] });
  contract.action === 'block-next-write' ? ok('conformance: preserved-contract change ⇒ block-next-write') : bad(`contract wrong: ${JSON.stringify(contract)}`);

  const noPacket = reconcileWrite({ path: 'src/a.js' });
  noPacket.action === 'record' && noPacket.drift.length === 0 ? ok('conformance: no packet ⇒ record (never a false positive)') : bad('no-packet should record');
}

/** §20 — Completion Gate planned-vs-actual: refuse without evidence, pass with it, no-code allows. */
function checkCompletion({ evaluateDomainCompletion, obligationsForProfile }, { ok, bad }) {
  Array.isArray(obligationsForProfile('no-code', {})) && obligationsForProfile('no-code', {}).length === 0
    ? ok('completion: no-code profile ⇒ zero obligations') : bad('no-code should have zero obligations');

  const noCode = evaluateDomainCompletion({ block: { profile: 'no-code' }, mode: 'strict' });
  noCode.decision === 'allow' && noCode.done === true
    ? ok('completion: no-code ⇒ allow immediately (dogfood regression: doc-only task needs no code QA/specialists/packet/tests)') : bad(`no-code completion wrong: ${JSON.stringify(noCode)}`);

  const full = { block: { profile: 'domain-driven', squadRequired: true, requiredAgents: ['architect', 'domain-modeler'] }, mode: 'guarded', acceptanceMet: true, testsGreen: true, architectureGatesSatisfied: true, evidenceRef: 'reports/x.md', receipt: { deviations: [] } };

  const noSpawn = evaluateDomainCompletion({ ...full, spawnEvidence: { satisfied: false } });
  noSpawn.decision === 'deny' && noSpawn.missing.includes('required-agents')
    ? ok('completion: required agents not completed ⇒ deny (a name in a prompt never counts)') : bad(`spawn-missing completion wrong: ${JSON.stringify(noSpawn)}`);

  const noReceipt = evaluateDomainCompletion({ ...full, spawnEvidence: { satisfied: true }, receipt: null });
  noReceipt.decision === 'deny' && noReceipt.missing.includes('implementation-receipt')
    ? ok('completion: no Implementation Receipt ⇒ deny') : bad(`receipt-absent completion wrong: ${JSON.stringify(noReceipt)}`);

  const critDev = evaluateDomainCompletion({ ...full, spawnEvidence: { satisfied: true }, receipt: { deviations: [{ kind: 'preserved-contract-changed' }] } });
  critDev.decision === 'deny' ? ok('completion: critical receipt deviation ⇒ deny (receipt invalid)') : bad(`critical-deviation completion wrong: ${JSON.stringify(critDev)}`);

  const allMet = evaluateDomainCompletion({ ...full, spawnEvidence: { satisfied: true } });
  allMet.decision === 'allow' && allMet.done === true ? ok('completion: every profile obligation met ⇒ allow') : bad(`all-met completion wrong: ${JSON.stringify(allMet)}`);
}

/** §23 — Project Map declared-vs-real comparison. */
function checkProjectMapCompare({ compareDomainToProjectMap }, { ok, bad }) {
  const empty = compareDomainToProjectMap(undefined, undefined);
  Object.values(empty).every((v) => Array.isArray(v) && v.length === 0)
    ? ok('project-map: absent declared map ⇒ empty conformance (default-OFF)') : bad('empty map should yield empty conformance');

  const declared = { contexts: [{ name: 'orders', path: 'src/orders', internalPaths: ['src/orders/internal'] }, { name: 'billing', path: 'src/billing' }], domainPaths: ['src/orders/domain'], infrastructurePaths: ['src/infra'], allowedRelations: [['orders', 'billing']] };

  const infra = compareDomainToProjectMap(declared, { edges: [{ from: 'src/orders/domain/o.js', to: 'src/infra/db.js' }] });
  infra.domainInfrastructureDependencies.length === 1 ? ok('project-map: domain→infrastructure import detected') : bad('domain→infra not detected');

  const boundary = compareDomainToProjectMap(declared, { edges: [{ from: 'src/billing/b.js', to: 'src/orders/internal/s.js' }] });
  boundary.boundedContextViolations.some((v) => /internals/.test(v.detail)) ? ok('project-map: forbidden import into a context\'s internals detected') : bad('boundary violation not detected');

  const cross = compareDomainToProjectMap(declared, { edges: [{ from: 'src/billing/b.js', to: 'src/orders/api.js' }] });
  cross.crossContextViolations.length >= 1 ? ok('project-map: disallowed cross-context relation detected') : bad('cross-context not detected');

  const allowed = compareDomainToProjectMap(declared, { edges: [{ from: 'src/orders/api.js', to: 'src/billing/api.js' }] });
  allowed.crossContextViolations.length === 0 ? ok('project-map: an ALLOWED relation is not flagged (no false positive)') : bad('allowed relation falsely flagged');
}

/** §24 — the eight fitness functions block deterministically; the six advisory stay OBSERVE_ONLY. */
function checkFitnessBlockingVsAdvisory({ compareDomainToProjectMap }, { evaluateDomainFitness }, { ok, bad }) {
  const conf = compareDomainToProjectMap(
    { contexts: [{ name: 'orders', path: 'src/orders' }], domainPaths: ['src/orders'], infrastructurePaths: ['src/infra'] },
    { edges: [{ from: 'src/orders/o.js', to: 'src/infra/db.js' }], semantic: { stateAuthorityConflicts: [{ path: 's' }], anemicModelSignals: [{ path: 'm' }], overComplexStructure: [{ path: 'c' }] } },
  );
  const findings = evaluateDomainFitness(conf);

  const infra = findings.find((f) => f.ruleId === 'DOMAIN_INFRASTRUCTURE_INDEPENDENCE');
  infra && infra.enforcement === 'BLOCKING' && infra.status === 'VIOLATION' && ['GRAPH_DERIVED', 'SCHEMA_DERIVED', 'DETERMINISTIC'].includes(infra.evidence.class)
    ? ok('fitness: DOMAIN_INFRASTRUCTURE_INDEPENDENCE ⇒ BLOCKING VIOLATION (deterministic-tier, Class A)') : bad(`infra fitness wrong: ${JSON.stringify(infra)}`);

  const state = findings.find((f) => f.ruleId === 'STATE_AUTHORITY_UNIQUENESS');
  state && state.enforcement === 'BLOCKING' && state.evidence.class === 'SCHEMA_DERIVED'
    ? ok('fitness: STATE_AUTHORITY_UNIQUENESS ⇒ BLOCKING SCHEMA_DERIVED (Class A)') : bad(`state fitness wrong: ${JSON.stringify(state)}`);

  const anemic = findings.find((f) => f.ruleId === 'POSSIBLE_ANEMIC_MODEL');
  anemic && anemic.enforcement === 'OBSERVE_ONLY' && anemic.status === 'OBSERVATION' && anemic.evidence.class === 'SEMANTIC'
    ? ok('fitness: POSSIBLE_ANEMIC_MODEL ⇒ OBSERVE_ONLY OBSERVATION (semantic, Class B — never a dogmatic block)') : bad(`anemic fitness wrong: ${JSON.stringify(anemic)}`);

  const complex = findings.find((f) => f.ruleId === 'OVER_COMPLEX_STRUCTURE');
  complex && complex.enforcement === 'OBSERVE_ONLY' ? ok('fitness: OVER_COMPLEX_STRUCTURE stays advisory (Class B)') : bad('over-complex should be advisory');
}

/**
 * The false-block / false-pass negative matrix (exit-gate requirement): Rule Class A
 * blocks deterministically; Rule Class B never auto-blocks; a non-code target never
 * blocks; a clean domain graph produces zero blocking findings.
 */
function checkNegativeMatrix({ evaluateCodeGate }, { evaluateDomainFitness }, { compareDomainToProjectMap }, { ok, bad }) {
  // false-block guard 1: a documentation write is NEVER blocked (any mode).
  const doc = evaluateCodeGate({ block: { profile: 'no-code' }, pathClass: 'documentation', mode: 'strict', writeAttempt: true });
  doc.applicability === 'NOT_APPLICABLE' && doc.enforcement === 'ALLOW'
    ? ok('negative: documentation write ⇒ NOT_APPLICABLE + ALLOW (never false-blocked, any mode)') : bad(`doc write false-blocked: ${JSON.stringify(doc)}`);

  // false-block guard 2: a hard-excluded (generated) path is never blocked.
  const gen = evaluateCodeGate({ block: { profile: 'domain-driven' }, pathClass: 'source-code', hardExcluded: true, mode: 'strict', writeAttempt: true, packetPresent: false, ownerPresent: false });
  gen.applicability === 'NOT_APPLICABLE' && gen.enforcement === 'ALLOW'
    ? ok('negative: hard-excluded/generated path ⇒ NOT_APPLICABLE + ALLOW') : bad(`generated path false-blocked: ${JSON.stringify(gen)}`);

  // false-block guard 3: advisory NEVER blocks even with everything missing.
  const adv = evaluateCodeGate({ block: { profile: 'domain-driven' }, pathClass: 'source-code', mode: 'advisory', riskBand: 'high', writeAttempt: true, packetPresent: false, ownerPresent: false });
  adv.enforcement === 'WARN' ? ok('negative: advisory mode never BLOCKs (Class B posture — WARN at most)') : bad(`advisory false-blocked: ${adv.enforcement}`);

  // false-pass guard: a clean declared domain graph produces zero blocking fitness findings.
  const clean = compareDomainToProjectMap({ contexts: [{ name: 'a', path: 'src/a' }], allowedRelations: [] }, { edges: [{ from: 'src/a/x.js', to: 'src/a/y.js' }] });
  const cleanBlocking = evaluateDomainFitness(clean).filter((f) => f.enforcement === 'BLOCKING');
  cleanBlocking.length === 0 ? ok('negative: a clean domain graph ⇒ zero blocking fitness findings (no false pass, no false block)') : bad(`clean graph produced blocking findings: ${JSON.stringify(cleanBlocking)}`);

  // Class B uncertainty ⇒ ASK, never auto-BLOCK.
  const uncertain = evaluateCodeGate({ block: { profile: 'simple' }, pathClass: 'unknown', mode: 'strict', writeAttempt: true, packetPresent: false, ownerPresent: false });
  uncertain.applicability === 'UNKNOWN' && uncertain.enforcement === 'ASK'
    ? ok('negative: uncertain classification ⇒ ASK (one question), never an auto-BLOCK (ADR-0129 §5)') : bad(`uncertain should ASK, got ${JSON.stringify(uncertain)}`);
}

/**
 * ADR-0142 (WF-0075) — the pre-write DISPATCH requirement. Proves the two-tier contract:
 * teeth only in domain-driven/distributed-domain; default-true never false-blocks; the
 * simple/modular scope-fix regression; and completion still owns the COMPLETED axis.
 */
function checkDispatchRequirement({ evaluateCodeGate }, { ok, bad }) {
  // A minimal APPLICABLE domain-driven block where only the dispatch axis can be missing.
  const dd = {
    block: { profile: 'domain-driven', squadRequired: true, requiredAgents: ['implementation-engineer', 'code-reviewer'] },
    pathClass: 'source-code', mode: 'strict', riskBand: 'high', writeAttempt: true,
    packetPresent: true, ownerPresent: true, simulateImpactPresent: true,
  };

  // (a) domain-driven + not-dispatched ⇒ BLOCK naming the outstanding agents.
  const notDispatched = evaluateCodeGate({ ...dd, requiredAgentsDispatched: false });
  notDispatched.enforcement === 'BLOCK'
    && notDispatched.missing.includes('required-agents')
    && notDispatched.reasonCodes.includes('CODE_GATE_AGENTS_NOT_DISPATCHED')
    && notDispatched.corrective.some((c) => c.includes('implementation-engineer'))
    ? ok('dispatch: domain-driven + not-dispatched ⇒ BLOCK, names the required agents (ADR-0142)')
    : bad(`dispatch not-dispatched failed: ${JSON.stringify(notDispatched)}`);

  // (b) dispatched ⇒ the requirement clears (ALLOW; required-agents not missing).
  const dispatched = evaluateCodeGate({ ...dd, requiredAgentsDispatched: true });
  dispatched.enforcement === 'ALLOW' && !dispatched.missing.includes('required-agents')
    ? ok('dispatch: domain-driven + dispatched ⇒ ALLOW (requirement satisfied)')
    : bad(`dispatch dispatched failed: ${JSON.stringify(dispatched)}`);

  // (c) default-true: omitting the flag is byte-identical to the pre-WF-0075 verdict.
  const omitted = evaluateCodeGate({ ...dd });
  omitted.enforcement === 'ALLOW' && !omitted.missing.includes('required-agents')
    ? ok('dispatch: omitted flag defaults true ⇒ no false block (fail-open default)')
    : bad(`dispatch default-true failed: ${JSON.stringify(omitted)}`);

  // (d) the scope-fix regression: simple/modular carry squadRequired:true from envelope-block,
  //     but the teeth must NOT apply — only domain-driven/distributed-domain.
  for (const profile of ['simple', 'modular']) {
    const scoped = evaluateCodeGate({
      block: { profile, squadRequired: true, requiredAgents: ['implementation-engineer'] },
      pathClass: 'source-code', mode: 'strict', riskBand: 'high', writeAttempt: true,
      packetPresent: true, ownerPresent: true, simulateImpactPresent: true,
      requiredAgentsDispatched: false,
    });
    !scoped.missing.includes('required-agents')
      ? ok(`dispatch: profile '${profile}' + squadRequired:true ⇒ dispatch teeth INERT (scope-fix regression)`)
      : bad(`dispatch scope-fix failed for '${profile}': ${JSON.stringify(scoped)}`);
  }

  // (e) distributed-domain is in scope (the other domain-shaped profile).
  const dist = evaluateCodeGate({
    block: { profile: 'distributed-domain', squadRequired: true, requiredAgents: ['architect'] },
    pathClass: 'source-code', mode: 'strict', riskBand: 'high', writeAttempt: true,
    packetPresent: true, ownerPresent: true, simulateImpactPresent: true,
    requiredAgentsDispatched: false,
  });
  dist.missing.includes('required-agents')
    ? ok('dispatch: distributed-domain is in scope (dispatch teeth apply)')
    : bad(`dispatch distributed-domain scope failed: ${JSON.stringify(dist)}`);
}

/**
 * ADR-0142 (WF-0075) — DIRECT test of the subagent-exemption seam, the ADR's own
 * "highest-risk correctness point" (a bug here = total deadlock OR trivial bypass).
 * Exercises the two exported hook helpers + the anti-deadlock composition. Immutable
 * rule 3: the seam ships WITH its test.
 */
async function checkSubagentExemptionSeam(KIT, { ok, bad }) {
  let hook;
  try {
    hook = await import(pathToFileURL(resolve(KIT, HOOKS, 'domain-code-gate.mjs')).href);
  } catch (err) {
    bad(`subagent-seam: hook import failed: ${err?.message ?? err}`);
    return;
  }
  const { isDispatchedSubagentCall, requiredAgentsDispatchedFor } = hook;
  if (typeof isDispatchedSubagentCall !== 'function' || typeof requiredAgentsDispatchedFor !== 'function') {
    bad('subagent-seam: helpers not exported (isDispatchedSubagentCall / requiredAgentsDispatchedFor)');
    return;
  }

  // isDispatchedSubagentCall — the exemption predicate, exhaustively + no-throw on malformed.
  isDispatchedSubagentCall({ agent_id: 'sub-1' }) === true
    ? ok('seam: agent_id present (non-empty string) ⇒ dispatched-subagent call (exempt)')
    : bad('seam: a real subagent call was not recognized');
  isDispatchedSubagentCall({}) === false
    ? ok('seam: no agent_id ⇒ main/orchestrator call (GATED — not exempt)')
    : bad('seam: a main-agent call was wrongly treated as a subagent (BYPASS risk)');
  let noThrow = true;
  for (const mal of [{ agent_id: 123 }, { agent_id: '' }, { agent_id: null }, null, undefined, 'x', 42]) {
    try {
      if (isDispatchedSubagentCall(mal) !== false) { noThrow = false; bad(`seam: malformed payload ${JSON.stringify(mal)} was treated as a subagent`); }
    } catch (err) { noThrow = false; bad(`seam: isDispatchedSubagentCall threw on ${JSON.stringify(mal)}: ${err?.message}`); }
  }
  if (noThrow) ok('seam: malformed/non-string agent_id ⇒ false, never throws (defensive typeof)');

  // The ANTI-DEADLOCK composition (mirrors the hook: subagent ⇒ true; else compute).
  const ddBlock = { profile: 'domain-driven', squadRequired: true, requiredAgents: ['implementation-engineer'] };
  const seam = (payload, root, taskId, block) =>
    (isDispatchedSubagentCall(payload) ? true : requiredAgentsDispatchedFor(root, taskId, block));
  // A dispatched subagent writing its OWN authorized work → exempt (true) even with ZERO dispatch evidence.
  seam({ agent_id: 'sub-9' }, KIT, 'task-none', ddBlock) === true
    ? ok('seam: anti-deadlock — a dispatched subagent write is EXEMPT even with zero dispatch evidence')
    : bad('seam: anti-deadlock FAILED — a dispatched subagent would be blocked (total deadlock)');
  // The main agent on the same evidence-less task → NOT exempt (the gate can still fire).
  seam({}, KIT, 'task-none', ddBlock) === false
    ? ok('seam: the main agent is NOT exempt on an evidence-less domain task (no bypass)')
    : bad('seam: the main agent was exempted — the exemption is a BYPASS');

  // requiredAgentsDispatchedFor — inert + honest-not-dispatched + malformed-no-throw + fail-open.
  requiredAgentsDispatchedFor(KIT, null, ddBlock) === true
    ? ok('seam: requiredAgentsDispatchedFor — no taskId ⇒ inert (true)')
    : bad('seam: no-taskId was not inert');
  requiredAgentsDispatchedFor(KIT, 'task-x', { requiredAgents: [] }) === true
    ? ok('seam: requiredAgentsDispatchedFor — empty requiredAgents ⇒ inert (true)')
    : bad('seam: empty-required was not inert');
  requiredAgentsDispatchedFor(KIT, 'task-absent-substrate', { requiredAgents: ['implementation-engineer'] }) === false
    ? ok('seam: absent substrate + required agents ⇒ not-dispatched (false) — the feature, not a false block')
    : bad('seam: absent-substrate honest behavior wrong');
  let feo = true;
  for (const b of [null, {}, { requiredAgents: 'oops' }, { requiredAgents: null }]) {
    try { if (requiredAgentsDispatchedFor(KIT, 'task-x', b) !== true) { feo = false; bad(`seam: malformed block ${JSON.stringify(b)} did not degrade to true`); } }
    catch (err) { feo = false; bad(`seam: requiredAgentsDispatchedFor threw on ${JSON.stringify(b)}: ${err?.message}`); }
  }
  if (feo) ok('seam: malformed block ⇒ true (fail-open), never throws');
}

/** Immutable rule 2 — the new + augmented hooks exit 0 on malformed + inert stdin. */
function checkHooksExitZero(KIT, { ok, bad }) {
  const tmp = mkdtempSync(join(tmpdir(), 'wf67-hk-'));
  const hooks = ['domain-code-gate.mjs', 'domain-conformance.mjs', 'completion-gate.mjs'];
  try {
    let allZero = true;
    for (const name of hooks) {
      for (const input of ['not-json', '{"tool_name":"Edit","tool_input":{}}', '']) {
        const code = runHook(resolve(KIT, HOOKS, name), tmp, input);
        if (code !== 0) { allZero = false; bad(`hook ${name} exited ${code} on input "${input}" (rule 2)`); }
      }
    }
    if (allZero) ok('enforcement hooks exit 0 on malformed + inert stdin (immutable rule 2)');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/**
 * Packaging — the enforcement CORE modules are host-neutral (no host adapter import;
 * the HOOKS own host I/O) and default-OFF (disabled ⇒ shadow ⇒ zero authority), so
 * native hosts render identical behaviour and stay green disabled.
 */
async function checkPackaging({ resolveDomainMode }, KIT, { ok, bad }) {
  const { readFileSync } = await import('node:fs');
  const CORE = ['code-gate.mjs', 'conformance.mjs', 'completion.mjs', 'project-map-compare.mjs'];
  const leaks = CORE.filter((f) => {
    try { return /host-adapter/.test(readFileSync(resolve(KIT, RT, f), 'utf-8')); } catch { return false; }
  });
  leaks.length === 0
    ? ok('packaging: enforcement core imports no host adapter — host-neutral')
    : bad(`packaging: host coupling leaked into the enforcement core: ${leaks.join(', ')}`);

  resolveDomainMode(7, undefined) === 'shadow' && resolveDomainMode(7, { enabled: false }) === 'shadow'
    ? ok('packaging: absent/disabled config ⇒ shadow (default-OFF; guarded flip is human-gated at G-EF4)')
    : bad('packaging: default is not shadow');
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
