/** Pure/read-only core for the `/dev-start` economy bootstrap. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { getLevel, loadConfigSync } from '../../../runtime/config/load.mjs';
import { pathsFor } from '../../../runtime/config/paths.mjs';
import { intake } from '../../../runtime/execution/task-intake.mjs';
import { orchestrate } from '../../../runtime/execution/request-orchestrator.mjs';
import { listStates, readState } from '../../../runtime/state/state-io.mjs';
import { scanProject } from '../project-map-core.mjs';
import { buildDenseIndex, findSymbol } from '../project-map-dense.mjs';
import { subgraphFor } from '../project-map-insights.mjs';
import { profileFor } from './context-profiles.mjs';
import { resolveEconomyFlags, rolloutGate } from './economy-governance-core.mjs';
export const DEV_START_BOOTSTRAP_SCHEMA = 'cdk-dev-start-bootstrap/1';
const MAX_MATCHES = 8;
const hash = (value) => `sha256:${createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex')}`;
const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } };
const normalizeObjective = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');
const reason = (prefix, value) => `${prefix}=${value}`;
function safeRelative(root, value) {
  const raw = String(value ?? '').trim().replace(/^['"`]|['"`,.;:)]+$/g, '');
  if (!raw) return null;
  const candidate = raw.replaceAll('\\', '/');
  if (!isAbsolute(raw)) return candidate.replace(/^\.\//, '');
  const rel = relative(root, resolve(raw)).replaceAll('\\', '/');
  return rel && !rel.startsWith('../') && rel !== '..' ? rel : null;
}
export function extractObjectiveHints(objective, root = process.cwd()) {
  const text = normalizeObjective(objective);
  const task = /(?:#|\b(?:card|task|ticket|fix)\s*#?\s*)(\d{1,6})\b/i.exec(text)?.[1] ?? null;
  const workflow = /\bworkflow(?:\s*[:=]|\s+)([a-z0-9][a-z0-9-]{2,80})\b/i.exec(text)?.[1] ?? null;
  const pathMatches = text.match(/[A-Za-z]:\\[^\s"'`]+|(?:\.{0,2}[\\/])?(?:[\w@.-]+[\\/])+[\w@.()/-]+/g) ?? [];
  const path = pathMatches.map((entry) => safeRelative(root, entry)).find(Boolean) ?? null;
  const explicitSymbol = /`([A-Za-z_$][\w$]{2,80})`/.exec(text)?.[1]
    ?? /\b(?:symbol|function|method|class|função|método|classe|símbolo)\s+([A-Za-z_$][\w$]{2,80})\b/i.exec(text)?.[1]
    ?? text.match(/\b(?:[A-Z][A-Za-z0-9_$]{3,}|[a-z][A-Za-z0-9_$]*[A-Z][A-Za-z0-9_$]*)\b/)?.[0]
    ?? null;
  return Object.freeze({
    taskId: task,
    workflowId: workflow,
    path,
    symbol: path ? null : explicitSymbol,
  });
}
export function probeProjectMap(root, config, hints, enabled = true) {
  if (!enabled) {
    return { status: 'skipped', manifest: 'unavailable', lookup: null, reasonCodes: ['map=disabled'] };
  }
  const dir = pathsFor(root).projectMap;
  const saved = readJson(resolve(dir, 'manifest.json'));
  let manifest = 'missing';
  let currentSignature = null;
  const reasonCodes = [];
  if (saved?.signature) {
    try {
      currentSignature = scanProject(root, 0, config).signature;
      manifest = currentSignature === saved.signature ? 'fresh' : 'stale';
    } catch {
      manifest = 'unknown';
    }
  }
  reasonCodes.push(reason('map.manifest', manifest));

  let lookup = null;
  try {
    if (hints.path && Array.isArray(saved?.modules)) {
      const hit = subgraphFor(saved.modules, hints.path);
      lookup = hit
        ? { kind: 'path', query: hints.path, status: 'hit', module: hit.module, deps: hit.deps, importers: hit.importers }
        : { kind: 'path', query: hints.path, status: 'miss' };
    } else if (hints.symbol) {
      const matches = findSymbol(buildDenseIndex(root), hints.symbol).slice(0, MAX_MATCHES)
        .map((entry) => ({ symbol: entry.symbol, files: entry.files.slice(0, 5) }));
      lookup = { kind: 'symbol', query: hints.symbol, status: matches.length ? 'hit' : 'miss', matches };
    } else {
      lookup = { kind: 'none', query: null, status: 'not-applicable', reason: 'unavailable-no-extractable-query' };
    }
  } catch {
    lookup = { kind: hints.path ? 'path' : hints.symbol ? 'symbol' : 'none', query: hints.path ?? hints.symbol, status: 'error' };
  }
  reasonCodes.push(reason('map.lookup', lookup.status));
  return {
    status: manifest === 'missing' && lookup.status !== 'hit' ? 'unavailable' : 'evaluated',
    manifest,
    savedSignature: saved?.signature ?? null,
    currentSignature,
    lookup,
    reasonCodes,
  };
}
function checkpointSummary(root, state) {
  const resume = state?.resume;
  if (!resume || typeof resume !== 'object') return null;
  const pointers = {};
  for (const [key, value] of Object.entries(resume.pointers ?? {})) {
    const rel = safeRelative(root, value);
    if (rel) pointers[key] = rel;
  }
  return {
    id: state.id,
    kind: state.kind,
    status: state.status,
    currentStep: state.step?.current ?? resume.currentStep ?? null,
    stampedAt: Number.isFinite(resume.stampedAt) ? resume.stampedAt : null,
    pointers,
    decisionCount: Array.isArray(resume.decisions) ? resume.decisions.length : 0,
    touchCount: Array.isArray(resume.touchSet) ? resume.touchSet.length : 0,
    openThreadCount: Array.isArray(resume.openThreads) ? resume.openThreads.length : 0,
  };
}
export function probeResume(root, objective, taskId, enabled = true) {
  if (!enabled) return { status: 'skipped', checkpoint: null, reasonCodes: ['resume=disabled'] };
  const pipe = pathsFor(root).pipeline;
  if (taskId) {
    const state = readState(pipe, taskId);
    const checkpoint = checkpointSummary(root, state);
    return checkpoint
      ? { status: 'hit', checkpoint, reasonCodes: ['resume=task-checkpoint-hit'] }
      : { status: 'miss', checkpoint: null, reasonCodes: [state ? 'resume=task-state-without-checkpoint' : 'resume=task-state-missing'] };
  }
  const objectiveHash = hash(normalizeObjective(objective).toLowerCase());
  const state = listStates(pipe).find((candidate) => {
    const checkpointObjective = normalizeObjective(candidate.resume?.objective).toLowerCase();
    return checkpointObjective && hash(checkpointObjective) === objectiveHash;
  });
  const checkpoint = checkpointSummary(root, state);
  return checkpoint
    ? { status: 'hit', checkpoint, reasonCodes: ['resume=objective-checkpoint-hit'] }
    : { status: 'miss', checkpoint: null, reasonCodes: ['resume=no-correlated-checkpoint'] };
}
function lever(name, { available = true, enabled = true, evaluated = false, eligible = false,
  recommended = false, attempted = false, applied = false, observed = false, status, reasonCodes = [] } = {}) {
  return { name, available, enabled, evaluated, eligible, recommended, attempted, applied, observed,
    status: status ?? (enabled ? 'available' : 'disabled'), reasonCodes };
}
function orchestrationSummary(envelope) {
  if (!envelope) return null;
  return {
    requestId: envelope.requestId,
    context: envelope.context,
    classification: envelope.classification,
    autonomy: envelope.autonomy,
    routing: envelope.routing,
    agents: envelope.agents,
    playbooks: envelope.playbooks,
    deliberation: envelope.deliberation ?? { required: false, reasons: [] },
  };
}
function intakeSummary(result) {
  const signals = result?.signals ?? {};
  const work = signals.work ?? {};
  const decision = signals.decisionNeed ?? {};
  return {
    signals: {
      taskId: signals.taskId ?? null,
      sessionId: signals.sessionId ?? null,
      host: signals.host ?? null,
      tier: signals.tier,
      domain: signals.domain,
      needsAdr: Boolean(signals.needsAdr),
      paths: Array.isArray(signals.paths) ? signals.paths : [],
      phase: signals.phase,
      level: signals.level,
      work: {
        nature: work.nature ?? null,
        kind: work.kind ?? null,
        valueIntents: work.valueIntents ?? null,
        growthLever: work.growthLever ?? null,
        executionMode: work.executionMode ?? null,
        confidence: work.confidence ?? null,
      },
      decisionNeed: {
        needVerdict: decision.needVerdict ?? null,
        materialityScore: Number.isFinite(decision.materialityScore) ? decision.materialityScore : null,
        triple: decision.triple ?? null,
        routineCovered: decision.routineCovered ?? null,
        coverageMode: decision.coverageMode ?? null,
      },
    },
    reasonCodes: [reason('tier', signals.tier ?? 'unknown'), reason('domain', signals.domain ?? 'unknown'),
      reason('work.nature', work.nature ?? 'unknown'), reason('work.kind', work.kind ?? 'unknown')],
  };
}

export function buildDevStartBootstrap({ objective, root = process.cwd(), host = 'unknown',
  sessionId = null, taskId = null, requestId = null } = {}) {
  const normalized = normalizeObjective(objective);
  const fingerprint = hash(normalized);
  try {
    const config = loadConfigSync(root);
    const level = getLevel(root);
    const extracted = extractObjectiveHints(normalized, root);
    const hints = { ...extracted, taskId: taskId ?? extracted.taskId };
    const economy = resolveEconomyFlags(config);
    const mapEnabled = economy.enabled !== false && config?.economy?.tools?.find !== false
      && config?.routing?.useProjectMapFirst !== false && level >= 3;
    const resumeEnabled = rolloutGate(economy, 'resumePack');
    const profileEnabled = rolloutGate(economy, 'contextProfiles');
    const resume = probeResume(root, normalized, hints.taskId, resumeEnabled);
    const projectMap = probeProjectMap(root, config, hints, mapEnabled);
    const intakeResult = intake({
      objective: normalized, taskId: hints.taskId, sessionId, host, paths: hints.path ? [hints.path] : [],
      phase: 'dev-start', level,
    }, { root, level });
    const orchMin = Number(config?.orchestration?.minLevel ?? 7);
    const orchEnabled = config?.orchestration?.enabled !== false && level >= orchMin;
    const correlationRequestId = requestId
      ?? (hints.taskId ? `task-${hints.taskId}` : `dev-start-${fingerprint.slice(-12)}`);
    const envelope = orchEnabled ? orchestrate({
      requestId: correlationRequestId,
      requestText: normalized, sessionId, signals: intakeResult.signals,
      context: { taskId: hints.taskId, workflowId: hints.workflowId, phase: 'dev-start' },
    }, { root, level, config }) : null;
    const orch = orchestrationSummary(envelope);
    const mapHit = projectMap.lookup?.status === 'hit';
    const resumeHit = resume.status === 'hit';
    const runCompactEnabled = economy.enabled !== false && config?.economy?.tools?.runCompact !== false;
    const levers = {
      projectMap: lever('project-map', { available: projectMap.manifest !== 'missing', enabled: mapEnabled,
        evaluated: projectMap.status === 'evaluated', eligible: Boolean(hints.path || hints.symbol), recommended: mapHit,
        observed: mapHit, status: projectMap.lookup?.status ?? projectMap.status, reasonCodes: projectMap.reasonCodes }),
      resumePack: lever('resume-pack', { available: resume.status !== 'skipped', enabled: resumeEnabled,
        evaluated: resume.status !== 'skipped', eligible: resumeHit, recommended: resumeHit, observed: resumeHit,
        status: resume.status, reasonCodes: resume.reasonCodes }),
      requestOrchestration: lever('request-orchestration', { available: config?.orchestration?.enabled !== false,
        enabled: orchEnabled, evaluated: Boolean(orch), eligible: orchEnabled, recommended: Boolean(orch),
        status: orch ? (orch.routing?.mode === 'shadow' ? 'shadow-only' : 'evaluated') : 'skipped',
        reasonCodes: orch
          ? [...(orch.routing?.reasonCodes ?? []), ...(orch.routing?.mode === 'shadow' ? ['shadow_mode'] : [])]
          : [`orchestration=min-level-${orchMin}`, `level=${level}`] }),
      contextProfile: lever('context-profile', { available: profileFor('dev-start') !== null, enabled: profileEnabled,
        eligible: profileEnabled, recommended: profileEnabled, status: 'next',
        reasonCodes: [`profile=dev-start`, `budget=${profileFor('dev-start') ?? 'unknown'}`] }),
      runCompact: lever('run-compact', { available: true, enabled: runCompactEnabled, eligible: runCompactEnabled,
        recommended: runCompactEnabled, status: runCompactEnabled ? 'recommended-for-test-build' : 'disabled',
        reasonCodes: [runCompactEnabled ? 'run-compact=test-build-wrapper' : 'run-compact=config-disabled'] }),
    };
    return {
      schema: DEV_START_BOOTSTRAP_SCHEMA,
      ok: Boolean(normalized),
      objective: { fingerprint },
      correlation: { requestId: correlationRequestId, sessionId, taskId: hints.taskId },
      environment: { level, host, economy: { enabled: economy.enabled, mode: economy.mode } },
      hints,
      stageOrder: [
        { order: 1, stage: 'sync-preflight', status: 'required-before-bootstrap' },
        { order: 2, stage: 'dev-start-bootstrap', status: 'evaluated' },
        { order: 3, stage: 'context-pack', status: 'next', profile: 'dev-start' },
        { order: 4, stage: 'complexity-rubric', status: 'after-context-pack' },
      ],
      bootstrapStages: [
        { order: 1, stage: 'objective', status: normalized ? 'resolved' : 'missing' },
        { order: 2, stage: 'resume', status: resume.status },
        { order: 3, stage: 'project-map', status: projectMap.lookup?.status ?? projectMap.status },
        { order: 4, stage: 'task-intake', status: 'evaluated' },
        { order: 5, stage: 'request-orchestrator', status: orch ? 'evaluated' : 'skipped' },
      ],
      stages: [
        { order: 1, stage: 'objective-resolved', status: normalized ? 'evaluated' : 'skipped' },
        { order: 2, stage: 'resume-checkpoint', status: resume.status },
        { order: 3, stage: 'project-map', status: projectMap.lookup?.status ?? projectMap.status },
        { order: 4, stage: 'task-intake-classification', status: 'evaluated' },
        { order: 5, stage: 'request-orchestration', status: orch ? 'evaluated' : 'skipped' },
        { order: 6, stage: 'lifecycle-plan', status: 'structured' },
        { order: 7, stage: 'context-profile-ready', status: profileEnabled ? 'ready' : 'disabled' },
      ],
      projectMap, resume,
      intake: intakeSummary(intakeResult),
      orchestration: orch,
      levers,
      next: {
        contextPackArgv: ['node', 'contextkit/tools/scripts/context-pack.mjs', '--profile', 'dev-start'],
        complexityArgv: ['node', 'contextkit/tools/scripts/complexity-rubric.mjs', 'classify', '<objective>'],
      },
    };
  } catch (error) {
    return {
      schema: DEV_START_BOOTSTRAP_SCHEMA, ok: false, objective: { fingerprint },
      stageOrder: [], bootstrapStages: [], levers: {},
      error: { code: 'bootstrap-degraded', message: String(error?.message ?? error).slice(0, 160) },
    };
  }
}

export function renderDevStartBootstrap(plan) {
  const stages = (plan.stageOrder ?? []).map((s) => `${s.order}:${s.stage}[${s.status}]`).join(' -> ');
  const internal = (plan.bootstrapStages ?? []).map((s) => `${s.stage}=${s.status}`).join(' | ');
  const map = plan.projectMap ?? {};
  const intakeSignals = plan.intake?.signals ?? {};
  const orch = plan.orchestration;
  const lines = [
    `Dev-start economy bootstrap ${plan.ok ? 'ready' : 'degraded'} (${plan.schema})`,
    `objective: ${plan.objective?.fingerprint ?? 'unavailable'}`,
    `order: ${stages || 'unavailable'}`,
    `bootstrap: ${internal || 'unavailable'}`,
    `map: manifest=${map.manifest ?? 'unknown'} lookup=${map.lookup?.status ?? 'unknown'}${map.lookup?.query ? ` query=${map.lookup.query}` : ''}`,
    `resume: ${plan.resume?.status ?? 'unknown'}${plan.resume?.checkpoint?.currentStep ? ` step=${plan.resume.checkpoint.currentStep}` : ''}`,
    `request: tier=${intakeSignals.tier ?? 'unknown'} domain=${intakeSignals.domain ?? 'unknown'}`
      + (orch ? ` context=${orch.context?.primaryType} risk=${orch.classification?.risk} routing=${orch.routing?.mode}` : ''),
  ];
  for (const state of Object.values(plan.levers ?? {})) {
    lines.push(`lever ${state.name}: status=${state.status} evaluated=${state.evaluated} recommended=${state.recommended} applied=${state.applied}`);
  }
  if (plan.error) lines.push(`warning: ${plan.error.code} (${plan.error.message})`);
  return lines.join('\n');
}
