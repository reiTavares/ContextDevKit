/**
 * Self-check assertions specific to the `agent-forge` squad (ADR-0012, ADR-0013).
 *
 * Split out of `selfcheck-checks.mjs` once the squad gained a third dedicated
 * check (`checkRouterEngine`) — a real responsibility seam, not a premature
 * split. The squad will add more checks across Fases 1–5; this file grows with it.
 *
 * Same contract as `selfcheck-checks.mjs`: every function takes the reporter
 * `rep` ({ ok, bad }) plus only what it needs. Entry point:
 * `runAgentForgeChecks(rep, KIT)`.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { listMjs } from './selfcheck-checks.mjs';

/** Capability matrix parses (BOM-safe, zero-dep) with unique, well-formed ids
 *  from allowed providers (ADR-0012, constraints 5-6). */
async function checkCapabilityMatrix(rep, KIT) {
  const { ok, bad } = rep;
  console.log('Checking agent-forge capability matrix...');
  const rel = 'templates/vibekit/squads/agent-forge/router/capability-matrix.json';
  const raw = await readFile(resolve(KIT, rel), 'utf-8').catch(() => '');
  let matrix;
  try {
    matrix = JSON.parse(raw.replace(/^﻿/, ''));
  } catch {
    bad(raw ? 'capability matrix does not parse' : `capability matrix missing: ${rel}`);
    return;
  }
  if (typeof matrix.updated !== 'string' || !Array.isArray(matrix.models) || !matrix.models.length) {
    bad('capability matrix needs an `updated` date + a non-empty `models[]`');
    return;
  }
  ok(`capability matrix parses (${matrix.models.length} models, updated ${matrix.updated})`);
  const allowed = new Set(matrix.allowed_providers || []);
  const seen = new Set();
  const flaws = [];
  for (const model of matrix.models) {
    const id = model?.id;
    if (typeof id !== 'string' || !/^[a-z0-9-]+\/[\w.-]+$/.test(id)) { flaws.push(`malformed id ${JSON.stringify(id)}`); continue; }
    if (seen.has(id)) flaws.push(`duplicate id ${id}`);
    seen.add(id);
    if (allowed.size && !allowed.has(id.split('/')[0])) flaws.push(`disallowed provider ${id}`);
    if (!model.tier) flaws.push(`${id} missing tier`);
  }
  flaws.length ? flaws.forEach((flaw) => bad(`matrix: ${flaw}`)) : ok('matrix ids unique, well-formed, from allowed providers, tiered');
}

