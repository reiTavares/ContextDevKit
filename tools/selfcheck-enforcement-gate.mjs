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

  // ---------------------------------------------------------------------------
  // CDK-031: execution-contract-hook pure helper checks
  // ---------------------------------------------------------------------------
  console.log('Checking execution-contract-hook helpers (CDK-031)...');

  const HOOK_PATH = resolve(KIT, 'templates/contextkit/runtime/hooks/execution-contract-hook.mjs');
  let hookMod;
  try {
    hookMod = await import('file://' + HOOK_PATH.replaceAll('\\', '/'));
  } catch (err) {
    bad(`execution-contract-hook.mjs failed to import: ${err?.message ?? err}`);
    return;
  }

  const { isAdminCommand, isPureConversation, looksLikeNewTask, mintTaskId, resolveTaskId, renderChecklist } = hookMod;
  typeof isAdminCommand === 'function' ? ok('CDK-031: isAdminCommand exported') : bad('CDK-031: isAdminCommand missing');
  typeof isPureConversation === 'function' ? ok('CDK-031: isPureConversation exported') : bad('CDK-031: isPureConversation missing');
  typeof looksLikeNewTask === 'function' ? ok('CDK-031: looksLikeNewTask exported') : bad('CDK-031: looksLikeNewTask missing');
  typeof mintTaskId === 'function' ? ok('CDK-031: mintTaskId exported') : bad('CDK-031: mintTaskId missing');
  typeof resolveTaskId === 'function' ? ok('CDK-031: resolveTaskId exported') : bad('CDK-031: resolveTaskId missing');
  typeof renderChecklist === 'function' ? ok('CDK-031: renderChecklist exported') : bad('CDK-031: renderChecklist missing');

  // Admin command detection.
  isAdminCommand('/log-session') ? ok('CDK-031: /cmd -> isAdminCommand') : bad('CDK-031: /cmd not detected as admin');
  !isAdminCommand('implement auth') ? ok('CDK-031: task not flagged as admin') : bad('CDK-031: task wrongly flagged as admin');

  // Pure conversation detection.
  isPureConversation('hi') ? ok('CDK-031: short prompt -> conversation') : bad('CDK-031: short prompt not flagged');
  isPureConversation('What does this function do?') ? ok('CDK-031: question prompt -> conversation') : bad('CDK-031: question not flagged');
  !isPureConversation('Implement the auth migration and add tests') ? ok('CDK-031: task prompt not flagged as conversation') : bad('CDK-031: task wrongly flagged as conversation');

  // New-task verb detection.
  looksLikeNewTask('implement the auth flow') ? ok('CDK-031: looksLikeNewTask: implement') : bad('CDK-031: implement not detected');
  looksLikeNewTask('please refactor the config loader') ? ok('CDK-031: looksLikeNewTask: please/refactor') : bad('CDK-031: please/refactor not detected');
  !looksLikeNewTask('sounds good, continue') ? ok('CDK-031: follow-up not flagged as new task') : bad('CDK-031: follow-up wrongly flagged');

  // mintTaskId produces sequential ids.
  {
    const ledger0 = { taskCounter: 0 };
    const { taskId: t1, counter: c1 } = mintTaskId(ledger0, 'sess1234');
    t1 === 'task-sess1234-1' ? ok('CDK-031: mintTaskId first id correct') : bad(`CDK-031: mintTaskId first id wrong: ${t1}`);
    c1 === 1 ? ok('CDK-031: mintTaskId counter=1') : bad(`CDK-031: mintTaskId counter=${c1}`);

    const ledger1 = { taskCounter: 1 };
    const { taskId: t2, counter: c2 } = mintTaskId(ledger1, 'sess1234');
    t2 === 'task-sess1234-2' ? ok('CDK-031: mintTaskId second id correct') : bad(`CDK-031: mintTaskId second id wrong: ${t2}`);
    c2 === 2 ? ok('CDK-031: mintTaskId counter=2') : bad(`CDK-031: mintTaskId counter=${c2}`);
  }

  // resolveTaskId: no existing task -> new task.
  {
    const ledger = { taskCounter: 0 };
    const { taskId, isNew } = resolveTaskId('implement auth', ledger, 'abcd1234');
    isNew ? ok('CDK-031: resolveTaskId: no activeTask -> isNew=true') : bad('CDK-031: resolveTaskId: expected isNew=true');
    taskId.startsWith('task-abcd1234-') ? ok('CDK-031: resolveTaskId: minted id prefix correct') : bad(`CDK-031: resolveTaskId id: ${taskId}`);
  }

  // resolveTaskId: existing task + follow-up phrase -> reuse.
  {
    const ledger = { activeTask: 'task-abcd1234-1', taskCounter: 1 };
    const { taskId, isNew } = resolveTaskId('sounds good, continue with that', ledger, 'abcd1234');
    !isNew ? ok('CDK-031: resolveTaskId: follow-up -> reuse activeTask') : bad('CDK-031: resolveTaskId: follow-up wrongly minted new task');
    taskId === 'task-abcd1234-1' ? ok('CDK-031: resolveTaskId: reused correct taskId') : bad(`CDK-031: resolveTaskId: reused id wrong: ${taskId}`);
  }

  // resolveTaskId: existing task + new-task verb -> new task.
  {
    const ledger = { activeTask: 'task-abcd1234-1', taskCounter: 1 };
    const { taskId, isNew } = resolveTaskId('now implement the schema migration', ledger, 'abcd1234');
    isNew ? ok('CDK-031: resolveTaskId: new-task verb -> isNew=true') : bad('CDK-031: resolveTaskId: new-task verb not detected');
    taskId === 'task-abcd1234-2' ? ok('CDK-031: resolveTaskId: minted sequential id') : bad(`CDK-031: resolveTaskId: id wrong: ${taskId}`);
  }

  // renderChecklist: contains tier and is short (<=8 lines).
  {
    const sampleContract = {
      signals: { tier: 'feature' },
      requiredBeforeWrite: ['qa-signoff'],
      requiredBeforeCompletion: [],
    };
    const output = renderChecklist(sampleContract, 'task-abcd1234-1', true);
    const lineCount = output.trim().split('\n').length;
    output.includes('Tier: feature') ? ok('CDK-031: renderChecklist: tier in output') : bad('CDK-031: renderChecklist: tier missing');
    output.includes('task-abcd1234-1') ? ok('CDK-031: renderChecklist: taskId in output') : bad('CDK-031: renderChecklist: taskId missing');
    output.includes('qa-signoff') ? ok('CDK-031: renderChecklist: required cap in output') : bad('CDK-031: renderChecklist: qa-signoff missing');
    lineCount <= 8 ? ok(`CDK-031: renderChecklist: short output (${lineCount} lines)`) : bad(`CDK-031: renderChecklist: too long (${lineCount} lines)`);
    output.includes('New task') ? ok('CDK-031: renderChecklist: new task label') : bad('CDK-031: renderChecklist: new task label missing');
  }

  // renderChecklist: follow-up label.
  {
    const contract = { signals: { tier: 'trivial' }, requiredBeforeWrite: [], requiredBeforeCompletion: [] };
    const output = renderChecklist(contract, 'task-abcd1234-1', false);
    output.includes('Follow-up') ? ok('CDK-031: renderChecklist: follow-up label') : bad('CDK-031: renderChecklist: follow-up label missing');
    output.includes('No required capabilities') ? ok('CDK-031: renderChecklist: trivial tier no-caps message') : bad('CDK-031: renderChecklist: no-caps message missing');
  }

  // ---------------------------------------------------------------------------
  // CDK-034: indirect-write-reconcile pure helpers
  // ---------------------------------------------------------------------------
  console.log('Checking indirect-write-reconcile pure helpers (CDK-034, ADR-0072)...');

  const RECONCILE_PATH = resolve(KIT, 'templates/contextkit/runtime/hooks/indirect-write-reconcile.mjs');
  let reconcileMod;
  try {
    reconcileMod = await import('file://' + RECONCILE_PATH.replaceAll('\\', '/'));
  } catch (err) {
    bad(`indirect-write-reconcile.mjs failed to import: ${err?.message ?? err}`);
    return;
  }

  const { reconcileIndirectWrites, classifyOrigin } = reconcileMod;
  typeof reconcileIndirectWrites === 'function'
    ? ok('CDK-034: reconcileIndirectWrites exported')
    : bad('CDK-034: reconcileIndirectWrites missing');
  typeof classifyOrigin === 'function'
    ? ok('CDK-034: classifyOrigin exported')
    : bad('CDK-034: classifyOrigin missing');

  // reconcileIndirectWrites: indirect detection (direct edit not in indirect).
  {
    const r = reconcileIndirectWrites({
      changedFiles: ['src/foo.ts', 'src/bar.ts'],
      directEdits: ['src/foo.ts'],
      contractPaths: ['src/foo.ts', 'src/bar.ts'],
    });
    r.indirect.length === 1 && r.indirect[0] === 'src/bar.ts'
      ? ok('CDK-034: indirect: direct edit excluded from indirect list')
      : bad(`CDK-034: indirect: unexpected result ${JSON.stringify(r.indirect)}`);
    r.outOfContract.length === 0
      ? ok('CDK-034: indirect: in-contract indirect not flagged as outOfContract')
      : bad(`CDK-034: indirect: outOfContract should be empty, got ${JSON.stringify(r.outOfContract)}`);
  }

  // reconcileIndirectWrites: outOfContract detection.
  {
    const r = reconcileIndirectWrites({
      changedFiles: ['src/foo.ts', 'scripts/gen.ts'],
      directEdits: [],
      contractPaths: ['src/foo.ts'],
    });
    r.outOfContract.length === 1 && r.outOfContract[0] === 'scripts/gen.ts'
      ? ok('CDK-034: outOfContract: file outside contract paths detected')
      : bad(`CDK-034: outOfContract wrong: ${JSON.stringify(r.outOfContract)}`);
  }

  // reconcileIndirectWrites: empty contractPaths → outOfContract always empty.
  {
    const r = reconcileIndirectWrites({
      changedFiles: ['anything.ts'],
      directEdits: [],
      contractPaths: [],
    });
    r.outOfContract.length === 0
      ? ok('CDK-034: empty contract paths -> outOfContract always empty (no false positives)')
      : bad(`CDK-034: empty contract should produce no outOfContract, got ${JSON.stringify(r.outOfContract)}`);
  }

  // classifyOrigin mapping verification.
  {
    const cases = [
      ['Edit', '', 'direct-edit'],
      ['Write', '', 'direct-edit'],
      ['MultiEdit', '', 'direct-edit'],
      ['Bash', 'prettier --write .', 'allowed-formatter'],
      ['Bash', 'node codegen.mjs generate schema', 'allowed-generator'],
      ['Bash', 'npm test', 'shell'],
      ['mcp__drive__create_file', '', 'mcp'],
      ['SomeOtherTool', '', 'external'],
    ];
    const wrong = cases.filter(([tool, cmd, want]) => classifyOrigin(tool, cmd) !== want);
    wrong.length === 0
      ? ok(`CDK-034: classifyOrigin mapping holds (${cases.length} cases)`)
      : bad(`CDK-034: classifyOrigin wrong: ${wrong.map(([t, , w]) => `${t}→${w}`).join(', ')}`);
  }}
