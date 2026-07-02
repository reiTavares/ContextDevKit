/**
 * Self-check suite for WF-0064 — Devteam Agents & Skills (ADR-0128 §9-§12/§18).
 * Validates the invariants the kit must never regress: the skills registry is
 * well-formed (6 skills, bodies on disk, triggers/reason-codes consistent), the
 * §11 trigger truth-table resolves deterministically per CMIS/DAS band with the
 * proportionality guarantee (simple work never gets domain ceremony), a degraded
 * policy yields the recorded baseline (never a false pass), the §12 playbook
 * order holds and profile-gates the `model` step, the §18 skill-application
 * receipt round-trips, required agents reuse the profile's minimum squad
 * verbatim, and the §15 envelope block carries the resolved skills shadow-only.
 * Wired into `tools/selfcheck.mjs`.
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const RT = 'templates/contextkit/runtime/devteam';

/**
 * @param {{ ok: Function, bad: Function }} report
 * @param {{ KIT: string }} ctx
 */
export async function runDevteamChecks({ ok, bad }, { KIT }) {
  console.log('Checking WF-0064 devteam agents & skills...');
  const imp = async (rel) => import(pathToFileURL(resolve(KIT, RT, rel)).href);
  const TPL = resolve(KIT, 'templates');

  let dt, de;
  try {
    dt = await imp('index.mjs');
    de = await import(pathToFileURL(resolve(KIT, 'templates/contextkit/runtime/domain-engineering/index.mjs')).href);
    ok('devteam modules import cleanly');
  } catch (err) {
    bad(`devteam import failed: ${err?.message ?? err}`);
    return;
  }

  // -- Policy bundle + registry well-formedness ------------------------------
  const bundle = dt.loadDevteamPolicyBundle(TPL);
  bundle && !bundle.degraded ? ok('devteam policy bundle loads (not degraded)') : bad(`devteam bundle degraded: ${bundle?.missing}`);

  const EXPECTED_SKILLS = ['senior-implementation', 'domain-modeling', 'modular-design', 'ddd-architecture-review', 'domain-test-strategy', 'implementation-review'];
  const registrySkills = Object.keys(bundle.skillsRegistry?.skills ?? {});
  EXPECTED_SKILLS.every((s) => registrySkills.includes(s)) && registrySkills.length === EXPECTED_SKILLS.length
    ? ok('skills registry carries exactly the six §11 skills') : bad(`skills registry mismatch: ${registrySkills}`);
  const bodiesExist = EXPECTED_SKILLS.every((s) => existsSync(resolve(TPL, 'contextkit', bundle.skillsRegistry.skills[s]?.body ?? '')));
  bodiesExist ? ok('every registered skill has its SKILL.md body on disk') : bad('a registered skill body file is missing');
  const triggerSkills = Object.keys(bundle.skillTriggers?.skills ?? {});
  JSON.stringify([...triggerSkills].sort()) === JSON.stringify([...registrySkills].sort())
    ? ok('trigger table and registry declare the same skill ids') : bad('trigger/registry skill id drift');

  // Every trigger reasonCode exists in the devteam catalog (append-only contract).
  const catalog = dt.loadDevteamPolicyTable(TPL, 'reasonCodes').table?.codes ?? {};
  const triggerCodes = triggerSkills.flatMap((s) => (bundle.skillTriggers.skills[s].triggers ?? []).map((t) => t.reasonCode));
  triggerCodes.every((c) => c in catalog) ? ok('every trigger reason code exists in the catalog') : bad(`unknown trigger reason code: ${triggerCodes.filter((c) => !(c in catalog))}`);

  // -- Malformed / absent policy is refused, never a false pass ---------------
  const tmp = mkdtempSync(join(tmpdir(), 'cdk-devteam-'));
  try {
    dt.loadDevteamPolicyTable(tmp, 'skillTriggers').degraded === true
      ? ok('missing policy root ⇒ degraded sentinel') : bad('missing policy not degraded');
    const badDir = join(tmp, 'contextkit', 'policy', 'devteam');
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, 'skill-triggers.json'), JSON.stringify({ schemaVersion: 2, skills: {} }));
    dt.loadDevteamPolicyTable(tmp, 'skillTriggers').degraded === true
      ? ok('wrong schemaVersion ⇒ degraded (malformed table rejected)') : bad('malformed table accepted');

    // -- §18 receipt round-trip (atomic write + read-back) --------------------
    const recorded = dt.recordSkillApplication(tmp, {
      skill: 'senior-implementation', version: '0.1.0', sections: ['discipline', 'evidence'],
      appliedTo: 'agent:implementation-engineer', taskId: 'task-selfcheck', content: 'applied content',
      at: '2026-07-01T00:00:00.000Z',
    });
    recorded.persisted === true && recorded.reasonCode === 'RECEIPT_RECORDED' ? ok('skill receipt persisted (RECEIPT_RECORDED)') : bad(`receipt not persisted: ${recorded.reasonCode}`);
    const back = dt.loadSkillReceipts(tmp);
    back.receipts.length === 1 && back.receipts[0].skill === 'senior-implementation'
      && back.receipts[0].contentHash === dt.skillContentHash('applied content') && back.receipts[0].shadow === true
      ? ok('skill receipt round-trips (skill/version/sections/hash, shadow)') : bad('receipt round-trip mismatch');
    JSON.stringify(back.receipts[0].sections) === JSON.stringify(['discipline', 'evidence'])
      ? ok('receipt records the applied sections (selection ≠ application, §18)') : bad('receipt sections wrong');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // -- §11 truth-table (bands → skill set) + proportionality ------------------
  const skillsFor = (cmisScore, dasScore, profile, ctx = {}) =>
    dt.resolveRequiredSkills({ score: cmisScore }, { score: dasScore }, { profile }, ctx, bundle.skillTriggers);

  const simple = skillsFor(60, 10, 'simple', { complexity: 'feature' });
  JSON.stringify(simple.skills) === JSON.stringify(['senior-implementation', 'implementation-review'])
    ? ok('simple code ⇒ senior-implementation + implementation-review only') : bad(`simple band wrong: ${simple.skills}`);
  !simple.skills.includes('domain-modeling') && !simple.skills.includes('ddd-architecture-review')
    ? ok('simple work NEVER gets domain ceremony (proportionality)') : bad('simple wrongly got domain skills');

  skillsFor(10, 0, 'no-code').skills.length === 0 && skillsFor(10, 0, 'no-code').reasonCodes.includes('SKILLS_NO_CODE')
    ? ok('no-code ⇒ empty skill set (SKILLS_NO_CODE)') : bad('no-code skill set not empty');

  const modular = skillsFor(60, 30, 'modular', { complexity: 'feature' });
  modular.skills.includes('modular-design') && modular.skills.includes('domain-test-strategy') && !modular.skills.includes('domain-modeling')
    ? ok('modular band ⇒ +modular-design +domain-test-strategy, no domain-modeling') : bad(`modular band wrong: ${modular.skills}`);

  const dd = skillsFor(75, 50, 'domain-driven', { complexity: 'feature', risk: 'high' });
  ['senior-implementation', 'domain-modeling', 'ddd-architecture-review', 'domain-test-strategy', 'implementation-review']
    .every((s) => dd.skills.includes(s))
    ? ok('domain-driven band ⇒ full domain skill set') : bad(`domain-driven band wrong: ${dd.skills}`);

  const wa = skillsFor(10, 0, 'simple', { flags: { writeAttempt: true } });
  wa.skills.includes('senior-implementation') && wa.selections.some((s) => s.reasonCode === 'SKILL_SENIOR_IMPLEMENTATION_WRITE_ATTEMPT')
    ? ok('write-attempt flag forces senior-implementation (Class A path)') : bad('write-attempt trigger broken');

  const trivial = skillsFor(60, 10, 'simple', { complexity: 'trivial' });
  !trivial.skills.includes('implementation-review')
    ? ok('trivial complexity ⇒ no implementation-review') : bad('implementation-review fired on trivial');

  JSON.stringify(skillsFor(60, 30, 'modular', { complexity: 'feature' })) === JSON.stringify(skillsFor(60, 30, 'modular', { complexity: 'feature' }))
    ? ok('skill resolution deterministic (identical input ⇒ identical output)') : bad('skill resolution not deterministic');

  // -- Band boundaries at their exact edges (eval-designer golden cases) ------
  const das44 = skillsFor(60, 44, 'modular', { complexity: 'feature' });
  const das45 = skillsFor(60, 45, 'modular', { complexity: 'feature' });
  das44.skills.includes('modular-design') && !das44.skills.includes('domain-modeling')
    ? ok('das=44 edge: modular-design in, domain-modeling out') : bad(`das=44 edge wrong: ${das44.skills}`);
  das45.skills.includes('domain-modeling') && !das45.skills.includes('modular-design')
    ? ok('das=45 edge: domain-modeling in, modular-design out (ceiling holds)') : bad(`das=45 edge wrong: ${das45.skills}`);
  const floors = skillsFor(50, 25, 'modular', { complexity: 'feature' });
  ['senior-implementation', 'modular-design', 'domain-test-strategy', 'implementation-review'].every((s) => floors.skills.includes(s))
    ? ok('cmis=50 + das=25 exact floors all fire') : bad(`exact floors wrong: ${floors.skills}`);
  skillsFor(49, 24, 'modular', { complexity: 'feature' }).skills.length === 0
    ? ok('cmis=49 + das=24 (below both floors) ⇒ nothing fires') : bad('sub-floor scores wrongly fired');
  skillsFor(49, 0, 'simple', { flags: { publicContract: true, crossModule: true, stateAuthorityChange: true } }).skills.length === 0
    ? ok('flag rows respect the recorded cmisMin=50 floor (only writeAttempt bypasses it)') : bad('flag row fired below the CMIS floor');
  skillsFor(10, 0, 'simple', { flags: { domainHardTrigger: true } }).skills.includes('domain-modeling')
    ? ok('domain hard trigger fires domain-modeling independent of DAS (§11)') : bad('domainHardTrigger path broken');

  // Every resolver-emitted reason code is in the catalog.
  const emitted = [...simple.reasonCodes, ...modular.reasonCodes, ...dd.reasonCodes, ...wa.reasonCodes, 'SKILLS_FALLBACK_BASELINE', 'SKILLS_NO_CODE'];
  emitted.every((c) => c in catalog) ? ok('every emitted skill reason code exists in the catalog') : bad(`unknown emitted code: ${emitted.filter((c) => !(c in catalog))}`);

  // -- Degraded trigger table ⇒ recorded baseline, never a false pass ---------
  const fallback = dt.resolveRequiredSkills({ score: 60 }, { score: 10 }, { profile: 'simple' }, {}, null);
  fallback.degraded === true && JSON.stringify(fallback.skills) === JSON.stringify([...dt.BASELINE_SKILLS])
    && fallback.reasonCodes.includes('SKILLS_FALLBACK_BASELINE')
    ? ok('degraded trigger table ⇒ baseline + SKILLS_FALLBACK_BASELINE (recorded, not a false pass)') : bad('degrade path is a false pass');
  dt.resolveRequiredSkills({ score: 10 }, { score: 0 }, { profile: 'no-code' }, {}, null).skills.length === 0
    ? ok('degraded table still respects no-code (no baseline ceremony)') : bad('degraded no-code got baseline');

  // -- §12 playbook order + profile gating -------------------------------------
  const order = dt.validatePlaybookOrder(bundle.playbook);
  order.valid ? ok('playbook carries the canonical 8-step §12 order') : bad(`playbook order invalid: ${order.errors}`);
  // Reversing the ids while keeping the numeric order defeats the sort-normalization.
  const steps = bundle.playbook.steps;
  const shuffled = { ...bundle.playbook, steps: steps.map((s, i) => ({ ...s, id: steps[steps.length - 1 - i].id })) };
  dt.validatePlaybookOrder(shuffled).valid === false ? ok('playbook validator rejects a wrong order') : bad('playbook validator accepted a shuffled order');
  const simpleSteps = dt.stepsForProfile('simple', bundle.playbook);
  !simpleSteps.steps.some((s) => s.id === 'model') && simpleSteps.reasonCodes.includes('PLAYBOOK_STEP_PROFILE_GATED')
    ? ok('simple profile skips the model step (gated, with reason)') : bad('model step not profile-gated');
  dt.stepsForProfile('domain-driven', bundle.playbook).steps.map((s) => s.id).join(',') === dt.PLAYBOOK_STEP_ORDER.join(',')
    ? ok('domain-driven profile runs all 8 steps in order') : bad('domain-driven step set wrong');

  // -- Required agents reuse the profile minimum squad (single authority) -----
  const profilesTable = de.loadPolicyBundle(TPL).profiles;
  for (const [name, entry] of Object.entries(profilesTable.profiles)) {
    const resolved = dt.resolveRequiredAgents(name, profilesTable);
    JSON.stringify(resolved.agents) === JSON.stringify(entry.minimumSquad)
      ? ok(`required agents(${name}) === profile minimum squad`) : bad(`agent resolution drift for ${name}`);
  }
  dt.resolveRequiredAgents({ profile: 'modular', minimumSquad: ['implementation-engineer', 'code-reviewer', 'test-engineer'] }).agents.length === 3
    ? ok('required agents accepts the resolved-profile object form') : bad('profile-object form broken');
  dt.resolveRequiredAgents('bogus-profile', profilesTable).degraded === true
    ? ok('unknown profile ⇒ degraded, not an invented squad') : bad('unknown profile fabricated a squad');

  // -- §15 envelope block integration (shadow-only) ----------------------------
  const block = de.buildImplementationBlock({
    root: TPL,
    requestText: 'implement and create the invoice aggregate module with a domain event and repository, add a test',
    intakeSignals: { tier: 'feature', paths: ['src/invoice.mjs'] },
    classification: { risk: 'high', blastRadius: 'module', complexity: 'feature' },
  });
  block.shadow === true && block.requiredSkills.includes('domain-modeling') && block.requiredSkills.includes('senior-implementation')
    ? ok('envelope block resolves real §11 skills (shadow-only)') : bad(`envelope skills wrong: ${block.requiredSkills}`);
  JSON.stringify(block.requiredAgents) === JSON.stringify(profilesTable.profiles[block.profile].minimumSquad)
    ? ok('envelope requiredAgents still mirrors the profile squad') : bad('envelope agents drifted from profile');
  const blockFallback = de.buildImplementationBlock({
    root: TPL, devteamTriggers: {},
    requestText: 'implement the scorer function', intakeSignals: { tier: 'feature', paths: ['x.mjs'] },
    classification: { complexity: 'feature' },
  });
  JSON.stringify(blockFallback.requiredSkills) === JSON.stringify([...dt.BASELINE_SKILLS])
    && blockFallback.reasonCodes.includes('SKILLS_FALLBACK_BASELINE') && blockFallback.skillsDegraded === true
    ? ok('envelope block degrades to recorded baseline on a malformed trigger table (skillsDegraded flagged)') : bad('envelope fallback path broken');
  block.skillsDegraded === false ? ok('healthy path leaves skillsDegraded false') : bad('skillsDegraded wrongly set on healthy path');

  // -- Agents: new + upgraded present and well-formed --------------------------
  const registry = await readJson(resolve(KIT, 'templates/contextkit/policy/agent-capability-registry.json'));
  const REQUIRED_KEYS = ['agent', 'squad', 'capabilities', 'intents', 'pathPatterns', 'riskTriggers', 'antiTriggers', 'playbooks', 'contextRequirements', 'preferredRole', 'modelTier'];
  for (const name of ['domain-modeler', 'implementation-engineer']) {
    const entry = (registry?.agents ?? []).find((a) => a.agent === name);
    entry && REQUIRED_KEYS.every((k) => k in entry) && entry.squad === 'devteam'
      ? ok(`registry entry for ${name} well-formed (devteam)`) : bad(`registry entry for ${name} missing/malformed`);
    existsSync(resolve(KIT, 'templates/claude/agents', `${name}.md`))
      ? ok(`${name}.md authored source exists`) : bad(`${name}.md missing`);
  }
  for (const name of ['architect', 'code-reviewer', 'test-engineer', 'context-keeper']) {
    const body = await readText(resolve(KIT, 'templates/claude/agents', `${name}.md`));
    body.includes('ADR-0128 §10') ? ok(`${name} carries the §10 domain-engineering upgrade`) : bad(`${name} §10 upgrade missing`);
  }
  const squad = await readText(resolve(KIT, 'templates/contextkit/workflows/playbooks/squads/squad-devteam.md'));
  squad.includes('`domain-modeler`') && squad.includes('`implementation-engineer`')
    ? ok('squad-devteam members include the two new agents') : bad('squad-devteam members not updated');
}

/** Reads + parses a JSON file (BOM-safe); null on failure. */
async function readJson(file) {
  try {
    const { readFileSync } = await import('node:fs');
    return JSON.parse(readFileSync(file, 'utf-8').replace(/^﻿/, ''));
  } catch { return null; }
}

/** Reads a text file; empty string on failure. */
async function readText(file) {
  try {
    const { readFileSync } = await import('node:fs');
    return readFileSync(file, 'utf-8');
  } catch { return ''; }
}
