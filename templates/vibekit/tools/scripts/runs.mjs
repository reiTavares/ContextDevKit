#!/usr/bin/env node
/**
 * `/runs` — lists the last N in-flight items (tasks + pipeline runs) across the
 * project, reading the canonical state.json substrate ([ADR-0015](../../memory/decisions/0015-pipeline-dsl-working-stage-and-multi-session-work-claims.md) Part C).
 *
 * Read-only — never mutates state. Refuses cleanly when no state files exist
 * ("no runs yet"). Token-light by default — prints the 20 most recent; `--all`
 * shows everything, `--json` for machine-readable output.
 *
 * Usage:
 *   node vibekit/tools/scripts/runs.mjs                # last 20, all kinds
 *   node vibekit/tools/scripts/runs.mjs --kind task    # tasks only
 *   node vibekit/tools/scripts/runs.mjs --kind pipeline-run
 *   node vibekit/tools/scripts/runs.mjs --all          # no limit
 *   node vibekit/tools/scripts/runs.mjs --json         # JSON for tooling
 */
import { listStates } from '../../runtime/state/state-io.mjs';
import { pathsFor } from '../../runtime/config/paths.mjs';

const ROOT = process.cwd();
const PIPE = pathsFor(ROOT).pipeline;
const DEFAULT_LIMIT = 20;
const STATUS_BADGE = { backlog: '📋', working: '🔵', testing: '🟡', done: '✅', running: '🔄', 'blocked-on-checkpoint': '⏸', failed: '❌' };

/** Returns the value after `--name`, or undefined when absent. */
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

/** Best-effort age formatter mirroring workspace-sync's `relativeTime`. */
function ago(ms) {
  if (typeof ms !== 'number' || ms <= 0) return '—';
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Duration when both startedAt + endedAt are present, else "—". */
function duration(state) {
  if (typeof state.startedAt !== 'number' || typeof state.endedAt !== 'number') return '—';
  const s = Math.max(0, Math.floor((state.endedAt - state.startedAt) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function renderTasks(tasks) {
  if (tasks.length === 0) return null;
  const out = ['📋 tasks', '─'.repeat(60)];
  for (const t of tasks) {
    const badge = STATUS_BADGE[t.status] || '·';
    const owner = t.ownerUser ? ` · ${t.ownerUser}` : '';
    const branch = t.branch ? ` · ${t.branch}` : '';
    const when = t.endedAt ? `ended ${ago(t.endedAt)} (${duration(t)})` : `started ${ago(t.startedAt)}`;
    out.push(`  ${badge} ${t.id.padEnd(5)} [${t.status.padEnd(8)}]${owner}${branch} · ${when}`);
  }
  return out.join('\n');
}

function renderPipelineRuns(runs) {
  if (runs.length === 0) return null;
  const out = ['🤖 pipeline runs', '─'.repeat(60)];
  for (const r of runs) {
    const badge = STATUS_BADGE[r.status] || '·';
    const step = r.step ? `${r.step.current ?? '?'}/${r.step.total ?? '?'} steps` : '';
    const cycles = r.cycles && Object.keys(r.cycles).length > 0 ? `(${Object.entries(r.cycles).map(([k, v]) => `${k}×${v}`).join(', ')})` : '';
    const when = r.endedAt ? `ended ${ago(r.endedAt)} (${duration(r)})` : `started ${ago(r.startedAt)}`;
    out.push(`  ${badge} ${r.id.padEnd(20)} [${r.status.padEnd(10)}] ${step} ${cycles} · ${when}`);
  }
  return out.join('\n');
}

function main() {
  const kindFilter = arg('kind');
  if (kindFilter && !['task', 'pipeline-run'].includes(kindFilter)) {
    console.error(`Invalid --kind "${kindFilter}". Use "task" or "pipeline-run".`);
    process.exit(1);
  }
  const limit = flag('all') ? Infinity : Number(arg('limit')) || DEFAULT_LIMIT;
  const all = listStates(PIPE, kindFilter ? { kind: kindFilter } : {});
  const truncated = Number.isFinite(limit) ? all.slice(0, limit) : all;

  if (flag('json')) {
    console.log(JSON.stringify({ total: all.length, shown: truncated.length, states: truncated }, null, 2));
    return;
  }

  if (all.length === 0) {
    console.log('  No runs yet. Start a task with `/pipeline start <id>` or run a squad pipeline.');
    return;
  }

  const tasks = truncated.filter((s) => s.kind === 'task');
  const runs = truncated.filter((s) => s.kind === 'pipeline-run');
  const sections = [renderTasks(tasks), renderPipelineRuns(runs)].filter(Boolean);
  if (sections.length === 0) {
    console.log(`  No ${kindFilter ?? 'state'} entries match. Total in store: ${all.length}.`);
    return;
  }
  console.log('\n' + sections.join('\n\n') + '\n');
  if (all.length > truncated.length) {
    console.log(`  (showing ${truncated.length} of ${all.length} — pass --all for the full list)`);
  }
}

main();
