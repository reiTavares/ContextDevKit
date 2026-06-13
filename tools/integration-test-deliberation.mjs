#!/usr/bin/env node
/**
 * ContextDevKit integration test — DELIBERATION council + gates (ADR-0070).
 *
 * Covers the contracts ADR-0070 locks:
 *   - deterministic lane classification (architecture is always the spine);
 *   - dynamic specialist council selection, padding to `min`, trimming to `max`,
 *     and the autoSelect-off legacy fallback;
 *   - the tiered research plan (cheap scouts, powerful verify, reasoning voices)
 *     and the ADR-0052 invariant that VOICES are never downgraded;
 *   - byte-stable plans (same question → same plan — no LLM-judge, rule 8);
 *   - the new autonomy areas resolve to `debate` at grade ≥ 3;
 *   - a real install carries the council script + fires the new-decision nudge.
 *
 * Run:  node tools/integration-test-deliberation.mjs   (exit 0 = healthy)
 */
import { join } from 'node:path';
import { installFixture, reporter } from './it-helpers.mjs';
import { DEFAULT_CONFIG } from '../templates/contextkit/runtime/config/defaults.mjs';
import { AREAS, resolveAutonomy } from '../templates/contextkit/runtime/config/resolve-autonomy.mjs';
import {
  buildPlan, classifyLanes, planResearch, selectCouncil,
} from '../templates/contextkit/tools/scripts/deliberation-council.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\n🗣️  ContextDevKit integration test — deliberation council + gates (ADR-0070)\n');

/** A config built on the real defaults with deliberations overrides merged in. */
const cfg = (delib = {}) => ({
  ...DEFAULT_CONFIG,
  deliberations: { ...DEFAULT_CONFIG.deliberations, ...delib },
});

// ---------------------------------------------------------------- classification
{
  const lanes = classifyLanes('Refactor the auth token schema and migrate the DB');
  lanes.includes('architecture') && lanes.includes('security')
    ? ok('classifyLanes: auth+migration → architecture + security')
    : bad(`classifyLanes wrong: ${JSON.stringify(lanes)}`);

  const bare = classifyLanes('Should we name it foo or bar?');
  bare.length === 1 && bare[0] === 'architecture'
    ? ok('classifyLanes: a bare question seats only the architecture spine')
    : bad(`classifyLanes spine wrong: ${JSON.stringify(bare)}`);

  const all = classifyLanes('feature scope: onboarding UX flow, security auth, conversion funnel, deepen existing');
  ['architecture', 'security', 'features', 'ux', 'growth'].every((l) => all.includes(l))
    ? ok('classifyLanes: a multi-domain question matches every relevant lane')
    : bad(`classifyLanes multi wrong: ${JSON.stringify(all)}`);
}

// ---------------------------------------------------------------- council selection
{
  const { members, scale } = selectCouncil('Add OAuth login and redesign onboarding UI for conversion', cfg());
  const agents = members.map((m) => m.agent);
  agents.includes('architect') && agents.includes('security') && agents.includes('ux-designer') && agents.includes('growth')
    ? ok('selectCouncil: relevant specialists are seated by name')
    : bad(`selectCouncil roster wrong: ${JSON.stringify(agents)}`);
  members.length >= scale.min && members.length <= scale.max
    ? ok(`selectCouncil: size ${members.length} within [${scale.min}, ${scale.max}]`)
    : bad(`selectCouncil size out of bounds: ${members.length} vs [${scale.min},${scale.max}]`);
  new Set(agents).size === agents.length
    ? ok('selectCouncil: no duplicate specialists')
    : bad(`selectCouncil has duplicates: ${JSON.stringify(agents)}`);
}

// padding up to min on a bare question
{
  const { members } = selectCouncil('foo or bar?', cfg());
  const agents = members.map((m) => m.agent);
  members.length >= 3 && new Set(agents).size === agents.length
    ? ok(`selectCouncil: bare question padded to min (${members.length} distinct voices)`)
    : bad(`selectCouncil padding wrong: ${JSON.stringify(agents)}`);
}

// trimming past a low max, spine survives
{
  const { members } = selectCouncil(
    'feature scope: onboarding UX flow, security auth, conversion funnel, deepen existing',
    cfg({ council: { autoSelect: true, min: 3, max: 3 } }),
  );
  const agents = members.map((m) => m.agent);
  members.length === 3 && agents.includes('architect') && agents.includes('security')
    ? ok('selectCouncil: trims to max while keeping the architecture+security spine')
    : bad(`selectCouncil trim wrong: ${JSON.stringify(agents)}`);
}

// autoSelect off → legacy flat roster
{
  const { autoSelect, members } = selectCouncil('anything', cfg({ voices: 4, council: { autoSelect: false, min: 3, max: 6 } }));
  !autoSelect && members.length === 4 && members.every((m) => m.agent === null)
    ? ok('selectCouncil: autoSelect off → 4 generic, unnamed positions (legacy fallback)')
    : bad(`selectCouncil legacy fallback wrong: ${autoSelect} ${JSON.stringify(members)}`);
}

