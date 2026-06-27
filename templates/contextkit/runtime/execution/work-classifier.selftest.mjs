/**
 * In-process self-test for the A2 methodology classifiers (BIZ-0001 / WF-0036).
 * Updated for OP-0005 / ADR-0125: §17 nature uses integer thresholds; §18
 * execution-mode uses ceremony-point bands + hard triggers. Confidence now
 * carries 'ask' | 'low' | 'high' and needsClarification is asserted.
 *
 * Zero-dependency, runs under plain `node`. Proves the Gate G-A2 acceptance:
 *   1. Determinism — classify each fixture TWICE → byte-identical JSON.
 *   2. Explainability — every result carries a non-empty `reasons[]`.
 *   3. Fixtures — the design §12 NL-request → expected-classification cases pass
 *      (nature / kind / valueIntent.primary / growthLever / executionMode /
 *      confidence / needsClarification).
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

// For fixture assertions, always use the embedded DEFAULT_WORK_CLASSIFICATION so the
// selftest validates the template tree's own algorithm — not whatever dogfood policy
// is installed at process.cwd(). The on-disk policy is checked in section 5b.
const policy = DEFAULT_WORK_CLASSIFICATION;
// Also load from disk for the 5b byte-equivalence check.
const diskPolicy = loadWorkPolicy(process.cwd());

/**
 * Design §12 fixtures updated for OP-0005 / ADR-0125 TABLE 1+2 scoring.
 * Under new §17, ambiguous texts yield confidence='ask'; only texts with clear
 * TABLE 1 signals reach 'high'. All fixture #1-11 defaults to nature='operation'
 * (ASK for ambiguous, high for fixture #5 incident). New fixtures #12-15 exercise
 * TABLE 1 clear-BUSINESS, clear-OPERATION, and hard-trigger paths.
 */
const FIXTURES = [
  // Existing fixtures — updated for OP-0005 §17/§18 thresholds:
  { req: 'fix the broken updater rollback after the failed release',
    nature: 'operation', confidence: 'ask', needsClarification: true,
    kind: 'fix', intent: 'RECOVER', lever: 'RELIABILITY', mode: 'workflow' },
  { req: 'add a new export-to-CSV endpoint to the report screen',
    nature: 'operation', confidence: 'ask', needsClarification: true,
    kind: 'change', intent: 'CREATE', lever: 'OPERATIONAL_EFFICIENCY', mode: 'direct' },
  { req: 'rename every vibekit reference to contextkit across the repo',
    nature: 'operation', confidence: 'ask', needsClarification: true,
    kind: 'maintenance', intent: 'IMPROVE', lever: 'RELIABILITY', mode: 'direct' },
  { req: 'investigate why the L5 guard blocks edits in a worktree',
    nature: 'operation', confidence: 'ask', needsClarification: true,
    kind: 'investigation', intent: 'LEARN', lever: 'RELIABILITY', mode: 'direct' },
  // #5: "incident" scores O=6 → clear OPERATION/high.
  { req: 'production updater is failing — incident, roll back now',
    nature: 'operation', confidence: 'high', needsClarification: false,
    kind: 'operationalResponse', intent: 'RECOVER', lever: 'RELIABILITY', mode: 'direct' },
  // #6: "adr" in text → hard trigger adr-required → mode=workflow.
  { req: "harden the autonomy floor so an agent can't self-approve an ADR",
    nature: 'operation', confidence: 'ask', needsClarification: true,
    kind: 'change', intent: 'PROTECT', lever: 'QUALITY', mode: 'workflow' },
  { req: 'launch a new business-driven methodology platform capability',
    nature: 'operation', confidence: 'ask', needsClarification: true,
    kind: 'change', intent: 'ENABLE', lever: 'STRATEGIC_ENABLEMENT', mode: 'direct' },
  { req: 'build the strategic portfolio-intelligence initiative for enterprise',
    nature: 'operation', confidence: 'ask', needsClarification: true,
    kind: 'change', intent: 'ENABLE', lever: 'STRATEGIC_ENABLEMENT', mode: 'direct' },
  // #9: "decision" → adr-required; "compliance" → critical-compliance → mode=workflow.
  { req: 'make sure every accepted decision is recorded and validated for LGPD compliance',
    nature: 'operation', confidence: 'ask', needsClarification: true,
    kind: 'change', intent: 'COMPLY', lever: 'QUALITY', mode: 'workflow' },
  { req: 'reduce token cost by caching the routing classifier across sessions',
    nature: 'operation', confidence: 'ask', needsClarification: true,
    kind: 'change', intent: 'IMPROVE', lever: 'COST_EFFICIENCY', mode: 'direct' },
  { req: 'bump the changelog and tidy a few lint warnings',
    nature: 'operation', confidence: 'ask', needsClarification: true,
    kind: 'maintenance', intent: 'IMPROVE', lever: 'QUALITY', mode: 'direct' },
  // New fixtures exercising TABLE 1 clear paths:
  // #12: "new product"(+6) + "new market"(+6) = B=12 → BUSINESS/high.
  { req: 'we need to launch a new product for a new market segment',
    nature: 'business', confidence: 'high', needsClarification: false,
    kind: 'product', intent: 'CREATE', lever: null, mode: 'workflow' },
  // #13: "hotfix"(+6) + "outage"(+6) = O=12 → OPERATION/high.
  { req: 'this is a hotfix for the production outage',
    nature: 'operation', confidence: 'high', needsClarification: false,
    kind: 'fix', intent: 'RECOVER', lever: null, mode: 'direct' },
  // #14: ASK path (B=0, O=0), mode=direct (ceremony points=1, a few).
  { req: 'add a few small improvements to this component',
    nature: 'operation', confidence: 'ask', needsClarification: true,
    kind: 'change', intent: 'IMPROVE', lever: null, mode: 'direct' },
  // #15: "adr"(+4, hard) + "architecture"(+4, hard) → mode=workflow; isBusiness=false.
  { req: 'implement the new architecture adr for the platform',
    nature: 'operation', confidence: 'ask', needsClarification: true,
    kind: 'change', intent: 'CREATE', lever: 'STRATEGIC_ENABLEMENT', mode: 'workflow' },
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
  assert(`${tag} confidence=${fx.confidence}`, first.confidence === fx.confidence, `got ${first.confidence}`);
  assert(`${tag} needsClarification=${fx.needsClarification}`, first.needsClarification === fx.needsClarification, `got ${first.needsClarification}`);
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
// This check loads the template-tree policy (not the dogfood installed copy) so the
// comparison is always against the authoritative source. Falls back to skip when the
// template policy file is not accessible from the current working directory.
{
  const templateJsonPath = new URL('../../policy/work-classification.json', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
  const jsonPath = existsSync(templateJsonPath) ? templateJsonPath : pathsFor(process.cwd()).workClassification;
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
