/**
 * Graph dependency guarantee (WF-0108 / ADR-0155).
 *
 * The graph's AST tier needs the `web-tree-sitter` JS binding, which
 * `graph-ast.mjs#loadTreeSitter` reaches through a DYNAMIC import resolved against
 * the TARGET project's `node_modules` (the dynamic import is what keeps the hot
 * path dependency-free — ADR-0134/0147). The `.wasm` grammars ship vendored, so
 * they always arrive; the binding did not, which meant a fresh install degraded
 * silently to the regex tier. Graph-first is mandatory now (ADR-0155), so the
 * dependency it rests on has to be installed rather than hoped for.
 *
 * The dependency SET is read from the kit's own `optionalDependencies` — single
 * source of truth, so bumping a pin in `package.json` needs no edit here and the
 * two can never drift.
 *
 * Guard order (cheapest / safest first):
 *   1. capability disabled (explicit opt-out)   -> disabled (silent no-op)
 *   2. self-update risk                         -> deferred_self_update
 *   3. active sessions                          -> deferred_active_sessions
 *   4. target has no package.json               -> not_a_node_project
 *   5. every dep already resolvable             -> satisfied
 *   6. install the missing ones                 -> installed | failed
 *
 * Fail-open throughout: a failed dependency install degrades the graph to the
 * regex tier (an honest, lower-fidelity graph) and NEVER breaks the install.
 * Zero runtime deps beyond `node:*`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

/** Wall-clock ceiling for the dependency install, so a hung registry never hangs the installer. */
export const INSTALL_TIMEOUT_MS = 180_000;