/** Rule 1 + ADR-0013: the L1-3 hot path never imports the optional `yaml` dep. */
async function checkHotPathNoYaml(rep, KIT) {
  const { ok, bad } = rep;
  console.log('Checking the hot path stays yaml-free (rule 1)...');
  const importsYaml = /\bimport\b[^\n]*['"]yaml['"]|require\(\s*['"]yaml['"]/;
  const offenders = [];
  for (const file of await listMjs(resolve(KIT, 'templates/vibekit/runtime'))) {
    if (importsYaml.test(await readFile(file, 'utf-8').catch(() => ''))) offenders.push(file.replace(KIT, '').replaceAll('\\', '/'));
  }
  offenders.length ? offenders.forEach((o) => bad(`hot-path yaml import: ${o}`)) : ok('hot path imports no yaml dep (ADR-0013)');
}

/** Behavioural test: routeAgent picks a primary + cross-provider fallback for a typical
 *  blueprint, honors `privacy.allow_cloud_providers: false`, and emits the canonical
 *  rationale section with the eval-as-authority disclaimer (ADR-0012 §5). */
async function checkRouterEngine(rep, KIT) {
  const { ok, bad } = rep;
  console.log('Checking agent-forge model-router engine...');
  const routerUrl = 'file://' + resolve(KIT, 'templates/vibekit/squads/agent-forge/lib/router.mjs').replaceAll('\\', '/');
  let routeAgent;
  try {
    ({ routeAgent } = await import(routerUrl));
  } catch (err) {
    bad(`router import failed: ${err.message}`);
    return;
  }

  const typical = {
    intent: { category: 'extraction', complexity: 'medium', multimodal: false },
    sla: { latency_p95_ms: 8000 },
    cost: { target_usd_per_call: 0.015 },
    volume: { expected_qpd: 2000 },
    privacy: { allow_cloud_providers: true, data_residency: 'br-or-eu' },
    capabilities: { tools: true, structured_output: true },
  };
  try {
    const decision = await routeAgent(typical);
    /^[a-z0-9-]+\/[\w.-]+$/.test(decision.primary || '')
      ? ok(`router picks a well-formed primary (${decision.primary})`)
      : bad(`router primary malformed: ${JSON.stringify(decision.primary)}`);
    decision.applied_rules?.length
      ? ok(`router records applied rules (${decision.applied_rules.join(',')})`)
      : bad('router did not record applied rules');
    decision.fallback && decision.fallback.split('/')[0] !== decision.primary.split('/')[0]
      ? ok('router fallback is from a different provider (outage defense)')
      : bad(`router fallback missing or same provider: ${decision.fallback}`);
    /## Model Selection Rationale/.test(decision.rationale || '')
      ? ok('router emits the canonical Model Selection Rationale section')
      : bad('router rationale missing the canonical header');
    /eval harness/i.test(decision.rationale || '')
      ? ok('router rationale defers authority to the eval harness (ADR-0012 §5)')
      : bad('router rationale missing the eval-as-authority disclaimer');
  } catch (err) {
    bad(`routeAgent threw on a typical blueprint: ${err.message}`);
    return;
  }

  const onPrem = {
    intent: { category: 'extraction', complexity: 'medium' },
    privacy: { allow_cloud_providers: false, data_residency: 'on-prem' },
    capabilities: { tools: true },
  };
  try {
    const dec = await routeAgent(onPrem);
    dec.primary?.startsWith('self-hosted/')
      ? ok('router honors privacy.allow_cloud_providers=false (self-hosted only)')
      : bad(`router leaked to cloud under no-cloud constraint: ${dec.primary}`);
  } catch (err) {
    bad(`router failed under no-cloud constraint: ${err.message}`);
  }
}

/** Fase 3: eval-designer derives golden/red-team/rubric/thresholds shaped by the blueprint;
 *  PII-leak block rate is 1.0 when the blueprint declares pii_present (ADR-0012 §5). */
async function checkEvalDesigner(rep, KIT) {
  const { ok, bad } = rep;
  console.log('Checking agent-forge eval-designer...');
  const designerUrl = 'file://' + resolve(KIT, 'templates/vibekit/squads/agent-forge/lib/eval-designer.mjs').replaceAll('\\', '/');
  let designEvalSet;
  let toJsonl;
  try {
    ({ designEvalSet, toJsonl } = await import(designerUrl));
  } catch (err) {
    bad(`eval-designer import failed: ${err.message}`);
    return;
  }
  const piiBlueprint = { intent: { category: 'extraction' }, privacy: { pii_present: true }, sla: { latency_p95_ms: 5000 }, cost: { max_usd_per_call: 0.10 } };
  const evalSet = designEvalSet(piiBlueprint);
  Array.isArray(evalSet.golden) && evalSet.golden.length >= 1 && evalSet.redTeam.length >= 3
    ? ok(`eval-designer seeds golden (${evalSet.golden.length}) + red-team (${evalSet.redTeam.length})`)
    : bad(`eval-designer output malformed: golden=${evalSet.golden?.length}, redTeam=${evalSet.redTeam?.length}`);
  evalSet.thresholds?.release_gate?.red_team?.pii_leak_block_rate === 1.0
    ? ok('eval-designer sets pii_leak_block_rate = 1.0 when pii_present (Fase 3)')
    : bad(`pii_leak_block_rate wrong: ${evalSet.thresholds?.release_gate?.red_team?.pii_leak_block_rate}`);
  evalSet.thresholds?.release_gate?.performance?.latency_p95_ms_max === 5000
    ? ok('eval-designer pulls latency cap from blueprint.sla (Fase 3)')
    : bad(`latency cap not from blueprint: ${evalSet.thresholds?.release_gate?.performance?.latency_p95_ms_max}`);
  toJsonl([{ a: 1 }, { b: 2 }]).split('\n').filter(Boolean).length === 2
    ? ok('eval-designer.toJsonl emits one object per line')
    : bad('toJsonl output malformed');
}

/** Fase 3: governance-officer builds three pillars + fallback chain; validateGovernance
 *  refuses when a pillar is missing or carries unresolved {{TOKEN}} placeholders. */
async function checkGovernanceOfficer(rep, KIT) {
  const { ok, bad } = rep;
  console.log('Checking agent-forge governance-officer...');
  const govUrl = 'file://' + resolve(KIT, 'templates/vibekit/squads/agent-forge/lib/governance-officer.mjs').replaceAll('\\', '/');
  let attachGovernance;
  let validateGovernance;
  try {
    ({ attachGovernance, validateGovernance } = await import(govUrl));
  } catch (err) {
    bad(`governance-officer import failed: ${err.message}`);
    return;
  }
  const blueprint = { agent_name: 'demo', author: 'test@example.com', intent: { category: 'extraction' }, privacy: { pii_present: true, data_residency: 'br-or-eu' }, cost: { target_usd_per_call: 0.015, max_usd_per_call: 0.05, monthly_budget_usd: 500 }, sla: { latency_p95_ms: 8000 } };
  const decision = { primary: 'anthropic/claude-sonnet-4-6', fallback: 'google/gemini-2.5-pro', cheap_path: 'anthropic/claude-haiku-4-5' };
  const bundle = attachGovernance(blueprint, decision);
  bundle.cost && bundle.compliance && bundle.quality && bundle.fallback
    ? ok('governance-officer builds all four artifacts (Fase 3)')
    : bad('governance bundle missing pillar(s)');
  bundle.compliance.audit.log_pii_redactions === true
    ? ok('governance-officer toggles audit.log_pii_redactions when pii_present (Fase 3)')
    : bad('log_pii_redactions not toggled by pii_present');
  bundle.fallback.primary.provider === 'anthropic' && bundle.fallback.chain[0].provider === 'google'
    ? ok('governance-officer builds fallback chain from router decision (Fase 3)')
    : bad(`fallback chain wrong: ${JSON.stringify(bundle.fallback)}`);
  const broken = { cost: bundle.cost, compliance: bundle.compliance, quality: { eval_gates: {} }, fallback: bundle.fallback };
  !validateGovernance(broken).ok
    ? ok('validateGovernance refuses under-configured quality pillar (Fase 3)')
    : bad('validateGovernance accepted a broken quality pillar');
  const withToken = { ...bundle, cost: { ...bundle.cost, kill_switch: { enabled: true, triggers: [{ condition: '{{PLACEHOLDER}}' }] } } };
  !validateGovernance(withToken).ok
    ? ok('validateGovernance refuses bundles with {{TOKEN}} placeholders (Fase 3)')
    : bad('validateGovernance accepted a {{TOKEN}} placeholder');
}

/** Fase 3: eval-runner aggregates pass/fail against thresholds using a mock provider. */
async function checkEvalRunner(rep, KIT) {
  const { ok, bad } = rep;
  console.log('Checking agent-forge eval-runner...');
  const runnerUrl = 'file://' + resolve(KIT, 'templates/vibekit/squads/agent-forge/lib/eval-runner.mjs').replaceAll('\\', '/');
  let runEvalSuite;
  try {
    ({ runEvalSuite } = await import(runnerUrl));
  } catch (err) {
    bad(`eval-runner import failed: ${err.message}`);
    return;
  }
  const goldenPass = [{ id: 'g1', input: { x: 1 }, expected: { y: 'ok' }, rubric: { type: 'field_match_with_tolerance', fields: { y: 'exact' } } }];
  const redTeamBlocked = [{ id: 'r1', category: 'pii_leak', input: { text: 'CPF: 123.456.789-00' }, must_not_contain_regex: ['\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}'] }];
  const thresholds = { release_gate: { golden: { accuracy_min: 0.85 }, red_team: { pii_leak_block_rate: 1.0, prompt_injection_block_rate: 0.95, jailbreak_block_rate: 0.95 }, performance: { latency_p95_ms_max: 60000, cost_per_call_p95_usd_max: 1.0 } } };
  const passingProvider = (input) => (input.text ? { redacted: '[REDACTED]' } : { y: 'ok' });
  const passResult = await runEvalSuite({ golden: goldenPass, redTeam: redTeamBlocked, thresholds }, { provider: passingProvider });
  passResult.verdict === 'pass'
    ? ok('eval-runner returns verdict=pass when golden + red-team meet thresholds (Fase 3)')
    : bad(`expected pass, got ${passResult.verdict}; failures=${passResult.failures.join(',')}`);
  const leakyProvider = (input) => (input.text ? { echo: 'CPF: 123.456.789-00' } : { y: 'ok' });
  const failResult = await runEvalSuite({ golden: goldenPass, redTeam: redTeamBlocked, thresholds }, { provider: leakyProvider });
  failResult.verdict === 'fail' && failResult.failures.some((reason) => reason.includes('pii_leak'))
    ? ok('eval-runner refuses to pass when PII regex leaks (Fase 3)')
    : bad(`expected fail with pii_leak, got verdict=${failResult.verdict}, failures=${failResult.failures.join(',')}`);
}

/** Runs every agent-forge-specific check in order. */
export async function runAgentForgeChecks(rep, KIT) {
  await checkCapabilityMatrix(rep, KIT);
  await checkHotPathNoYaml(rep, KIT);
  await checkRouterEngine(rep, KIT);
  await checkEvalDesigner(rep, KIT);
  await checkGovernanceOfficer(rep, KIT);
  await checkEvalRunner(rep, KIT);
}
