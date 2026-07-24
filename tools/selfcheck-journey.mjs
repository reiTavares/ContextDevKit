#!/usr/bin/env node
/**
 * Selfcheck — methodology journey map + verifier (ADR-0127, Phase 2 first cut).
 *
 * Locks two things:
 *   1. policy/journey.json integrity — valid JSON, every branch stage resolves to a
 *      defined stage, every stage carries id/requires, enforcement block present.
 *   2. The pure verifier (journey-verifier.mjs) — branch selection + stage verdicts
 *      (satisfied / pending on unknown / blocked on false) + current-stage/next-command.
 *
 * Run:  node tools/selfcheck-journey.mjs
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reporter } from './it-helpers.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const rep = reporter();
const { ok, bad } = rep;

const load = (rel) => import('file:///' + resolve(KIT, rel).replaceAll('\\', '/'));

async function main() {
  console.log('\n🌀 Selfcheck — methodology journey map + verifier (ADR-0127)\n');

  // ── 1. journey.json integrity ──────────────────────────────────────────────
  let journey;
  try {
    journey = JSON.parse(readFileSync(resolve(KIT, 'templates/contextkit/policy/journey.json'), 'utf8'));
    ok('policy/journey.json is valid JSON');
  } catch (err) {
    bad(`journey.json unreadable/invalid: ${err?.message ?? err}`);
    rep.finish('methodology journey map + verifier');
    return;
  }

  const stageIds = new Set((journey.stages || []).map((s) => s.id));
  const branches = Object.entries(journey.branches || {});
  const expectedBranches = [
    'operation-direct',
    'operation-batch',
    'operation-workflow',
    'business-decision',
    'business-workflow',
  ];
  JSON.stringify(Object.keys(journey.branches || {}).sort()) === JSON.stringify([...expectedBranches].sort())
    ? ok('journey defines the five canonical ceremony branches')
    : bad(`journey branch set is wrong: ${JSON.stringify(Object.keys(journey.branches || {}))}`);

  let danglingFound = false;
  for (const [branch, seq] of branches) {
    for (const stageId of seq) if (!stageIds.has(stageId)) { bad(`branch "${branch}" references missing stage "${stageId}"`); danglingFound = true; }
  }
  if (!danglingFound) ok('every branch stage resolves to a defined stage (referential integrity)');

  branches.every(([, sequence]) => sequence.at(-1) === 'done-move')
    ? ok('every branch terminates at the universal done-move stage')
    : bad('every branch must terminate at done-move');

  const taskBranches = branches.filter(([, sequence]) => sequence.includes('tasks-authoring')).map(([id]) => id).sort();
  JSON.stringify(taskBranches) === JSON.stringify(['business-workflow', 'operation-batch', 'operation-workflow'])
    ? ok('tasks authoring exists only on batch/workflow/program branches')
    : bad(`tasks authoring branch set is wrong: ${JSON.stringify(taskBranches)}`);

  const wellFormed = (journey.stages || []).every((s) => s.id && Array.isArray(s.requires) && typeof s.checkpoint === 'string');
  wellFormed ? ok('every stage carries id + requires[] + checkpoint') : bad('a stage is missing id/requires/checkpoint');

  journey.enforcement && typeof journey.enforcement.mode === 'string'
    ? ok(`enforcement block present (first cut mode: ${journey.enforcement.mode})`)
    : bad('enforcement block missing');

  // ── 2. the pure verifier ───────────────────────────────────────────────────
  const { loadJourneyManifest, selectBranch, verifyJourney, verifyCanonicalJourney } =
    await load('templates/contextkit/runtime/work/journey-verifier.mjs');
  const ceremonyManifest = loadJourneyManifest(KIT);

  selectBranch({ nature: 'business' }) === 'business-decision'
    && selectBranch({ nature: 'business', executionMode: 'workflow' }) === 'business-workflow'
    && selectBranch({ nature: 'operation', executionMode: 'batch' }) === 'operation-batch'
    && selectBranch({ nature: 'operation', executionMode: 'workflow' }) === 'operation-workflow'
    && selectBranch({ nature: 'operation', executionMode: 'direct' }) === 'operation-direct'
    && selectBranch({ ceremonyShape: 'multi-workflow-program' }, ceremonyManifest) === 'business-workflow'
    && selectBranch({}) === null
    ? ok('selectBranch maps nature+ceremony correctly (and null when unknown)')
    : bad('selectBranch mapping is wrong');

  // All-satisfied evidence → current stage advances to the end (null next).
  const allTrue = {};
  for (const s of journey.stages) for (const c of s.requires) allTrue[c] = true;
  for (const s of journey.canonicalWorkJourney?.stages || []) allTrue[s.checkpoint] = true;
  const done = verifyJourney(journey, 'operation-direct', allTrue);
  done && done.currentStageId === null && done.blocked.length === 0
    ? ok('verifier: all-satisfied evidence → no current stage, no blocks')
    : bad(`verifier: expected complete journey; got ${JSON.stringify(done && { cur: done.currentStageId, blocked: done.blocked.length })}`);

  // Empty evidence → first stage is current (pending), nextCommand present.
  const fresh = verifyJourney(journey, 'operation-workflow', {});
  fresh && fresh.currentStageId === 'intake' && fresh.nextCommand
    ? ok('verifier: empty evidence → current stage is "intake" with a next command')
    : bad(`verifier: expected intake-as-current; got ${JSON.stringify(fresh && fresh.currentStageId)}`);

  // A false checkpoint → that stage is blocked.
  const blockedEv = { ...allTrue, workflowNestedUnderOwner: false };
  const blk = verifyJourney(journey, 'operation-workflow', blockedEv);
  blk && blk.blocked.some((s) => s.id === 'workflow-nested' && s.unmet.includes('workflowNestedUnderOwner'))
    ? ok('verifier: a false checkpoint blocks its stage (workflow-nested)')
    : bad('verifier: false checkpoint did not block the stage');

  // Unknown (null) checkpoint → pending, not satisfied, not blocked.
  const unknownEv = { ...allTrue, testsGreen: null };
  const unk = verifyJourney(journey, 'operation-workflow', unknownEv);
  const testsStage = unk && unk.stages.find((s) => s.id === 'tests');
  testsStage && testsStage.state === 'pending' && unk.blocked.every((s) => s.id !== 'tests')
    ? ok('verifier: an unknown checkpoint is pending (graceful degradation, never silently passed)')
    : bad('verifier: unknown checkpoint mishandled');

  const freshBatch = verifyJourney(journey, 'operation-batch', {});
  freshBatch?.stages.find((stage) => stage.id === 'tasks-authoring')?.state === 'skipped'
    ? ok('tasks authoring is advisory/skipped until populated on a fresh install')
    : bad('fresh-install tasks authoring must not fail-close');

  const afterDoneEvidence = { ...allTrue, sessionLogged: null };
  const afterDone = verifyJourney(journey, 'operation-direct', afterDoneEvidence);
  afterDone?.currentStageId === 'log-session' && afterDone.nextCommand?.slash === 'log-session'
    ? ok('done-move satisfaction advances to the exact post-terminal log command')
    : bad(`post-terminal log step is unreachable: ${JSON.stringify(afterDone?.currentStageId)}`);

  verifyJourney(journey, 'no-such-branch', {}) === null
    ? ok('verifier: unknown branch → null (defensive)')
    : bad('verifier: unknown branch should return null');

  // Canonical Work Journey is an ordered projection, not a second state machine.
  const canonical = verifyCanonicalJourney(journey, {});
  JSON.stringify(canonical?.order) === JSON.stringify(['graph', 'economy', 'ddd-governance', 'implementation', 'qa'])
    && canonical.currentStageId === 'graph'
    ? ok('canonical journey exposes the five stages in order and starts at graph')
    : bad(`canonical journey order/current stage is wrong: ${JSON.stringify(canonical)}`);

  const canonicalFalse = verifyCanonicalJourney(journey, { canonicalApplicable: true, graphReady: true, economyResolved: false });
  canonicalFalse?.blocked.some((stage) => stage.id === 'economy')
    ? ok('canonical journey blocks a positively false economy checkpoint')
    : bad('canonical journey did not block a false economy checkpoint');

  const canonicalSkipped = verifyCanonicalJourney(journey, { canonicalApplicable: false });
  canonicalSkipped?.stages.every((stage) => stage.state === 'skipped')
    ? ok('canonical journey skips explicitly non-applicable work')
    : bad('canonical journey mishandled non-applicable work');

  // ── 3. the surfacing layer (evidence from signals + advisory render) ────────
  const { evidenceFromSignals, renderJourneyAdvisory } = await load('templates/contextkit/runtime/hooks/journey-surface.mjs');

  const ev = evidenceFromSignals({ tier: 'trivial', work: { nature: 'operation', decisions: { primary: 'ADR-0001' } } });
  ev.intakeRecorded === true && ev.governingAdrAccepted === true && ev.atShipPhaseOrTrivial === true
    ? ok('surface: evidenceFromSignals derives intake/govAdr/trivial from signals')
    : bad(`surface: evidenceFromSignals wrong: ${JSON.stringify(ev)}`);

  Object.keys(evidenceFromSignals({})).length === 1
    ? ok('surface: bare signals yield only intakeRecorded (rest unknown → pending)')
    : bad('surface: bare signals leaked extra evidence');

  const block = renderJourneyAdvisory(KIT, { work: { nature: 'operation', executionMode: 'direct' } });
  block.includes('‹CONTEXTKIT-JOURNEY branch=operation-direct›') && block.includes('canonical:') && block.includes('next:') && /work\.mjs|\//.test(block)
    ? ok('surface: renderJourneyAdvisory emits branch + next command for operation work')
    : bad(`surface: advisory block malformed: ${JSON.stringify(block)}`);

  renderJourneyAdvisory(KIT, { work: {} }) === ''
    ? ok('surface: no resolvable branch → empty string (intake banner covers it)')
    : bad('surface: expected empty string when branch unresolved');

  block.includes('(guarded — ADR-0127 current posture)')
    ? ok('surface label is derived from the current enforcement posture')
    : bad('surface label is stale or hardcoded');

  const { projectLifecycleMap, renderLifecycleMap, assertLifecycleMapProjection } =
    await load('templates/contextkit/runtime/work/lifecycle-map.mjs');
  const manifest = JSON.parse(readFileSync(resolve(KIT, 'templates/contextkit/methodology/templates/manifest.json'), 'utf8'));
  const map = projectLifecycleMap(journey, manifest, {
    ceremonyShape: 'multi-workflow-program',
    journeyPhase: 'testing',
  });
  const renderedMap = renderLifecycleMap(map);
  map?.branchId === 'business-workflow' && map?.stageId === 'tests' && renderedMap.includes('branch: business-workflow')
    ? ok('Lifecycle Map is derived from journey + manifest + state')
    : bad(`Lifecycle Map projection is wrong: ${JSON.stringify(map)}`);

  const lifecycleState = JSON.parse(readFileSync(resolve(KIT, 'tools/fixtures/wf0085/lifecycle-state.json'), 'utf8'));
  const lifecycleArtifact = readFileSync(resolve(KIT, 'tools/fixtures/wf0085/lifecycle-map.md'), 'utf8');
  let ciProjectionVerified = false;
  try {
    ciProjectionVerified = assertLifecycleMapProjection(lifecycleArtifact, journey, manifest, lifecycleState);
  } catch {
    ciProjectionVerified = false;
  }
  ciProjectionVerified
    ? ok('CI fixture map exactly equals projection(journey + manifest + state)')
    : bad('CI fixture Lifecycle Map drifted from its canonical projection');

  const businessCloseMap = projectLifecycleMap(journey, manifest, {
    ceremonyShape: 'multi-workflow-program',
    journeyPhase: 'done',
    childWorkflowsDone: true,
  });
  businessCloseMap?.nextCommand?.includes('work.mjs close')
    && businessCloseMap.nextCommand.includes('--actor human')
    ? ok('business-workflow resolves Business close only after child workflows are done')
    : bad(`business-workflow terminal resolution is wrong: ${JSON.stringify(businessCloseMap)}`);

  const postTerminalMap = projectLifecycleMap(journey, manifest, {
    ceremonyShape: 'quick-fix',
    overallStatus: 'done',
    journeyPhase: 'conclusion',
  });
  postTerminalMap?.stageId === 'log-session' && postTerminalMap.nextCommand === '/log-session'
    ? ok('Lifecycle Map renders the post-terminal log command after done')
    : bad(`Lifecycle Map post-terminal projection is wrong: ${JSON.stringify(postTerminalMap)}`);

  let handEditRejected = false;
  try {
    assertLifecycleMapProjection(`${renderedMap}\nhand-edit: true`, journey, manifest, {
      ceremonyShape: 'multi-workflow-program',
      journeyPhase: 'testing',
    });
  } catch {
    handEditRejected = true;
  }
  handEditRejected
    ? ok('Lifecycle Map rejects hand-edited content')
    : bad('Lifecycle Map accepted a hand edit');

  const workCli = resolve(KIT, 'templates/contextkit/tools/scripts/work.mjs');
  const nextOutput = execFileSync(process.execPath, [
    workCli,
    'next',
    '--state',
    resolve(KIT, 'tools/fixtures/wf0085/lifecycle-state.json'),
  ], { cwd: KIT, encoding: 'utf8' });
  nextOutput === 'npm test\n'
    ? ok('work next prints the exact next command and nothing else')
    : bad(`work next output is not exact: ${JSON.stringify(nextOutput)}`);

  const failOpenOutput = execFileSync(process.execPath, [
    workCli,
    'next',
    '--state',
    resolve(KIT, 'missing-workflow-state.json'),
    '--shape',
    'multi-workflow-program',
    '--branch',
    'business-workflow',
  ], { cwd: KIT, encoding: 'utf8' });
  failOpenOutput === ''
    ? ok('work next is silent/fail-open when journey state cannot resolve')
    : bad(`work next should be silent on unresolved state: ${JSON.stringify(failOpenOutput)}`);

  const disabledOutput = execFileSync(process.execPath, [
    workCli,
    'next',
    '--state',
    resolve(KIT, 'tools/fixtures/wf0085/lifecycle-state.json'),
  ], {
    cwd: KIT,
    encoding: 'utf8',
    env: { ...process.env, CONTEXTKIT_WORK_DISCOVERY: '0' },
  });
  disabledOutput === ''
    ? ok('work discovery disable path is silent and leaves the journey intact')
    : bad(`work discovery disable path emitted output: ${JSON.stringify(disabledOutput)}`);

  const { handleNext } = await load('templates/contextkit/tools/scripts/work-next.mjs');
  const readOnlyReceipt = handleNext({
    flags: { state: resolve(KIT, 'tools/fixtures/wf0085/lifecycle-state.json') },
    root: KIT,
  });
  readOnlyReceipt.applied === false && readOnlyReceipt.writes.length === 0
    ? ok('work next is read-only: applied=false and writes=[]')
    : bad(`work next attempted a mutation: ${JSON.stringify(readOnlyReceipt)}`);

  const activeRoot = mkdtempSync(join(tmpdir(), 'wf0085-active-'));
  try {
    const policyDir = join(activeRoot, 'templates', 'contextkit', 'policy');
    const manifestDir = join(activeRoot, 'templates', 'contextkit', 'methodology', 'templates');
    const businessDir = join(activeRoot, 'contextkit', 'memory', 'business', 'BIZ-0001-demo');
    const workflowDir = join(businessDir, 'workflows', 'WF-0001-demo');
    mkdirSync(policyDir, { recursive: true });
    mkdirSync(manifestDir, { recursive: true });
    mkdirSync(workflowDir, { recursive: true });
    writeFileSync(join(policyDir, 'journey.json'), JSON.stringify(journey, null, 2));
    writeFileSync(join(manifestDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    writeFileSync(join(activeRoot, 'contextkit', 'config.json'), JSON.stringify({
      business: { rootBusinessId: 'BIZ-0001' },
    }));
    writeFileSync(join(businessDir, 'business.json'), JSON.stringify({
      id: 'BIZ-0001',
      status: 'active',
      intake: { programProfile: 'multi-workflow', ceremony: 'workflow' },
    }));
    writeFileSync(join(workflowDir, 'workflow-plan.json'), JSON.stringify({
      workflowId: 'WF-0001',
      slug: 'demo',
      profile: 'program',
      journey: { shape: 'multi-workflow-program', journeyBranch: 'business-workflow' },
    }));
    writeFileSync(join(workflowDir, 'workflow-state.json'), JSON.stringify({
      workflowId: 'WF-0001',
      overallStatus: 'not-started',
      journeyPhase: 'testing',
      taskStates: { 'DJ0-T1': { status: 'done' } },
    }));
    writeFileSync(join(workflowDir, 'index.md'), [
      '---',
      'slug: demo',
      'number: 0001',
      'currentPhase: intake',
      '---',
      '',
      '# Demo',
      '',
    ].join('\n'));
    const activeOutput = execFileSync(process.execPath, [workCli, 'next'], {
      cwd: activeRoot,
      encoding: 'utf8',
    });
    activeOutput === 'npm test\n'
      ? ok('work next resolves the authoritative active workflow without hints')
      : bad(`work next active-context output is wrong: ${JSON.stringify(activeOutput)}`);

    const operationDir = join(activeRoot, 'contextkit', 'memory', 'operations', 'OP-0001-demo');
    mkdirSync(operationDir, { recursive: true });
    writeFileSync(join(operationDir, 'operation.json'), JSON.stringify({
      id: 'OP-0001',
      title: 'Demo operation',
      executionMode: 'direct',
    }));
    const operationMap = execFileSync(process.execPath, [workCli, 'map', '--id', 'OP-0001'], {
      cwd: activeRoot,
      encoding: 'utf8',
    });
    operationMap.includes('branch: operation-direct') && operationMap.includes('stage: implement')
      ? ok('work map derives a non-workflow Operation context')
      : bad(`Operation context map is wrong: ${JSON.stringify(operationMap)}`);

    const batchDir = join(activeRoot, 'contextkit', 'memory', 'operations', 'OP-0002-batch');
    mkdirSync(batchDir, { recursive: true });
    writeFileSync(join(batchDir, 'operation.json'), JSON.stringify({
      id: 'OP-0002',
      title: 'Demo batch',
      executionMode: 'batch',
    }));
    const batchNext = execFileSync(process.execPath, [workCli, 'next', '--id', 'OP-0002'], {
      cwd: activeRoot,
      encoding: 'utf8',
    });
    batchNext === 'node contextkit/tools/scripts/work.mjs start --id OP-#### --apply\n'
      ? ok('work next emits exactly one executable command for a batch Operation')
      : bad(`batch Operation next command is wrong: ${JSON.stringify(batchNext)}`);

    writeFileSync(join(workflowDir, 'workflow-state.json'), JSON.stringify({
      workflowId: 'WF-0001',
      overallStatus: 'done',
      journeyPhase: 'conclusion',
      taskStates: { 'DJ0-T1': { status: 'done' } },
    }));
    const businessClose = execFileSync(process.execPath, [workCli, 'next', '--id', 'BIZ-0001'], {
      cwd: activeRoot,
      encoding: 'utf8',
    });
    businessClose.includes('work.mjs close --id BIZ-####') && businessClose.includes('--actor human')
      ? ok('work next derives Business close after every owned workflow is done')
      : bad(`Business close is unreachable: ${JSON.stringify(businessClose)}`);

    const secondWorkflowDir = join(businessDir, 'workflows', 'WF-0002-demo');
    mkdirSync(secondWorkflowDir, { recursive: true });
    writeFileSync(join(secondWorkflowDir, 'workflow-plan.json'), JSON.stringify({
      workflowId: 'WF-0002',
      slug: 'demo-two',
      profile: 'program',
      journey: { shape: 'multi-workflow-program', journeyBranch: 'business-workflow' },
    }));
    writeFileSync(join(secondWorkflowDir, 'workflow-state.json'), JSON.stringify({
      workflowId: 'WF-0002',
      overallStatus: 'in-progress',
      journeyPhase: 'testing',
      taskStates: { 'DJ0-T1': { status: 'done' } },
    }));
    writeFileSync(join(secondWorkflowDir, 'index.md'), '---\nslug: demo-two\nnumber: 0002\ncurrentPhase: testing\n---\n');
    writeFileSync(join(workflowDir, 'workflow-state.json'), JSON.stringify({
      workflowId: 'WF-0001',
      overallStatus: 'in-progress',
      journeyPhase: 'testing',
      taskStates: { 'DJ0-T1': { status: 'done' } },
    }));
    const ambiguousOutput = execFileSync(process.execPath, [workCli, 'next'], {
      cwd: activeRoot,
      encoding: 'utf8',
    });
    ambiguousOutput === ''
      ? ok('work next refuses ambiguous multiple active workflows')
      : bad(`work next guessed under ambiguity: ${JSON.stringify(ambiguousOutput)}`);
  } finally {
    rmSync(activeRoot, { recursive: true, force: true });
  }

  rep.finish('methodology journey map + verifier + surfacing (ADR-0127)');
}

main();
