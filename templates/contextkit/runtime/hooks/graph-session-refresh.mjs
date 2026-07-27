#!/usr/bin/env node
/**
 * SessionStart hook (Level >= 4) — per-session structural-graph refresh
 * (WF-0108 / ADR-0155, amending ADR-0134's rollout).
 *
 * Before this hook the committed projection was rebuilt ONLY during
 * `npx contextdevkit --update` (`tools/install/graph-index.mjs`), so a session
 * opened days later explored against a stale graph — and
 * `projectMap.graph.autoIndex` was a flag with no consumer anywhere in the kit.
 * This hook is that consumer: every new session re-indexes the graph, so
 * graph-first exploration answers against the CURRENT tree.
 *
 * A full rebuild costs seconds (~5.6s on the kit's own repo), which a boot hook
 * may never pay: the builder is therefore spawned DETACHED and unref'd and this
 * hook returns immediately (immutable rule 2 — hooks never delay real work). The
 * session's first queries may briefly read the previous projection; staleness is
 * the graph-first gate's problem, and it handles it independently.
 *
 * Hot-path purity (ADR-0134, proven by `tools/selfcheck-hotpath-purity.mjs`):
 * this hook NEVER imports a graph builder/query module. It reaches the builder
 * only by process spawn, and `graph-config.mjs` (pure, zero-dep) is the one graph
 * module that proof deliberately exempts.
 *
 * Every path exits 0. A refusal is silent; the receipt is the only artifact.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { getLevel, loadConfigSync } from '../config/load.mjs';
import { pathsFor, PLATFORM_DIR } from '../config/paths.mjs';
import { isGraphEnabled } from '../../tools/scripts/graph-config.mjs';
import { hookHost, resolveHookSessionId } from './host-adapter.mjs';

const ROOT = process.cwd();
const HOST = hookHost();

/** Minimum capability level for the graph (mirrors `graph-activation.mjs`). */
const MIN_LEVEL = 4;

/**
 * Top-level directories that indicate a project has source worth graphing.
 * Mirrors `boot-signals-projmap.mjs#SOURCE_SENTINEL_DIRS` (plus the kit's own
 * `templates`/`tools`) — duplicated on purpose so this hook stays self-contained,
 * with no cross-hook import that could introduce a cycle.
 */
const SOURCE_SENTINEL_DIRS = ['src', 'app', 'apps', 'packages', 'lib', 'components', 'pages', 'server', 'cmd', 'internal', 'templates', 'tools'];

/**
 * Absolute path of the per-session refresh receipt.
 * @param {string} root project root
 * @returns {string}
 */
export function receiptPath(root) {
  return resolve(pathsFor(root).projectMap, 'graph', '.session-refresh.json');
}

/**
 * Reads the refresh receipt defensively. Absent, unreadable and malformed all
 * resolve to null — an unreadable receipt must never be mistaken for "already
 * refreshed" (refuse-to-false-negative, constitution section 8).
 *
 * @param {string} root project root
 * @returns {{sessionId?:string, at?:number, status?:string}|null}
 */
export function readReceipt(root) {
  try {
    const path = receiptPath(root);
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf-8');
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * PURE decision core: should this session spawn a graph rebuild, and if not, why?
 * Exported apart from the I/O so the guard ladder is unit-testable without a real
 * spawn or a real project tree.
 *
 * @param {object} input
 * @param {number} input.level resolved capability level
 * @param {object|null} input.config resolved project config
 * @param {string} input.sessionId current session id
 * @param {{sessionId?:string}|null} input.receipt prior receipt, if any
 * @param {boolean} input.hasSource whether the tree holds graphable source
 * @param {boolean} input.builderExists whether the builder script is installed
 * @returns {{refresh:boolean, reason:string}}
 */
export function shouldRefresh({ level, config, sessionId, receipt, hasSource, builderExists }) {
  if (typeof level !== 'number' || level < MIN_LEVEL) return { refresh: false, reason: `level < ${MIN_LEVEL}` };
  if (!isGraphEnabled(config)) return { refresh: false, reason: 'projectMap.graph.enabled is not true' };
  if (config.projectMap.graph.autoIndex === false) return { refresh: false, reason: 'projectMap.graph.autoIndex is false (explicit opt-out)' };
  if (!builderExists) return { refresh: false, reason: 'graph builder not installed' };
  if (!hasSource) return { refresh: false, reason: 'no source directories (greenfield)' };
  // A receipt from THIS session means SessionStart already fired (compaction and
  // resume both replay it) — one rebuild per session, never a double spawn.
  if (receipt && receipt.sessionId === sessionId) return { refresh: false, reason: 'already refreshed this session' };
  return { refresh: true, reason: 'new session — re-index the graph against the current tree' };
}

/** True when the tree contains at least one recognised source directory. */
function hasSourceDirs(root) {
  return SOURCE_SENTINEL_DIRS.some((dir) => existsSync(resolve(root, dir)));
}

/** Atomically writes the receipt (tmp + rename); best-effort, never throws. */
function writeReceipt(root, receipt) {
  try {
    const path = receiptPath(root);
    mkdirSync(resolve(path, '..'), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify(receipt, null, 2)}\n`, 'utf-8');
    renameSync(tmp, path);
  } catch {
    /* the receipt is telemetry; a write failure must never break a session */
  }
}

/** Reads stdin (host payload) with a short deadline so boot is never held up. */
async function readStdin() {
  return new Promise((res) => {
    let buf = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => (buf += chunk));
    process.stdin.on('end', () => res(buf));
    setTimeout(() => res(buf), 500).unref?.();
  });
}

/**
 * Spawns the builder detached so the rebuild outlives this hook process and
 * blocks nothing. Returns the child pid, or null when the spawn itself failed.
 *
 * @param {string} root project root
 * @param {string} builder absolute builder path
 * @returns {number|null}
 */
function spawnDetachedRebuild(root, builder) {
  try {
    const child = spawn(process.execPath, [builder, '--apply'], {
      cwd: root,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return child.pid ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const raw = await readStdin();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    /* keep empty */
  }

  const sessionId = resolveHookSessionId(payload, HOST, ROOT);
  const builder = resolve(ROOT, PLATFORM_DIR, 'tools/scripts/project-map-graph.mjs');
  const decision = shouldRefresh({
    level: getLevel(ROOT),
    config: loadConfigSync(ROOT),
    sessionId,
    receipt: readReceipt(ROOT),
    hasSource: hasSourceDirs(ROOT),
    builderExists: existsSync(builder),
  });

  if (!decision.refresh) return; // a refusal is silent — never boot noise

  const pid = spawnDetachedRebuild(ROOT, builder);
  writeReceipt(ROOT, {
    sessionId,
    at: Date.now(),
    status: pid === null ? 'spawn-failed' : 'spawned',
    reason: decision.reason,
    pid,
  });
}

// Run ONLY when invoked as a hook process, never on import: the decision core is
// imported by the selftest, and an unguarded `main()` would read stdin and spawn a
// real rebuild from a test (precedent: `graph-activation.mjs`).
if (process.argv[1] && process.argv[1].split(/[\\/]/).pop() === 'graph-session-refresh.mjs') {
  main().catch((err) => {
    process.stderr.write(`[graph-session-refresh] ${err?.message ?? err}\n`);
    process.exit(0);
  });
}
