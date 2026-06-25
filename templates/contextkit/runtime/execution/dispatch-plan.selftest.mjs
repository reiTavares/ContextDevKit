/**
 * dispatch-plan.selftest.mjs — Self-contained unit tests for dispatch-plan.mjs.
 * Run: node templates/contextkit/runtime/execution/dispatch-plan.selftest.mjs
 * Exit 0 on full pass; exit 1 on any failure. No external deps.
 */
import { buildDispatchPlan, reconcileDispatch } from './dispatch-plan.mjs';

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) { passed += 1; }
  else { failed += 1; console.error(`  FAIL: ${label}${detail ? ` — ${detail}` : ''}`); }
}

function finish() {
  const total = passed + failed;
  if (failed === 0) { console.log(`ok ${passed}/${total}`); process.exit(0); }
  else { console.error(`not ok — ${failed} failure(s) / ${total} assertions`); process.exit(1); }
}

// --- fixture helpers ---

function makeConfig({ executeDispatchPlan = true, autoDispatch = true } = {}) {
  return { orchestration: { executeDispatchPlan, specialists: { autoDispatch } } };
}

function makeShadowEnvelope(agentOverrides = {}) {
  return {
    requestId: 'req-001',
    dispatchPlanId: 'plan-001',
    routing: { mode: 'shadow', reasonCodes: ['grade=3'] },
    agents: {
      lead: 'agent-lead', council: ['agent-council-a'],
      scouts: ['agent-scout-x'], reviewers: ['agent-reviewer-1'],
      synthesizer: 'agent-synth', ...agentOverrides,
    },
  };
}

function makeActiveEnvelope(agentOverrides = {}) {
  return { ...makeShadowEnvelope(agentOverrides), routing: { mode: 'active', reasonCodes: ['grade=4'] } };
}

// --- group 1: shadow => willDispatch=false ---

{
  const plan = buildDispatchPlan(makeShadowEnvelope(), makeConfig());
  assert('shadow: willDispatch is false', plan.willDispatch === false);
  assert('shadow: gatedBy includes mode=shadow', plan.gatedBy.includes('mode=shadow'));
  assert('shadow: planId from dispatchPlanId', plan.planId === 'plan-001');
  assert('shadow: mode is shadow', plan.mode === 'shadow');
}

// --- group 2: active + all flags on => willDispatch=true ---

{
  const plan = buildDispatchPlan(makeActiveEnvelope(), makeConfig());
  assert('active+flags-on: willDispatch is true', plan.willDispatch === true);
  assert('active+flags-on: gatedBy is empty', plan.gatedBy.length === 0);
  assert('active+flags-on: mode is active', plan.mode === 'active');
}

// --- group 3: executeDispatchPlan=false => blocked ---

{
  const plan = buildDispatchPlan(makeActiveEnvelope(), makeConfig({ executeDispatchPlan: false }));
  assert('executeDispatchPlan=off: willDispatch is false', plan.willDispatch === false);
  assert('executeDispatchPlan=off: gatedBy includes flag', plan.gatedBy.includes('executeDispatchPlan=off'));
  assert('executeDispatchPlan=off: gatedBy has no mode=shadow', !plan.gatedBy.includes('mode=shadow'));
}

// --- group 4: autoDispatch=false => blocked ---

{
  const plan = buildDispatchPlan(makeActiveEnvelope(), makeConfig({ autoDispatch: false }));
  assert('autoDispatch=off: willDispatch is false', plan.willDispatch === false);
  assert('autoDispatch=off: gatedBy includes flag', plan.gatedBy.includes('autoDispatch=off'));
}

// --- group 5: step ordering lead->council->scouts->reviewers->synthesizer ---

{
  const env = makeActiveEnvelope({
    lead: 'lead-agent', council: ['council-a', 'council-b'],
    scouts: ['scout-1'], reviewers: ['rev-x', 'rev-y'], synthesizer: 'synth-z',
  });
  const plan = buildDispatchPlan(env, makeConfig());
  const roles = plan.steps.map((s) => s.role);
  const agents = plan.steps.map((s) => s.agent);
  const seqs = plan.steps.map((s) => s.seq);

  assert('steps: first role is lead', roles[0] === 'lead');
  assert('steps: last role is synthesizer', roles[roles.length - 1] === 'synthesizer');
  assert('steps: council precedes scouts', roles.indexOf('council') < roles.indexOf('scouts'));
  assert('steps: scouts precedes reviewers', roles.indexOf('scouts') < roles.indexOf('reviewers'));
  assert('steps: reviewers precede synthesizer', roles.indexOf('reviewers') < roles.indexOf('synthesizer'));
  assert('steps: seq 1-based monotonically increasing', seqs.every((s, i) => s === i + 1));
  assert('steps: lead-agent first', agents[0] === 'lead-agent');
  assert('steps: synth-z last', agents[agents.length - 1] === 'synth-z');
  assert('steps: total count 7', plan.steps.length === 7);
  assert('plannedAgents: no duplicates', plan.plannedAgents.length === new Set(plan.plannedAgents).size);
  assert('plannedAgents: lead is first', plan.plannedAgents[0] === 'lead-agent');
  assert('plannedAgents: synth is last', plan.plannedAgents[plan.plannedAgents.length - 1] === 'synth-z');
}

// --- group 6: reconcileDispatch missing / extra / matched ---

