/**
 * selfcheck-enforcement-gate.mjs — evaluateAction invariants (CDK-032/033/035, ADR-0072).
 *
 * Asserts the structural and behavioral contracts of evaluate-action.mjs:
 *   1. Exports: evaluateAction and toolMoment are present.
 *   2. Tool→moment mapping: all canonical mappings are correct.
 *   3. Null contract or null moment → always allow.
 *   4. Advisory NEVER denies (workflow-missing and explore-budget cases).
 *   5. Guarded + beforeWrite + workflow-missing → deny.
 *   6. Strict + any reasonCode → deny.
 *   7. Trivial tier is exempt from CDK-033 workflow rule.
 *
 * Entry point: `runEnforcementGateChecks(rep, { KIT })`.
 */
import { resolve } from 'node:path';

/**
 * Runs all evaluateAction structural invariant checks.
 *
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} rep reporter
 * @param {{ KIT: string }} ctx KIT is the repo root (parent of tools/)
 */
export async function runEnforcementGateChecks(rep, { KIT }) {
  const { ok, bad } = rep;
  console.log('Checking evaluateAction (CDK-032/033/035, ADR-0072)...');

  const EVAL_PATH = resolve(KIT, 'templates/contextkit/runtime/execution/evaluate-action.mjs');
  let evalMod;
  try {
    evalMod = await import('file://' + EVAL_PATH.replaceAll('\\', '/'));
  } catch (err) {
    bad(`evaluate-action.mjs failed to import: ${err?.message ?? err}`);
    return;
  }

  const { evaluateAction, toolMoment } = evalMod;
  typeof evaluateAction === 'function' ? ok('export: evaluateAction present') : bad('export: evaluateAction missing');
  typeof toolMoment === 'function' ? ok('export: toolMoment present') : bad('export: toolMoment missing');

  // --- Tool → moment mapping ---
  toolMoment('Read', {}) === 'beforeExploration' ? ok('toolMoment: Read -> beforeExploration') : bad('toolMoment: Read not beforeExploration');
  toolMoment('Grep', {}) === 'beforeExploration' ? ok('toolMoment: Grep -> beforeExploration') : bad('toolMoment: Grep not beforeExploration');
  toolMoment('Glob', {}) === 'beforeExploration' ? ok('toolMoment: Glob -> beforeExploration') : bad('toolMoment: Glob not beforeExploration');
  toolMoment('Edit', {}) === 'beforeWrite' ? ok('toolMoment: Edit -> beforeWrite') : bad('toolMoment: Edit not beforeWrite');
  toolMoment('Write', {}) === 'beforeWrite' ? ok('toolMoment: Write -> beforeWrite') : bad('toolMoment: Write not beforeWrite');
  toolMoment('MultiEdit', {}) === 'beforeWrite' ? ok('toolMoment: MultiEdit -> beforeWrite') : bad('toolMoment: MultiEdit not beforeWrite');
  toolMoment('Bash', { command: 'grep -r foo .' }) === 'beforeExploration' ? ok('toolMoment: Bash broad grep -> beforeExploration') : bad('toolMoment: Bash broad grep wrong moment');
  toolMoment('Bash', { command: 'node build.mjs > out.js' }) === 'beforeWrite' ? ok('toolMoment: Bash redirect -> beforeWrite') : bad('toolMoment: Bash redirect wrong moment');
  toolMoment('Bash', { command: 'npm test' }) === null ? ok('toolMoment: Bash npm test -> null') : bad('toolMoment: Bash npm test should be null');
  toolMoment('Task', {}) === null ? ok('toolMoment: Task -> null') : bad('toolMoment: Task should be null');

  // Shared helpers (pure; no disk I/O).
  const baseState = (overrides = {}) => ({
    scope: { branch: 'feat/sc', taskId: 'task-sc-eval', paths: [] },
    root: '/nonexistent',
    requiresHumanApproval: false,
    activeWorkflow: true,
    projectMapFresh: true,
    broadSearchCount: 0,
    exploreBudget: 2,
    ...overrides,
  });

  const featureContract = (writeReqs = []) => ({
    signals: { tier: 'feature' },
    requiredBeforeExploration: [],
    requiredBeforeWrite: writeReqs,
    requiredBeforeCompletion: [],
  });

  // 1. Null contract → always allow (silent), regardless of mode.
  {
    const r = evaluateAction({ tool: 'Edit', input: {}, contract: null, projectState: baseState(), mode: 'strict' });
    r.decision === 'allow' && r.reasonCodes.length === 0
      ? ok('null contract: Edit strict -> allow')
      : bad(`null contract: expected allow, got ${r.decision} codes=[${r.reasonCodes}]`);
  }

  // 2. Null moment (unmonitored tool) → always allow.
  {
    const r = evaluateAction({ tool: 'Task', input: {}, contract: featureContract(), projectState: baseState(), mode: 'strict' });
    r.decision === 'allow'
      ? ok('null moment: Task strict -> allow')
      : bad(`null moment: expected allow, got ${r.decision}`);
  }

  // 3. Advisory + workflow-missing → warn (NEVER deny) — CDK-033.
  {
    const r = evaluateAction({ tool: 'Edit', input: {}, contract: featureContract(), projectState: baseState({ activeWorkflow: false }), mode: 'advisory' });
    r.decision === 'warn' ? ok('advisory + no workflow: Edit -> warn (never deny)') : bad(`advisory + no workflow: expected warn, got ${r.decision}`);
    r.reasonCodes.includes('workflow-missing') ? ok('advisory: workflow-missing reasonCode present') : bad(`advisory: workflow-missing missing — codes=[${r.reasonCodes}]`);
  }

  // 4. Guarded + beforeWrite + workflow-missing → deny — CDK-033.
  {
    const r = evaluateAction({ tool: 'Edit', input: {}, contract: featureContract(), projectState: baseState({ activeWorkflow: false }), mode: 'guarded' });
    r.decision === 'deny' ? ok('guarded + no workflow + beforeWrite -> deny') : bad(`guarded + no workflow: expected deny, got ${r.decision}`);
  }

  // 5. Strict + explore-budget exceeded → deny — CDK-035.
  {
    const r = evaluateAction({ tool: 'Read', input: {}, contract: featureContract(), projectState: baseState({ projectMapFresh: false, broadSearchCount: 5 }), mode: 'strict' });
    r.decision === 'deny' ? ok('strict + stale map + over budget -> deny') : bad(`strict + explore-budget: expected deny, got ${r.decision}`);
    r.reasonCodes.includes('explore-budget') ? ok('strict + explore-budget: reasonCode present') : bad(`strict: explore-budget code missing — codes=[${r.reasonCodes}]`);
  }

  // 6. Advisory + exploration-budget → warn — CDK-035.
  {
    const r = evaluateAction({ tool: 'Read', input: {}, contract: featureContract(), projectState: baseState({ projectMapFresh: false, broadSearchCount: 3 }), mode: 'advisory' });
    r.decision === 'warn' ? ok('advisory + explore-budget -> warn (never deny)') : bad(`advisory + explore-budget: expected warn, got ${r.decision}`);
  }

  // 7. No reasonCodes + strict → allow.
  {
    const r = evaluateAction({ tool: 'Edit', input: {}, contract: featureContract(), projectState: baseState({ activeWorkflow: true }), mode: 'strict' });
    r.decision === 'allow' && r.reasonCodes.length === 0
      ? ok('no reason codes + strict -> allow')
      : bad(`no reason codes: expected allow, got ${r.decision} codes=[${r.reasonCodes}]`);
  }

  // 8. Trivial tier exempt from CDK-033 workflow rule.
  {
    const trivial = { signals: { tier: 'trivial' }, requiredBeforeExploration: [], requiredBeforeWrite: [], requiredBeforeCompletion: [] };
    const r = evaluateAction({ tool: 'Edit', input: {}, contract: trivial, projectState: baseState({ activeWorkflow: false }), mode: 'guarded' });
    r.decision === 'allow' ? ok('trivial tier + no workflow + guarded -> allow (CDK-033 not applicable)') : bad(`trivial tier: expected allow, got ${r.decision} codes=[${r.reasonCodes}]`);
  }
}
