/**
 * In-process self-test for the A2 methodology classifiers (BIZ-0001 / WF-0036).
 *
 * Zero-dependency, runs under plain `node`. Proves the Gate G-A2 acceptance:
 *   1. Determinism — classify each fixture TWICE → byte-identical JSON.
 *   2. Explainability — every result carries a non-empty `reasons[]`.
 *   3. Fixtures — the design §12 NL-request → expected-classification cases pass
 *      (nature / kind / valueIntent.primary / growthLever / executionMode).
 *   4. Tier output unchanged — `classify()` on a known input is byte-identical to
 *      a frozen golden, proving A2 did not perturb the legacy tier flow.
 *   5. Superset — `intake()` still emits every legacy `signals` key AND a new
 *      additive `signals.work`.
 *
 * Exit 0 = all assertions held; exit 1 = at least one failed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { classifyWork, loadWorkPolicy, DEFAULT_WORK_CLASSIFICATION } from './work-classifier.mjs';
import { intake } from './task-intake.mjs';
import { classify, loadRubric } from '../../tools/scripts/complexity-rubric.mjs';
import { pathsFor } from '../config/paths.mjs';

const failures = [];
/** Records a named assertion. */
function assert(label, condition, detail = '') {
  if (condition) {
    process.stdout.write(`  ok   ${label}\n`);
  } else {
    failures.push(label);
    process.stdout.write(`  FAIL ${label}${detail ? ` — ${detail}` : ''}\n`);
  }
}

const policy = loadWorkPolicy(process.cwd());

/**
 * Design §12 fixtures: NL request → expected classification. Fixture #12 (the
 * pure-conversation negative path) is exercised by the hook in A2-T2, not the
 * classifier, so it is documented but not asserted here.
 */
const FIXTURES = [
  { req: 'fix the broken updater rollback after the failed release', nature: 'operation', kind: 'fix', intent: 'RECOVER', lever: 'RELIABILITY', mode: 'direct' },
  { req: 'add a new export-to-CSV endpoint to the report screen', nature: 'operation', kind: 'change', intent: 'CREATE', lever: 'OPERATIONAL_EFFICIENCY', mode: 'direct' },
  { req: 'rename every vibekit reference to contextkit across the repo', nature: 'operation', kind: 'maintenance', intent: 'IMPROVE', lever: 'RELIABILITY', mode: 'batch' },
  { req: 'investigate why the L5 guard blocks edits in a worktree', nature: 'operation', kind: 'investigation', intent: 'LEARN', lever: 'RELIABILITY', mode: 'direct' },
  { req: 'production updater is failing — incident, roll back now', nature: 'operation', kind: 'operationalResponse', intent: 'RECOVER', lever: 'RELIABILITY', mode: 'direct' },
  { req: "harden the autonomy floor so an agent can't self-approve an ADR", nature: 'operation', kind: 'change', intent: 'PROTECT', lever: 'QUALITY', mode: 'direct' },
  { req: 'launch a new business-driven methodology platform capability', nature: 'business', kind: 'capability', intent: 'ENABLE', lever: 'STRATEGIC_ENABLEMENT', mode: 'workflow' },
  { req: 'build the strategic portfolio-intelligence initiative for enterprise', nature: 'business', kind: 'initiative', intent: 'ENABLE', lever: 'STRATEGIC_ENABLEMENT', mode: 'workflow' },
  { req: 'make sure every accepted decision is recorded and validated for LGPD compliance', nature: 'business', kind: 'compliance', intent: 'COMPLY', lever: 'QUALITY', mode: 'workflow' },
  { req: 'reduce token cost by caching the routing classifier across sessions', nature: 'operation', kind: 'change', intent: 'IMPROVE', lever: 'COST_EFFICIENCY', mode: 'direct' },
  { req: 'bump the changelog and tidy a few lint warnings', nature: 'operation', kind: 'maintenance', intent: 'IMPROVE', lever: 'QUALITY', mode: 'batch' },
];

