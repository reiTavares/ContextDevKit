#!/usr/bin/env node
/**
 * ContextDevKit integration test — installer ESM import-cycle guard (CDK-011).
 *
 * Proves the surgical extraction that broke the `git.mjs` ↔ `exclude.mjs` cycle:
 *   1. A static dependency-graph scan over `tools/install/*.mjs` finds NO cycle.
 *   2. The detector is valid — it WOULD flag a cycle if one were reintroduced
 *      (a synthetic two-node graph), so a green result is not a false negative.
 *   3. `git-paths.mjs` is the single home of the shared resolvers, and neither
 *      `git.mjs` nor `exclude.mjs` imports the other's path helper directly.
 *   4. Behavior is preserved end-to-end: in a real git WORKTREE, `resolveGitDir`
 *      follows the `.git` pointer and `applyDogfoodExclude` writes the managed
 *      block into the COMMON git dir's `info/exclude` (the worktree path that the
 *      extraction must not regress).
 *
 * Run:  node tools/integration-test-install-cycle.mjs   (exit 0 = healthy)
 */
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reporter, git } from './it-helpers.mjs';
import { resolveGitDir, resolveCommonDir } from '../tools/install/git-paths.mjs';
import { applyDogfoodExclude } from '../tools/install/exclude.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALL_DIR = resolve(HERE, 'install');

const rep = reporter();
const { ok, bad } = rep;
console.log('\n🔗 ContextDevKit integration test — installer import-cycle guard (CDK-011)\n');

/**
 * Extracts the relative local module specifiers a source file imports.
 * Only `./x.mjs` (sibling) imports matter for the install-dir graph — bare
 * `node:*` and package imports cannot close a project-internal cycle.
 * @param {string} source — module source text
 * @returns {string[]} sibling specifiers, e.g. ['git-paths.mjs', 'fs.mjs']
 */
function localImportsOf(source) {
  const found = [];
  const re = /import\s+(?:[^'"]*?\s+from\s+)?['"]\.\/([^'"]+)['"]/g;
  let match;
  while ((match = re.exec(source)) !== null) found.push(match[1]);
  return found;
}

/**
 * Detects whether a module dependency graph contains any cycle (DFS, grey/black
 * colouring). Returns the first back-edge it finds as `a -> b`, or null.
 * @param {Record<string, string[]>} graph — node → its dependency nodes
 * @returns {string | null}
 */
function findCycle(graph) {
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map();
  let hit = null;
  const visit = (node, parent) => {
    if (hit) return;
    colour.set(node, GREY);
    for (const next of graph[node] || []) {
      if (!(next in graph)) continue;
      if (colour.get(next) === GREY) {
        hit = `${node} -> ${next}`;
        return;
      }
      if (colour.get(next) !== BLACK) visit(next, node);
    }
    colour.set(node, BLACK);
  };
  for (const node of Object.keys(graph)) {
    if (!colour.has(node)) visit(node, null);
  }
  return hit;
}

try {
  // ── 1 + 3. static graph over the install modules ─────────────────────────
  const modules = ['git.mjs', 'exclude.mjs', 'git-paths.mjs', 'fs.mjs'];
  const graph = {};
  for (const name of modules) {
    const path = join(INSTALL_DIR, name);
    graph[name] = existsSync(path) ? localImportsOf(readFileSync(path, 'utf-8')) : [];
  }

  existsSync(join(INSTALL_DIR, 'git-paths.mjs'))
    ? ok('git-paths.mjs exists (the neutral path-resolution module)')
    : bad('git-paths.mjs is missing — the shared resolvers were not extracted');

  const cycle = findCycle(graph);
  cycle === null
    ? ok('no import cycle among tools/install/*.mjs')
    : bad(`import cycle detected: ${cycle}`);

  !graph['exclude.mjs'].includes('git.mjs')
    ? ok('exclude.mjs no longer imports git.mjs (cross-edge removed)')
    : bad('exclude.mjs still imports git.mjs — the cycle is back');

  graph['git.mjs'].includes('git-paths.mjs') && graph['exclude.mjs'].includes('git-paths.mjs')
    ? ok('both git.mjs and exclude.mjs import the shared git-paths.mjs')
    : bad('one of git.mjs / exclude.mjs does not source the resolver from git-paths.mjs');

  // ── 2. the detector is valid (would flag a reintroduced cycle) ───────────
  const synthetic = { 'a.mjs': ['b.mjs'], 'b.mjs': ['a.mjs'] };
  findCycle(synthetic) !== null
    ? ok('cycle detector flags a synthetic two-node cycle (guard is valid)')
    : bad('cycle detector failed to flag an obvious cycle — green result is untrustworthy');

  // ── 4. behavior preserved: real worktree path resolution ─────────────────
  const main = mkdtempSync(join(tmpdir(), 'ckit-cycle-main-'));
  const linked = mkdtempSync(join(tmpdir(), 'ckit-cycle-wt-'));
  // `git worktree add` needs the target dir to NOT pre-exist; use a child path.
  const wtPath = join(linked, 'wt');
  try {
    git(['init', '-b', 'main'], main);
    git(['config', 'user.email', 'it@example.com'], main);
    git(['config', 'user.name', 'IT'], main);
    // A worktree needs at least one commit on the base branch.
    writeFileSync(join(main, 'seed.txt'), 'seed\n', 'utf-8');
    git(['add', '.'], main);
    git(['commit', '-m', 'seed'], main);
    const added = git(['worktree', 'add', '-b', 'wt', wtPath], main);

    if (added.status !== 0) {
      bad(`git worktree add failed: ${added.stderr || added.stdout}`);
    } else {
      const wtGitDir = await resolveGitDir(join(wtPath, '.git'), wtPath);
      wtGitDir && wtGitDir.includes('worktrees')
        ? ok('resolveGitDir follows the worktree .git FILE pointer')
        : bad(`resolveGitDir did not resolve the worktree gitdir: ${wtGitDir}`);

      const commonDir = await resolveCommonDir(wtGitDir);
      resolve(commonDir) === resolve(join(main, '.git'))
        ? ok('resolveCommonDir resolves the worktree back to the main .git')
        : bad(`resolveCommonDir mismatch: ${commonDir} != ${join(main, '.git')}`);

      const wrote = await applyDogfoodExclude(wtPath);
      const excludePath = join(commonDir, 'info', 'exclude');
      const body = existsSync(excludePath) ? readFileSync(excludePath, 'utf-8') : '';
      wrote && body.includes('/contextkit/') && body.includes('ContextDevKit install (managed block')
        ? ok('applyDogfoodExclude writes the managed block into the COMMON info/exclude')
        : bad('applyDogfoodExclude did not write the exclude block in the worktree case');
    }
  } finally {
    rmSync(linked, { recursive: true, force: true });
    rmSync(main, { recursive: true, force: true });
  }
} catch (err) {
  bad(`unexpected failure: ${err && err.stack ? err.stack : err}`);
}

rep.finish('installer import-cycle guard (CDK-011)');
