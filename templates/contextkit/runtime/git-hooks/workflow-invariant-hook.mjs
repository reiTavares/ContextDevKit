#!/usr/bin/env node
/**
 * Pre-commit adapter for the WF-0084 invariant guard.
 *
 * The adapter discovers only workflow packs touched by staged files. Shadow is
 * the default; advisory warns; guarded blocks only positively-false hot-path
 * invariants. An explicit `enabled: false` is the kill path.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfigSync } from '../config/load.mjs';
import { readPlan } from '../../tools/scripts/workflow/plan.mjs';
import { guardPack } from '../../tools/scripts/workflow/invariant-guard.mjs';
import { readState } from '../../tools/scripts/workflow/state.mjs';

const VALID_MODES = new Set(['shadow', 'advisory', 'guarded']);

/**
 * Read staged paths without shell parsing.
 * @param {string} root project root
 * @returns {string[]} staged repository-relative paths
 */
export function stagedPaths(root) {
  try {
    return execFileSync('git', ['diff', '--cached', '--name-only'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 5000,
    }).split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Resolve workflow pack directories from changed files by walking only their
 * ancestor chain. This keeps the pre-commit path O(number of changed files).
 * @param {string} root project root
 * @param {string[]} files staged repository-relative paths
 * @returns {string[]} unique workflow pack directories
 */
export function touchedWorkflowDirs(root, files) {
  const rootPath = resolve(root);
  const found = new Set();
  for (const file of Array.isArray(files) ? files : []) {
    const normalized = String(file).replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized || normalized.startsWith('../') || normalized.includes('/../')) continue;
    const segments = normalized.split('/');
    for (let length = segments.length; length > 0; length -= 1) {
      const candidate = resolve(rootPath, ...segments.slice(0, length));
      const candidateRelative = relative(rootPath, candidate);
      if (candidateRelative.startsWith('..') || resolve(rootPath, candidateRelative) !== candidate) continue;
      if (existsSync(join(candidate, 'workflow-plan.json'))) {
        found.add(candidate);
        break;
      }
    }
  }
  return [...found].sort();
}

/**
 * Resolve explicit rollout configuration, defaulting safely to shadow.
 * @param {object|null} config installed project configuration
 * @returns {{enabled:boolean,mode:'shadow'|'advisory'|'guarded',phase:string}}
 */
export function invariantGuardConfig(config) {
  const configured = config?.workflowIntegrity?.invariantGuard;
  if (configured?.enabled === false) return { enabled: false, mode: 'shadow', phase: 'in-flight' };
  const mode = VALID_MODES.has(configured?.mode) ? configured.mode : 'shadow';
  const phase = typeof configured?.phase === 'string' && configured.phase.length > 0
    ? configured.phase
    : 'in-flight';
  return { enabled: true, mode, phase };
}

/**
 * Evaluate touched workflow packs through the staged-file hook adapter.
 * @param {string} root project root
 * @param {{stagedFiles?:string[],config?:object|null,now?:string}} [options]
 * @returns {{status:string,mode:string,exitCode:number,packs:object[],reason?:string}}
 */
export function runWorkflowInvariantHook(root = process.cwd(), options = {}) {
  const config = invariantGuardConfig(options.config ?? loadConfigSync(root));
  if (!config.enabled) return { status: 'disabled', mode: config.mode, exitCode: 0, packs: [] };
  const files = options.stagedFiles ?? stagedPaths(root);
  const directories = touchedWorkflowDirs(root, files);
  if (!directories.length) {
    return { status: 'skipped', mode: config.mode, exitCode: 0, packs: [], reason: 'no-touched-workflow-pack' };
  }

  const packs = directories.map((packDir) => {
    try {
      const plan = readPlan(join(packDir, 'workflow-plan.json'));
      return {
        packDir,
        ...guardPack(root, {
          packDir,
          statePath: join(packDir, 'workflow-state.json'),
          plan,
          state: readState(join(packDir, 'workflow-state.json')),
        }, {
          mode: config.mode,
          phase: config.phase,
          apply: false,
          now: options.now ?? new Date().toISOString(),
        }),
      };
    } catch (error) {
      return {
        packDir,
        status: 'skipped',
        mode: config.mode,
        blocked: [],
        warnings: [],
        skipped: [],
        selfHealing: [],
        applied: false,
        reason: `hook-error:${error?.message ?? 'unknown'}`,
      };
    }
  });
  const blocked = packs.some((pack) => pack.status === 'blocked');
  return {
    status: blocked ? 'blocked' : packs.some((pack) => pack.status === 'advisory') ? 'advisory' : 'pass',
    mode: config.mode,
    exitCode: blocked && config.mode === 'guarded' ? 1 : 0,
    packs,
  };
}

/** Run the hook as a process for the thin git wrapper. */
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const receipt = runWorkflowInvariantHook();
  if (receipt.status !== 'pass' && receipt.status !== 'skipped') console.log(JSON.stringify(receipt, null, 2));
  process.exit(receipt.exitCode);
}