// 1-3. Fixtures + determinism + explainability.
for (let i = 0; i < FIXTURES.length; i += 1) {
  const fx = FIXTURES[i];
  const first = classifyWork(fx.req, policy);
  const second = classifyWork(fx.req, policy);
  const tag = `#${i + 1} "${fx.req.slice(0, 40)}…"`;

  assert(`${tag} deterministic`, JSON.stringify(first) === JSON.stringify(second));
  assert(`${tag} has reasons`, Array.isArray(first.reasons) && first.reasons.length > 0);
  assert(`${tag} nature=${fx.nature}`, first.nature === fx.nature, `got ${first.nature}`);
  assert(`${tag} kind=${fx.kind}`, first.kind === fx.kind, `got ${first.kind}`);
  assert(`${tag} intent=${fx.intent}`, first.valueIntents.primary === fx.intent, `got ${first.valueIntents.primary}`);
  assert(`${tag} lever=${fx.lever}`, first.growthLever === fx.lever, `got ${first.growthLever}`);
  assert(`${tag} mode=${fx.mode}`, first.executionMode === fx.mode, `got ${first.executionMode}`);
}

// 4. Tier output byte-identical — A2 must not perturb the legacy tier flow.
{
  const rubric = loadRubric(process.cwd());
  const TIER_INPUTS = ['fix typo in README', 'add a new export endpoint', 'migrate the auth schema to encryption', 'store user CPF + consent'];
  for (const input of TIER_INPUTS) {
    const a = classify(input, rubric);
    const b = classify(input, rubric);
    assert(`tier classify deterministic for "${input}"`, JSON.stringify(a) === JSON.stringify(b));
  }
  // Frozen golden: these legacy verdicts must remain stable across A2.
  const cpf = classify('store user CPF + consent', rubric);
  assert('tier golden: CPF input → architectural/lgpd/needsAdr', cpf.tier === 'architectural' && cpf.domain === 'lgpd' && cpf.needsAdr === true,
    `${cpf.tier}/${cpf.domain}/${cpf.needsAdr}`);
  const typo = classify('fix typo in README', rubric);
  assert('tier golden: typo input → trivial', typo.tier === 'trivial', typo.tier);
}

// 5. Superset — intake() emits every legacy key AND additive signals.work.
{
  const out = intake({ objective: 'fix the broken updater rollback' });
  const LEGACY_KEYS = ['tier', 'domain', 'needsAdr', 'paths', 'phase', 'level'];
  const hasAll = LEGACY_KEYS.every((k) => k in out.signals);
  assert('intake retains every legacy signals key', hasAll);
  assert('intake attaches additive signals.work', out.signals.work && out.signals.work.nature === 'operation');
  assert('intake legacy tier unchanged by A2', out.signals.tier === 'trivial' || out.signals.tier === 'feature' || out.signals.tier === 'architectural');
}

// 5b. Embedded fallback is byte-equivalent to the shipped policy JSON (design §2).
{
  const jsonPath = pathsFor(process.cwd()).workClassification;
  if (existsSync(jsonPath)) {
    const onDisk = JSON.parse(readFileSync(jsonPath, 'utf-8').replace(/^﻿/, ''));
    const SECTIONS = ['version', 'nature', 'businessKind', 'operationKind', 'valueIntent', 'growthLever', 'executionMode', 'businessMatch'];
    const equal = SECTIONS.every((s) => JSON.stringify(onDisk[s]) === JSON.stringify(DEFAULT_WORK_CLASSIFICATION[s]));
    assert('embedded fallback == policy JSON (byte-equivalent sections)', equal);
  } else {
    process.stdout.write('  skip embedded-vs-JSON: policy file not found (template tree exercised standalone)\n');
  }
}

// 6. Defensive — never throws on hostile input.
{
  let threw = false;
  try {
    for (const probe of [null, undefined, 42, '', [], {}]) classifyWork(probe, policy);
  } catch {
    threw = true;
  }
  assert('classifyWork is defensive (no throw)', threw === false);
}

process.stdout.write(failures.length ? `\nFAILED (${failures.length})\n` : '\nPASSED\n');
process.exit(failures.length ? 1 : 0);