{
  const plan = buildDispatchPlan(makeActiveEnvelope({
    lead: 'alpha', council: ['beta'], scouts: [], reviewers: ['gamma'], synthesizer: null,
  }), makeConfig());

  const r1 = reconcileDispatch(plan, ['alpha', 'beta', 'gamma']);
  assert('reconcile: matched when all dispatched', r1.matched === true);
  assert('reconcile: no missing', r1.missing.length === 0);
  assert('reconcile: no extra', r1.extra.length === 0);

  const r2 = reconcileDispatch(plan, ['alpha', 'beta']);
  assert('reconcile: matched=false when missing', r2.matched === false);
  assert('reconcile: missing contains gamma', r2.missing.includes('gamma'));
  assert('reconcile: extra empty when only missing', r2.extra.length === 0);

  const r3 = reconcileDispatch(plan, ['alpha', 'beta', 'gamma', 'delta']);
  assert('reconcile: matched=false when extra', r3.matched === false);
  assert('reconcile: extra contains delta', r3.extra.includes('delta'));
  assert('reconcile: missing empty when only extra', r3.missing.length === 0);

  const r4 = reconcileDispatch(plan, ['alpha', 'delta']);
  assert('reconcile: matched=false when both', r4.matched === false);
  assert('reconcile: missing contains beta+gamma', r4.missing.includes('beta') && r4.missing.includes('gamma'));
  assert('reconcile: extra contains delta (both)', r4.extra.includes('delta'));
}

// --- group 7: shadow reconciliation contract ---

{
  const plan = buildDispatchPlan(makeShadowEnvelope(), makeConfig());
  const r = reconcileDispatch(plan, []);
  assert('shadow reconcile: planned non-empty', r.planned.length > 0);
  assert('shadow reconcile: dispatched empty', r.dispatched.length === 0);
  // matched=false is correct: nothing ran, so the gap is faithfully reported.
  assert('shadow reconcile: matched=false (gap exists)', r.matched === false);
  assert('shadow reconcile: missing equals planned', r.missing.length === r.planned.length);
}

// --- group 8: empty agents plan ---

{
  const emptyEnv = makeActiveEnvelope({ lead: null, council: [], scouts: [], reviewers: [], synthesizer: null });
  const plan = buildDispatchPlan(emptyEnv, makeConfig());
  assert('empty-agents: no steps', plan.steps.length === 0);
  assert('empty-agents: plannedAgents empty', plan.plannedAgents.length === 0);
  assert('empty-agents: willDispatch true with flags on', plan.willDispatch === true);

  const planShadow = buildDispatchPlan({ ...emptyEnv, routing: { mode: 'shadow' } }, makeConfig());
  assert('empty-agents+shadow: willDispatch false', planShadow.willDispatch === false);
}

// --- group 9: planId fallback when dispatchPlanId absent ---

{
  const env = { requestId: 'req-xyz', routing: { mode: 'shadow' }, agents: {} };
  const plan = buildDispatchPlan(env, makeConfig());
  assert('planId fallback: dispatch-<requestId>', plan.planId === 'dispatch-req-xyz');
}

// --- group 10: determinism + no mutation + frozen ---

{
  const env = makeActiveEnvelope();
  const cfg = makeConfig();
  const envClone = JSON.parse(JSON.stringify(env));
  const cfgClone = JSON.parse(JSON.stringify(cfg));

  const plan1 = buildDispatchPlan(env, cfg);
  const plan2 = buildDispatchPlan(env, cfg);

  assert('determinism: planId stable', plan1.planId === plan2.planId);
  assert('determinism: willDispatch stable', plan1.willDispatch === plan2.willDispatch);
  assert('determinism: steps length stable', plan1.steps.length === plan2.steps.length);
  assert('determinism: plannedAgents stable', JSON.stringify(plan1.plannedAgents) === JSON.stringify(plan2.plannedAgents));
  assert('no-mutation: envelope unchanged', JSON.stringify(env) === JSON.stringify(envClone));
  assert('no-mutation: config unchanged', JSON.stringify(cfg) === JSON.stringify(cfgClone));
  assert('frozen: plan', Object.isFrozen(plan1));
  assert('frozen: gatedBy', Object.isFrozen(plan1.gatedBy));
  assert('frozen: steps', Object.isFrozen(plan1.steps));
  assert('frozen: plannedAgents', Object.isFrozen(plan1.plannedAgents));
}

// --- group 11: reconcile determinism + no mutation ---

{
  const plan = buildDispatchPlan(makeActiveEnvelope(), makeConfig());
  const dispatched = ['agent-lead', 'agent-council-a'];
  const dispatchedClone = [...dispatched];

  const r1 = reconcileDispatch(plan, dispatched);
  const r2 = reconcileDispatch(plan, dispatched);

  assert('reconcile-determinism: matched stable', r1.matched === r2.matched);
  assert('reconcile-determinism: missing stable', JSON.stringify(r1.missing) === JSON.stringify(r2.missing));
  assert('reconcile-no-mutation: dispatched unchanged', JSON.stringify(dispatched) === JSON.stringify(dispatchedClone));
  assert('reconcile-frozen: result frozen', Object.isFrozen(r1));
}

// --- group 12: reasonCodes passthrough ---

{
  const env = { requestId: 'req-rc', routing: { mode: 'active', reasonCodes: ['grade=4', 'risk=high'] }, agents: { lead: 'x' } };
  const plan = buildDispatchPlan(env, makeConfig());
  assert('reasonCodes: grade=4 present', plan.reasonCodes.includes('grade=4'));
  assert('reasonCodes: all 2 codes preserved', plan.reasonCodes.length === 2);
}

finish();
