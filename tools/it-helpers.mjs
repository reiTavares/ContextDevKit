/**
 * Shared harness for the integration tests.
 *
 * The end-to-end suite is split by responsibility to stay within the line budget:
 *   - `integration-test.mjs`                  — core engine: install + the real hooks.
 *   - `integration-test-tooling.mjs`          — the tool scripts (deps, fleet, agent-forge, …).
 *   - `integration-test-tooling-pipeline.mjs` — the DevPipeline chain (ADR-0016 H1 split).
 *   - `integration-test-guards.mjs`           — guards that REJECT bad input (commit-msg, pre-push, loader).
 * Each installs a throwaway temp project via `installFixture` and drives it through
 * `child_process` with a real stdin pipe — exactly how Claude Code invokes hooks.
 * Cross-platform (avoids PowerShell's broken string-to-stdin piping), self-cleaning.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
export const node = process.execPath;

/**
 * Strips inherited git-repo-location env vars so a spawned git/installer
 * resolves the repo from `cwd`, not a leaked `GIT_DIR`. Without this, these
 * tests fail when run INSIDE a git hook (e.g. the kit's own pre-push during a
 * release self-push): the outer push exports GIT_DIR/GIT_INDEX_FILE, which then
 * hijack the temp project's `git init`, so its hooks are never installed.
 * @param {NodeJS.ProcessEnv} [base] env to sanitize (default process.env)
 * @returns {NodeJS.ProcessEnv}
 */
export function cleanGitEnv(base = process.env) {
  const env = { ...base };
  for (const key of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']) {
    delete env[key];
  }
  return env;
}

export const run = (args, opts = {}) => {
  const { env, ...rest } = opts;
  return spawnSync(node, args, { encoding: 'utf-8', ...rest, env: cleanGitEnv(env ?? process.env) });
};
export const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf-8', env: cleanGitEnv() });
export const readJson = (p) => JSON.parse(readFileSync(p, 'utf-8').replace(/^﻿/, ''));

/** A pass/fail reporter with its own failure counter. `finish` sets the exit code. */
export function reporter() {
  let failures = 0;
  return {
    ok: (m) => console.log(`  ✓ ${m}`),
    bad: (m) => {
      console.error(`  ✗ ${m}`);
      failures += 1;
    },
    finish: (label) => {
      console.log(failures === 0 ? `\n✅ ${label} passed.\n` : `\n❌ ${failures} check(s) failed.\n`);
      process.exit(failures === 0 ? 0 : 1);
    },
  };
}

/**
 * Fresh temp git repo with the kit installed at Level 5. Returns helpers bound to
 * it: `hook(name, payload)` pipes JSON to a runtime hook; `script(rel, ...args)`
 * runs a tool script; `cleanup()` removes the temp project.
 */
export function installFixture(rep) {
  const proj = mkdtempSync(join(tmpdir(), 'contextkit-it-'));
  git(['init', '-b', 'main'], proj);
  git(['config', 'user.email', 'it@example.com'], proj);
  git(['config', 'user.name', 'IT'], proj);
  const inst = run([join(KIT, 'install.mjs'), '--target', proj, '--level', '5', '--name', 'IT App', '--yes']);
  inst.status === 0 ? rep.ok('install at Level 5') : rep.bad(`install failed (status ${inst.status}): ${inst.stderr}`);
  return {
    proj,
    cfgPath: join(proj, 'contextkit', 'config.json'),
    hook: (name, payload) => run([join(proj, 'contextkit', 'runtime', 'hooks', name)], { cwd: proj, input: JSON.stringify(payload) }).stdout || '',
    script: (rel, ...a) => run([join(proj, 'contextkit', 'tools', 'scripts', rel), ...a], { cwd: proj }),
    cleanup: () => rmSync(proj, { recursive: true, force: true }),
  };
}