/** BOM-safe JSON read; returns null on absence or any parse failure. */
function readJson(path) {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf-8');
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * The graph's dependency pins, read from the KIT's own `optionalDependencies`.
 * Single-sourced on purpose: a version bump in `package.json` propagates here
 * automatically, so this module can never ship a stale pin.
 *
 * @param {string} kitRoot absolute path of the kit package root
 * @returns {Array<{name:string, version:string}>} exact pins (empty when unreadable)
 */
export function graphDependencies(kitRoot) {
  const pkg = readJson(join(kitRoot, 'package.json'));
  const optional = pkg?.optionalDependencies;
  if (!optional || typeof optional !== 'object') return [];
  return Object.entries(optional)
    .filter(([name, version]) => typeof name === 'string' && typeof version === 'string' && version.length > 0)
    .map(([name, version]) => ({ name, version }));
}

/** Reads `projectMap.graph.enabled` from the target's committed config, refusal-by-default. */
function graphEnabled(target) {
  const cfg = readJson(join(target, 'contextkit', 'config.json'));
  return Boolean(cfg && cfg.projectMap && cfg.projectMap.graph && cfg.projectMap.graph.enabled === true);
}

/**
 * Resolves the target's package manager from its lockfiles, then its
 * `packageManager` field, defaulting to npm for any project that has a
 * `package.json` at all. Returns null when the target is not a Node project.
 *
 * @param {string} target absolute path to the target project
 * @param {Function} [existsFn] injectable existence check (tests)
 * @returns {'pnpm'|'yarn'|'bun'|'npm'|null}
 */
export function detectPackageManager(target, existsFn = existsSync) {
  if (existsFn(join(target, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsFn(join(target, 'yarn.lock'))) return 'yarn';
  if (existsFn(join(target, 'bun.lockb'))) return 'bun';
  if (existsFn(join(target, 'package-lock.json'))) return 'npm';
  const pkg = readJson(join(target, 'package.json'));
  if (!pkg) return null;
  if (typeof pkg.packageManager === 'string' && pkg.packageManager.length > 0) {
    const name = pkg.packageManager.split('@')[0];
    if (['pnpm', 'yarn', 'bun', 'npm'].includes(name)) return /** @type {any} */ (name);
  }
  return 'npm';
}

/**
 * Builds the add-as-dev-dependency argv for a package manager. Versions are
 * EXACT pins (`name@1.2.3`, plus npm's `--save-exact`) — no caret ranges, per the
 * kit's dependency policy.
 *
 * @param {'pnpm'|'yarn'|'bun'|'npm'} manager
 * @param {string[]} specs `name@version` specifiers
 * @returns {{command:string, args:string[]}}
 */
export function installCommand(manager, specs) {
  switch (manager) {
    case 'pnpm':
      return { command: 'pnpm', args: ['add', '-D', '--save-exact', ...specs] };
    case 'yarn':
      return { command: 'yarn', args: ['add', '-D', '--exact', ...specs] };
    case 'bun':
      return { command: 'bun', args: ['add', '-d', '--exact', ...specs] };
    default:
      return { command: 'npm', args: ['install', '-D', '--save-exact', ...specs] };
  }
}

/**
 * Which of the graph's dependencies are NOT resolvable in the target yet.
 *
 * @param {string} target absolute path to the target project
 * @param {Array<{name:string, version:string}>} deps
 * @param {Function} [existsFn] injectable existence check (tests)
 * @returns {Array<{name:string, version:string}>}
 */
export function missingDependencies(target, deps, existsFn = existsSync) {
  return deps.filter((dep) => !existsFn(join(target, 'node_modules', dep.name, 'package.json')));
}

/** Default runner: install the missing deps with the detected package manager. */
function defaultRunInstall(manager, specs, cwd) {
  const { command, args } = installCommand(manager, specs);
  execFileSync(command, args, { cwd, stdio: 'ignore', timeout: INSTALL_TIMEOUT_MS, shell: process.platform === 'win32' });
}

/**
 * Conditionally installs the graph's dependencies into a target. Returns
 * `{ status, note }`; never throws.
 *
 * @param {string} target absolute path to the target project
 * @param {object} [opts]
 * @param {string} [opts.kitRoot] kit package root (where the pins live)
 * @param {Function} [opts.isEnabled] injectable enable-check fn(target)
 * @param {Function} [opts.runInstall] injectable runner fn(manager, specs, cwd)
 * @param {Function} [opts.existsFn] injectable existence check
 * @param {'pnpm'|'yarn'|'bun'|'npm'|null} [opts.manager] override the detected package manager
 * @param {Array<{name:string,version:string}>} [opts.deps] injected dependency pins
 * @param {boolean} [opts.selfHost] self-update risk -> defer
 * @param {Array|number} [opts.activeSessions] active sessions -> defer
 * @returns {Promise<{status:string, note:string}>}
 */
export async function maybeInstallGraphDeps(target, opts = {}) {
  const isEnabled = opts.isEnabled ?? graphEnabled;
  const runInstall = opts.runInstall ?? defaultRunInstall;
  const existsFn = opts.existsFn ?? existsSync;

  // Guard 1: capability disabled -> silent no-op.
  if (!isEnabled(target)) {
    return { status: 'disabled', note: 'graph deps: projectMap.graph.enabled is false — skipped (explicit opt-out)' };
  }
  // Guard 2/3: the same deferrals the graph index honors — an installer must not
  // mutate a target that is mid-session or updating itself.
  if (opts.selfHost === true) {
    return { status: 'deferred_self_update', note: 'graph deps: deferred (self-update risk)' };
  }
  const sessions = opts.activeSessions;
  const active = Array.isArray(sessions) ? sessions.length > 0 : typeof sessions === 'number' ? sessions > 0 : false;
  if (active) {
    return { status: 'deferred_active_sessions', note: 'graph deps: deferred (active sessions)' };
  }
  // Guard 4: not a Node project — the AST tier degrades to regex, which is honest.
  // `manager` is injectable because `detectPackageManager`'s `packageManager`-field
  // fallback reads real disk, so it cannot be driven by `existsFn` alone.
  const manager = opts.manager !== undefined ? opts.manager : detectPackageManager(target, existsFn);
  if (manager === null) {
    return { status: 'not_a_node_project', note: 'graph deps: no package.json in target — graph runs on its regex tier (no AST)' };
  }

  const deps = opts.deps ?? graphDependencies(opts.kitRoot ?? process.cwd());
  if (deps.length === 0) {
    return { status: 'unknown_pins', note: 'graph deps: could not read the kit dependency pins — skipped (never guessed)' };
  }
  // Guard 5: already satisfied.
  const missing = missingDependencies(target, deps, existsFn);
  if (missing.length === 0) {
    return { status: 'satisfied', note: `✓ graph deps present (${deps.map((d) => d.name).join(', ')})` };
  }
  // Guard 6: install the missing ones, fail-open.
  const specs = missing.map((dep) => `${dep.name}@${dep.version}`);
  try {
    runInstall(manager, specs, target);
    return { status: 'installed', note: `✓ graph deps installed via ${manager} (${specs.join(', ')})` };
  } catch (err) {
    const reason = err?.message ?? String(err);
    return {
      status: 'failed',
      note: `graph deps: ${manager} install failed (${reason}) — graph falls back to its regex tier; run "${installCommand(manager, specs).command} ${installCommand(manager, specs).args.join(' ')}" by hand for full AST fidelity`,
    };
  }
}
