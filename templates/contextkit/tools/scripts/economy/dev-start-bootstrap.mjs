#!/usr/bin/env node
/**
 * Read-only `/dev-start` economy bootstrap.
 *
 * Usage:
 *   node contextkit/tools/scripts/economy/dev-start-bootstrap.mjs "<objective>"
 *   node contextkit/tools/scripts/economy/dev-start-bootstrap.mjs --json "<objective>"
 *
 * The objective is data only. This CLI never evaluates it, spawns a command,
 * regenerates Project Map, changes git state or moves pipeline cards.
 */
import { buildDevStartBootstrap, renderDevStartBootstrap } from './dev-start-economy-core.mjs';
import {
  appendEconomyEventSync,
  economyEventsFile,
  recordEconomyEvent,
} from './economy-events.mjs';
import { emitEconomy } from './telemetry-emit.mjs';
export { buildDevStartBootstrap } from './dev-start-economy-core.mjs';

export function parseDevStartArgs(argv = []) {
  const options = { json: false, host: 'unknown', sessionId: null, taskId: null, objective: '' };
  const objectiveParts = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      objectiveParts.push(...argv.slice(i + 1));
      break;
    }
    if (arg === '--json') options.json = true;
    else if (arg === '--host') options.host = argv[++i] ?? 'unknown';
    else if (arg === '--session-id') options.sessionId = argv[++i] ?? null;
    else if (arg === '--task-id') options.taskId = argv[++i] ?? null;
    else if (arg === '--objective') {
      const start = argv[i + 1] === '--' ? i + 2 : i + 1;
      options.objective = argv.slice(start).join(' ').trim();
      break;
    }
    else if (arg === '--help' || arg === '-h') options.help = true;
    else {
      objectiveParts.push(...argv.slice(i));
      break;
    }
  }
  if (!options.objective) options.objective = objectiveParts.join(' ').trim();
  return options;
}

function usage() {
  return [
    'Usage: dev-start-bootstrap.mjs [options] --objective -- "<objective>"',
    'Read-only and fail-open: emits a degraded plan instead of blocking on unavailable state.',
  ].join('\n');
}

function lifecycleFor(stage) {
  if (stage.status === 'error') return 'failed';
  if (['skipped', 'missing', 'unavailable', 'disabled'].includes(stage.status)) return 'skipped';
  return 'evaluated';
}

function leverFor(stage) {
  if (stage.stage === 'project-map') return 'project-map';
  if (stage.stage === 'request-orchestration') return 'routing';
  return 'dev-start';
}

export function lifecycleEventsForBootstrap(plan, opts = {}) {
  const requestId = plan?.correlation?.requestId ?? `dev-start-${plan?.objective?.fingerprint?.slice(-12) ?? 'unknown'}`;
  const stages = Array.isArray(plan?.stages) ? plan.stages.slice(0, 5) : [];
  return stages.map((stage) => {
    const lifecycle = lifecycleFor(stage);
    return recordEconomyEvent({
      eventId: `${requestId}:${stage.order}:${stage.stage}`,
      lever: leverFor(stage),
      lifecycle,
      evaluated: stage.status !== 'missing',
      skipped: lifecycle === 'skipped',
      failed: lifecycle === 'failed',
      reasonCodes: [`stage=${stage.stage}`, `status=${stage.status}`],
      requestId,
      sessionId: plan?.correlation?.sessionId ?? null,
      sourceLedger: 'dev-start-bootstrap',
      sourceId: plan?.objective?.fingerprint ?? null,
      capturedAt: opts.now ?? null,
    }, { now: opts.now });
  });
}

export function persistBootstrapLifecycle(plan, options = {}) {
  const file = options.eventFile ?? options.eventsFile ?? options.logFile
    ?? economyEventsFile(options.root ?? process.cwd());
  const events = lifecycleEventsForBootstrap(plan, options);
  let recorded = 0;
  let duplicates = 0;
  for (const event of events) {
    const result = appendEconomyEventSync(event, file);
    if (result.appended) recorded += 1;
    else if (result.reason === 'duplicate-event-id') duplicates += 1;
  }
  return {
    events,
    persistence: {
      status: recorded > 0 || duplicates === events.length ? 'recorded' : 'degraded',
      recorded,
      duplicates,
    },
  };
}

export function runDevStartBootstrap(argv = process.argv.slice(2), root = process.cwd()) {
  const options = parseDevStartArgs(argv);
  if (options.help) return { output: usage(), plan: null };
  const plan = devStartBootstrap({ ...options, root });
  return {
    plan,
    output: options.json ? JSON.stringify(plan, null, 2) : renderDevStartBootstrap(plan),
  };
}

/** Programmatic W1 entrypoint used by integration fixtures and host adapters. */
export function devStartBootstrap(options = {}) {
  const plan = buildDevStartBootstrap(options);
  const persisted = persistBootstrapLifecycle(plan, options);
  // Honest emit: dev-start consulted the context-profiles budget (profileFor) to
  // recommend the dev-start profile. Fired (consulted/surfaced), not applied —
  // same root convention as the lifecycle events persisted just above.
  emitEconomy(options.root ?? process.cwd(), 'context-profiles',
    { category: 'advisory', action: 'fired', measurement: 'none', sessionId: plan?.correlation?.sessionId ?? null },
    { now: options.now });
  return { ...plan, lifecycle: persisted.events, persistence: persisted.persistence };
}

function main() {
  try {
    const { output } = runDevStartBootstrap();
    process.stdout.write(`${output}\n`);
  } catch (error) {
    const degraded = {
      schema: 'cdk-dev-start-bootstrap/1',
      ok: false,
      error: { code: 'cli-degraded', message: String(error?.message ?? error).slice(0, 160) },
    };
    process.stdout.write(`${JSON.stringify(degraded)}\n`);
  }
}

if (process.argv[1]?.endsWith('dev-start-bootstrap.mjs')) main();