// ---------------------------------------------------------------- tiered research
{
  const plan = planResearch(cfg());
  plan.tiered && plan.scouts.tier === 'fast' && plan.verify.tier === 'powerful'
    && plan.voices.tier === 'reasoning' && plan.synthesizer.tier === 'reasoning'
    ? ok('planResearch: scouts=fast · verify=powerful · voices+synth=reasoning (ADR-0070)')
    : bad(`planResearch tiers wrong: ${JSON.stringify(plan)}`);
  plan.scouts.model === 'haiku' && plan.verify.model === 'sonnet' && plan.voices.model === 'opus'
    ? ok('planResearch: tiers resolve to haiku/sonnet/opus via model-policy (ADR-0052)')
    : bad(`planResearch models wrong: ${JSON.stringify({ s: plan.scouts.model, v: plan.verify.model, vo: plan.voices.model })}`);

  const off = planResearch(cfg({ research: { tiered: false } }));
  off.tiered === false
    ? ok('planResearch: research.tiered=false disables the scout phase')
    : bad(`planResearch off wrong: ${JSON.stringify(off)}`);
}

// ---------------------------------------------------------------- buildPlan invariants
{
  const plan = buildPlan('Add OAuth login and redesign onboarding UI', { config: cfg() });
  plan.council.every((m) => m.tier === 'reasoning')
    ? ok('buildPlan: every voice argues at the reasoning tier — voices are never downgraded (ADR-0052)')
    : bad(`buildPlan downgraded a voice: ${JSON.stringify(plan.council)}`);

  const a = JSON.stringify(buildPlan('Same exact question about auth and ux', { config: cfg() }));
  const b = JSON.stringify(buildPlan('Same exact question about auth and ux', { config: cfg() }));
  a === b
    ? ok('buildPlan: deterministic — same question → byte-identical plan (rule 8)')
    : bad('buildPlan is non-deterministic');
}

// ---------------------------------------------------------------- autonomy gates
{
  const areasOk = AREAS.includes('feature-deliberation') && AREAS.includes('decision-deliberation');
  areasOk ? ok('AREAS: feature-deliberation + decision-deliberation registered (closed enum, ADR-0070)') : bad('AREAS missing the new deliberation areas');
  const active = { autonomy: { grade: 3 }, deliberations: { active: true } };
  const cells = [
    [resolveAutonomy('feature-deliberation', active).mode, 'debate', 'grade-3 feature-deliberation → debate'],
    [resolveAutonomy('decision-deliberation', active).mode, 'debate', 'grade-3 decision-deliberation → debate'],
    [resolveAutonomy('feature-deliberation', { autonomy: { grade: 2 }, deliberations: { active: true } }).mode, 'manual', 'grade-2 → manual'],
  ];
  const wrong = cells.filter(([got, want]) => got !== want);
  wrong.length === 0 ? ok('resolver: deliberation gates resolve to debate at grade ≥ 3') : bad(`gate cells wrong: ${wrong.map((c) => c[2]).join('; ')}`);

  // debate mode inherits the fail-safe: requires deliberations.active.
  let threw = false;
  try { resolveAutonomy('feature-deliberation', { autonomy: { grade: 3 }, deliberations: { active: false } }); } catch { threw = true; }
  threw ? ok('resolver: feature-deliberation at grade 3 without active deliberations throws (ADR-0045 fail-safe)') : bad('resolver did not fail closed for an inactive-deliberations gate');
}

// ---------------------------------------------------------------- real install (CLI + nudge)
{
  const fx = installFixture(rep);
  try {
    const cli = fx.script('deliberation-council.mjs', 'plan', '--question', 'Add OAuth and redesign onboarding UX', '--json');
    let plan = null;
    try { plan = JSON.parse(cli.stdout); } catch { /* handled below */ }
    plan && Array.isArray(plan.council) && plan.council.length >= 3 && plan.council.every((m) => m.tier === 'reasoning')
      ? ok('install: deliberation-council.mjs ships and plans a reasoning-tier council')
      : bad(`install council CLI wrong (status ${cli.status}): ${cli.stdout || cli.stderr}`);

    const decisionPath = join(fx.proj, 'contextkit', 'memory', 'decisions', '0099-some-strategic-call.md');
    const out = fx.hook('deliberation-nudge.mjs', { tool_name: 'Write', tool_input: { file_path: decisionPath } });
    out.includes('deliberation-nudge') && out.includes('New decision record')
      ? ok('install: deliberation-nudge fires on a new ADR write (decision context, ADR-0070)')
      : bad(`decision nudge did not fire: ${JSON.stringify(out)}`);
  } finally {
    fx.cleanup();
  }
}

rep.finish('Deliberation council + gates (ADR-0070)');
