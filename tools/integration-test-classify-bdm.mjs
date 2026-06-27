#!/usr/bin/env node
/**
 * integration-test-classify-bdm.mjs — end-to-end harness for the BIZ-0001 /
 * WF-0036 Wave A2 methodology layer (classifier + matcher + intake-hook surface),
 * tier `integration:enforcement`. Encodes the design §12 fixture cases as REAL
 * assertions so a regression flips this suite RED under `npm run ci`.
 *
 * It drives the SHIPPED runtime modules under `templates/contextkit/` directly
 * (no subprocess needed — the classifiers are pure), and exercises the matcher +
 * methodology hook through a hermetic tmp fixture root, so it never reads/writes
 * the dogfood tree and is byte-stable on any machine.
 *
 * Coverage (design §12 + §7 + §8 + §6):
 *   F1. Classifier fixtures — the 11 NL requests classify to their expected
 *       {nature, kind, valueIntent.primary, growthLever, executionMode}.
 *   F2. Determinism — classify each fixture twice → byte-identical JSON.
 *   F3. Tier flow intact — legacy signal keys (tier/domain/needsAdr) are
 *       byte-identical to a frozen pre-A2 golden; signals.work is a pure superset.
 *   F4. Matcher — deterministic + thresholded on a fixture registry; below
 *       threshold → suggested=null; non-operation skipped; confirmed always null.
 *   F5. Hook superset / fail-open — methodology never alters the legacy checklist
 *       for a control input, and a classifier/matcher error never breaks the hook.
 *
 * Exit 0 on all-pass, non-zero on any failure. Zero deps — node:* only.
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reporter } from './it-helpers.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const EXEC = resolve(KIT, 'templates/contextkit/runtime/execution');
const urlFor = (rel) => pathToFileURL(resolve(EXEC, rel)).href;
const rep = reporter();
const tmp = () => mkdtempSync(join(tmpdir(), 'ck-it-classify-bdm-'));
const clean = (r) => rmSync(r, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// Import the A2 surface + the legacy tier classifier (for the regression golden).
// ---------------------------------------------------------------------------
let classifyWork, loadWorkPolicy, DEFAULT_WORK_CLASSIFICATION;
let matchBusiness;
let buildIntakeProposal, saveIntakeProposal, readIntakeProposal;
let resolveProposedAction, renderMethodologyLine, runMethodology;
let renderChecklist;
let intake, classify, loadRubric;

try {
  ({ classifyWork, loadWorkPolicy, DEFAULT_WORK_CLASSIFICATION } = await import(urlFor('work-classifier.mjs')));
  ({ matchBusiness } = await import(urlFor('business-matcher.mjs')));
  ({ buildIntakeProposal, saveIntakeProposal, readIntakeProposal } = await import(urlFor('intake-proposal-store.mjs')));
  ({ resolveProposedAction, renderMethodologyLine, runMethodology } = await import(urlFor('intake-methodology.mjs')));
  ({ renderChecklist } = await import(pathToFileURL(resolve(KIT, 'templates/contextkit/runtime/hooks/execution-contract-hook.mjs')).href));
  ({ intake } = await import(urlFor('task-intake.mjs')));
  ({ classify, loadRubric } = await import(pathToFileURL(resolve(KIT, 'templates/contextkit/tools/scripts/complexity-rubric.mjs')).href));
} catch (err) {
  rep.bad(`Module import failed: ${err?.message ?? err}`);
  rep.finish('integration-classify-bdm (BIZ-0001/WF-0036 A2)'); // early exit on import failure
}

// OP-0005: use the embedded DEFAULT so F1/F2 always tests the template's own algorithm,
// not the dogfood installed policy (which may still carry old signals during migration).
const policy = DEFAULT_WORK_CLASSIFICATION;

// ---------------------------------------------------------------------------
// F1 + F2. Classifier fixtures (design §12) + determinism.
// ---------------------------------------------------------------------------
console.log('\nF1+F2. Classifier fixtures (design §12) + determinism...');
// Updated for OP-0005 / ADR-0125: §17 integer thresholds; §18 ceremony-point bands.
const FIXTURES = [
  { n: 1, req: 'fix the broken updater rollback after the failed release', nature: 'operation', kind: 'fix', intent: 'RECOVER', lever: 'RELIABILITY', mode: 'workflow' },
  { n: 2, req: 'add a new export-to-CSV endpoint to the report screen', nature: 'operation', kind: 'change', intent: 'CREATE', lever: 'OPERATIONAL_EFFICIENCY', mode: 'direct' },
  { n: 3, req: 'rename every vibekit reference to contextkit across the repo', nature: 'operation', kind: 'maintenance', intent: 'IMPROVE', lever: 'RELIABILITY', mode: 'direct' },
  { n: 4, req: 'investigate why the L5 guard blocks edits in a worktree', nature: 'operation', kind: 'investigation', intent: 'LEARN', lever: 'RELIABILITY', mode: 'direct' },
  { n: 5, req: 'production updater is failing — incident, roll back now', nature: 'operation', kind: 'operationalResponse', intent: 'RECOVER', lever: 'RELIABILITY', mode: 'direct' },
  { n: 6, req: "harden the autonomy floor so an agent can't self-approve an ADR", nature: 'operation', kind: 'change', intent: 'PROTECT', lever: 'QUALITY', mode: 'workflow' },
  { n: 7, req: 'launch a new business-driven methodology platform capability', nature: 'operation', kind: 'change', intent: 'ENABLE', lever: 'STRATEGIC_ENABLEMENT', mode: 'direct' },
  { n: 8, req: 'build the strategic portfolio-intelligence initiative for enterprise', nature: 'operation', kind: 'change', intent: 'ENABLE', lever: 'STRATEGIC_ENABLEMENT', mode: 'direct' },
  { n: 9, req: 'make sure every accepted decision is recorded and validated for LGPD compliance', nature: 'operation', kind: 'change', intent: 'COMPLY', lever: 'QUALITY', mode: 'workflow' },
  { n: 10, req: 'reduce token cost by caching the routing classifier across sessions', nature: 'operation', kind: 'change', intent: 'IMPROVE', lever: 'COST_EFFICIENCY', mode: 'direct' },
  { n: 11, req: 'bump the changelog and tidy a few lint warnings', nature: 'operation', kind: 'maintenance', intent: 'IMPROVE', lever: 'QUALITY', mode: 'direct' },
];

for (const fx of FIXTURES) {
  const first = classifyWork(fx.req, policy);
  const second = classifyWork(fx.req, policy);
  const tag = `#${fx.n}`;
  JSON.stringify(first) === JSON.stringify(second)
    ? rep.ok(`${tag} deterministic (byte-identical across two runs)`)
    : rep.bad(`${tag} NON-deterministic classification`);
  Array.isArray(first.reasons) && first.reasons.length > 0
    ? rep.ok(`${tag} carries reasons[]`)
    : rep.bad(`${tag} missing reasons[]`);
  first.nature === fx.nature ? rep.ok(`${tag} nature=${fx.nature}`) : rep.bad(`${tag} nature: got ${first.nature}, want ${fx.nature}`);
  first.kind === fx.kind ? rep.ok(`${tag} kind=${fx.kind}`) : rep.bad(`${tag} kind: got ${first.kind}, want ${fx.kind}`);
  first.valueIntents.primary === fx.intent ? rep.ok(`${tag} intent=${fx.intent}`) : rep.bad(`${tag} intent: got ${first.valueIntents.primary}, want ${fx.intent}`);
  first.growthLever === fx.lever ? rep.ok(`${tag} lever=${fx.lever}`) : rep.bad(`${tag} lever: got ${first.growthLever}, want ${fx.lever}`);
  first.executionMode === fx.mode ? rep.ok(`${tag} mode=${fx.mode}`) : rep.bad(`${tag} mode: got ${first.executionMode}, want ${fx.mode}`);
}

// ---------------------------------------------------------------------------
// F3. Tier flow intact — legacy signal keys byte-identical to a frozen golden.
// A2 attaches signals.work as a PURE SUPERSET; the tier verdict must not move.
// ---------------------------------------------------------------------------
console.log('\nF3. Tier flow intact (legacy signals are a frozen superset)...');
{
  // Frozen pre-A2 golden: control inputs and their legacy verdicts (design §7).
  const GOLDEN = [
    { input: 'store user CPF + consent', tier: 'architectural', domain: 'lgpd', needsAdr: true },
    { input: 'fix typo in README', tier: 'trivial', domain: 'general', needsAdr: false },
  ];
  const rubric = JSON.parse(readFileSync(resolve(KIT, 'templates/contextkit/policy/complexity-rubric.json'), 'utf-8'));
  for (const g of GOLDEN) {
    // Tier classify itself stays deterministic + matches the golden.
    const a = classify(g.input, rubric);
    const b = classify(g.input, rubric);
    JSON.stringify(a) === JSON.stringify(b)
      ? rep.ok(`tier classify deterministic for "${g.input}"`)
      : rep.bad(`tier classify NON-deterministic for "${g.input}"`);
    a.tier === g.tier && a.domain === g.domain && a.needsAdr === g.needsAdr
      ? rep.ok(`tier golden held: "${g.input}" → ${g.tier}/${g.domain}/needsAdr=${g.needsAdr}`)
      : rep.bad(`tier golden DRIFT: "${g.input}" → ${a.tier}/${a.domain}/${a.needsAdr}`);

    // intake() must emit the SAME legacy keys (byte-identical) post-A2.
    const { signals } = intake({ objective: g.input });
    signals.tier === g.tier && signals.domain === g.domain && signals.needsAdr === g.needsAdr
      ? rep.ok(`intake legacy keys byte-identical for "${g.input}"`)
      : rep.bad(`intake legacy keys DRIFT for "${g.input}": ${signals.tier}/${signals.domain}/${signals.needsAdr}`);

    // signals.work is purely additive — present and never replacing legacy keys.
    const LEGACY_KEYS = ['tier', 'domain', 'needsAdr', 'paths', 'phase', 'level'];
    LEGACY_KEYS.every((k) => k in signals) && signals.work && typeof signals.work.nature === 'string'
      ? rep.ok(`signals.work is a pure superset for "${g.input}"`)
      : rep.bad(`signals.work superset invariant broken for "${g.input}"`);
  }

  const SHORT_SIGNAL_NEGATIVES = ['registry cleanup', 'merge PR', 'org settings cleanup', 'forge agent package', 'large refactor', 'author documentation for command', 'fix typo in README about authorship'];
  for (const input of SHORT_SIGNAL_NEGATIVES) {
    const r = classify(input, rubric);
    r.domain === 'general' && !r.requiredAgents.includes('privacy-lgpd') && !r.requiredAgents.includes('security')
      ? rep.ok(`short signal negative held: "${input}" stays general`)
      : rep.bad(`short signal false positive: "${input}" → domain=${r.domain} agents=[${r.requiredAgents.join(',')}] tier=${r.tier}`);
  }
  classify('author documentation for command', rubric).needsAdr === false
    ? rep.ok('tier false positive held: "author" does not imply architectural auth')
    : rep.bad('"author documentation for command" unexpectedly requires ADR');
  classify('fix typo in README about authorship', rubric).tier === 'trivial'
    ? rep.ok('tier false positive held: "authorship" still classifies as trivial typo')
    : rep.bad(`"authorship" typo did not stay trivial: ${classify('fix typo in README about authorship', rubric).tier}`);
  for (const input of ['store user RG', 'user_rg field', 'CPF + consent']) {
    const r = classify(input, rubric);
    r.domain === 'lgpd' && r.requiredAgents.includes('privacy-lgpd')
      ? rep.ok(`short signal positive held: "${input}" routes LGPD`)
      : rep.bad(`short signal positive missed: "${input}" → domain=${r.domain} agents=[${r.requiredAgents.join(',')}]`);
  }
}

// ---------------------------------------------------------------------------
// F4. Matcher — deterministic, thresholded, refuse-low, confirmed always null.
// Hermetic fixture root with ONE Business candidate (capability/ENABLE).
// ---------------------------------------------------------------------------
console.log('\nF4. Matcher (deterministic + thresholded + refuse-low)...');
{
  const root = tmp();
  try {
    const bizDir = join(root, 'contextkit', 'memory', 'business', 'BIZ-9001-fixture-platform-capability');
    mkdirSync(bizDir, { recursive: true });
    writeFileSync(join(bizDir, 'business.json'), JSON.stringify({
      schemaVersion: 1, id: 'BIZ-9001', title: 'Fixture Platform Capability',
      slug: 'fixture-platform-capability', kind: 'capability',
      valueIntents: { primary: 'ENABLE', secondary: ['IMPROVE', 'RELIABILITY'] },
    }, null, 2));
    const REGISTRY = {
      schemaVersion: 1, generator: 'fixture',
      contexts: [{ id: 'BIZ-9001', path: 'business/BIZ-9001-fixture-platform-capability', type: 'business', status: 'approved', title: 'Fixture Platform Capability' }],
    };
    const opWork = {
      nature: 'operation', kind: 'fix',
      valueIntents: { primary: 'RECOVER', secondary: ['IMPROVE'] },
      growthLever: 'RELIABILITY', executionMode: 'direct', confidence: 'high', reasons: [],
    };
    // OP-0005: objective includes 'BIZ-9001' to trigger the explicitIdMatch bonus (+100),
    // pushing the integer score above the new suggested threshold (75).
    const objective = 'fix the broken BIZ-9001 platform capability rollback after the failed release';

    const m1 = matchBusiness(opWork, { root, objective, registry: REGISTRY });
    const m2 = matchBusiness(opWork, { root, objective, registry: REGISTRY });
    m1.status === 'suggested' && m1.suggested === 'BIZ-9001'
      ? rep.ok('F4. matcher suggests the fixture Business')
      : rep.bad(`F4. matcher verdict wrong: ${m1.status}/${m1.suggested}`);
    m1.score > 0 ? rep.ok(`F4. matcher score is positive integer: ${m1.score}`) : rep.bad(`F4. matcher score invalid: ${m1.score}`);
    JSON.stringify(m1) === JSON.stringify(m2) ? rep.ok('F4. matcher byte-identical across two runs') : rep.bad('F4. matcher NON-deterministic');
    m1.confirmed === null ? rep.ok('F4. matcher never sets confirmed (provenance null)') : rep.bad('F4. matcher stamped confirmed (must stay null)');

    // Below the suggested threshold → refuse-to-null.
    const lowWork = { nature: 'operation', kind: 'maintenance', valueIntents: { primary: 'COMPLY', secondary: [] }, confidence: 'high' };
    const mLow = matchBusiness(lowWork, { root, objective: 'tidy lint warnings', registry: REGISTRY });
    mLow.status === 'unlinked' && mLow.suggested === null && mLow.confirmed === null
      ? rep.ok('F4. below-threshold → suggested=null (refuse-to-null)')
      : rep.bad(`F4. below-threshold leaked a suggestion: ${mLow.status}/${mLow.suggested}`);

    // Non-operation nature → matcher skipped (Business is propose-not-auto).
    const mBiz = matchBusiness({ nature: 'business', kind: 'capability', valueIntents: { primary: 'ENABLE' } }, { root, registry: REGISTRY });
    mBiz.status === 'unlinked' && mBiz.suggested === null
      ? rep.ok('F4. non-operation nature → matcher skipped')
      : rep.bad(`F4. matcher ran for a Business: ${mBiz.status}/${mBiz.suggested}`);

    // Empty registry → unlinked, never throws.
    const mEmpty = matchBusiness(opWork, { root, objective, registry: { contexts: [] } });
    mEmpty.status === 'unlinked' && mEmpty.suggested === null
      ? rep.ok('F4. empty registry → unlinked')
      : rep.bad(`F4. empty registry leaked: ${mEmpty.status}/${mEmpty.suggested}`);
  } finally {
    clean(root);
  }
}

// ---------------------------------------------------------------------------
// F5. Hook superset / fail-open — methodology never alters the legacy checklist
// for a control input, and a classifier/matcher error never breaks the hook.
// ---------------------------------------------------------------------------
console.log('\nF5. Hook superset / fail-open...');
{
  // Legacy checklist render carries NO methodology line (pure superset).
  const fakeContract = { signals: { tier: 'feature' }, requiredBeforeWrite: ['x'], requiredBeforeCompletion: [] };
  const legacy = renderChecklist(fakeContract, 'task-c-1', true, null);
  legacy.includes('Tier: feature') ? rep.ok('F5. legacy checklist still renders the tier line') : rep.bad('F5. legacy tier line missing');
  !legacy.includes('Work:') ? rep.ok('F5. legacy checklist carries NO methodology line') : rep.bad('F5. methodology line leaked into legacy render');

  const root = tmp();
  try {
    // Control input: classification absent → runMethodology null, no proposal.
    const ctrl = runMethodology({ root, taskId: 'task-ctrl-1', objective: 'anything', work: undefined, config: { autonomy: { grade: 3 } } });
    ctrl === null ? rep.ok('F5. control input (no work) → runMethodology returns null') : rep.bad('F5. control input produced a methodology result');
    readIntakeProposal(root, 'task-ctrl-1') === null ? rep.ok('F5. control input persisted no proposal') : rep.bad('F5. control input wrote a proposal');

    // Genuine input: yields a single advisory line + persists a proposal.
    const opWork = {
      nature: 'operation', kind: 'fix', valueIntents: { primary: 'RECOVER', secondary: ['IMPROVE'] },
      growthLever: 'RELIABILITY', executionMode: 'direct', confidence: 'high', reasons: [],
    };
    const full = runMethodology({
      root, taskId: 'task-real-1', objective: 'fix the broken updater rollback',
      work: opWork, config: { autonomy: { grade: 3 } }, createdAt: '2026-06-19T00:00:00.000Z',
    });
    full && typeof full.line === 'string' && !full.line.includes('\n')
      ? rep.ok('F5. genuine input yields a single advisory line')
      : rep.bad('F5. genuine input produced no/multi-line advisory');
    readIntakeProposal(root, 'task-real-1') !== null ? rep.ok('F5. genuine input persisted a proposal') : rep.bad('F5. genuine input wrote no proposal');

    // Autonomy floor: Business is manual at every grade; Operation auto at grade 3.
    const bizAct = resolveProposedAction({ nature: 'business', kind: 'capability', confidence: 'high' }, { autonomy: { grade: 4 } });
    bizAct.mode === 'manual' && bizAct.area === 'adr'
      ? rep.ok('F5. Business stays manual even at grade 4 (human floor)')
      : rep.bad(`F5. Business escaped the manual floor: ${bizAct.mode}/${bizAct.area}`);
    const opAct = resolveProposedAction(opWork, { autonomy: { grade: 3 } });
    opAct.mode === 'auto' && opAct.area === 'edit'
      ? rep.ok('F5. Operation is auto at grade 3')
      : rep.bad(`F5. Operation not auto at grade 3: ${opAct.mode}/${opAct.area}`);
    // Low-confidence near-tie downgrades one notch (uncertain guess never auto-acts).
    const lowAct = resolveProposedAction({ ...opWork, confidence: 'low' }, { autonomy: { grade: 3 } });
    lowAct.mode === 'suggest' && lowAct.downgraded === true
      ? rep.ok('F5. low-confidence Operation downgrades auto→suggest')
      : rep.bad(`F5. low-confidence not downgraded: ${lowAct.mode}/${lowAct.downgraded}`);

    // Fail-open: a matcher/classifier error inside runMethodology degrades to null,
    // never throws. A malformed `work` (string) must not break the hook surface.
    let threw = false;
    let bad = null;
    try { bad = runMethodology({ root, taskId: 'task-bad-1', objective: 'x', work: 'not-an-object', config: { autonomy: { grade: 3 } } }); } catch { threw = true; }
    !threw && bad === null
      ? rep.ok('F5. malformed work → runMethodology fail-open to null (no throw)')
      : rep.bad(`F5. fail-open broken: threw=${threw}, result=${JSON.stringify(bad)}`);

    // The proposal store itself is fail-open + round-trips a built proposal.
    const proposal = buildIntakeProposal('task-store-1', opWork, full?.match ?? null, { objective: 'x', createdAt: '2026-06-19T00:00:00.000Z' });
    const saved = saveIntakeProposal(root, 'task-store-1', proposal);
    const round = readIntakeProposal(root, 'task-store-1');
    saved === true && JSON.stringify(round) === JSON.stringify(proposal)
      ? rep.ok('F5. proposal store round-trips a built proposal identically')
      : rep.bad('F5. proposal store round-trip mismatch');

    // The advisory line names the suggestion when the matcher found one.
    const line = renderMethodologyLine(opWork, full?.match ?? null, opAct);
    typeof line === 'string' && !line.includes('\n')
      ? rep.ok('F5. renderMethodologyLine emits a single line')
      : rep.bad('F5. renderMethodologyLine multi-line/invalid');
  } finally {
    clean(root);
  }
}

rep.finish('integration-classify-bdm (BIZ-0001/WF-0036 A2)');
