/**
 * Git integration for the installer: drop the L≥3 git-hook wrappers, and patch
 * `.gitignore` / `.gitattributes` idempotently (never double-append).
 */
import { writeFile, chmod, rename, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { ensureDir, read, copyTreeIfMissing } from './fs.mjs';
import { applyDogfoodExclude, detectTrackedKitPaths } from './exclude.mjs';

/**
 * Resolves a `.git` path to the *actual* git directory.
 *
 * In a regular repo, `.git` is a directory — return it as-is. In a git
 * worktree (or a submodule), `.git` is a regular **file** containing
 * `gitdir: <absolute-or-relative-path>`. We follow that pointer so hooks
 * land in the worktree-specific git dir (`<main>/.git/worktrees/<name>/hooks/`),
 * which is what git actually looks at when running hooks for a worktree.
 *
 * Returns `null` when the pointer is malformed — the installer treats that
 * as "no git" and skips hook installation (rule 2: never break real work).
 *
 * @param {string} dotGit — path to the project's `.git` (file or dir)
 * @param {string} target — project root, for resolving relative gitdir pointers
 * @returns {Promise<string | null>}
 */
export async function resolveGitDir(dotGit, target) {
  try {
    const st = await stat(dotGit);
    if (st.isDirectory()) return dotGit;
    if (!st.isFile()) return null;
    const text = (await read(dotGit)).trim();
    const match = text.match(/^gitdir:\s*(.+)$/m);
    if (!match) return null;
    const pointer = match[1].trim();
    return isAbsolute(pointer) ? pointer : resolve(target, pointer);
  } catch {
    return null;
  }
}

/**
 * Installs thin git-hook wrappers that call the engine scripts. Needs a `.git`.
 *
 * If a hook file already exists and is NOT one of ours (e.g. a husky/lint-staged
 * hook), it is backed up to `<name>.bak` before being replaced — so the user's
 * own hook is never silently clobbered. An existing `.bak` is preserved (the
 * first backup wins) so re-running the installer can't overwrite the original.
 *
 * @returns {Promise<{ installed: boolean, backedUp: string[] }>}
 */
export async function installGitHooks(target) {
  const dotGit = join(target, '.git');
  if (!existsSync(dotGit)) return { installed: false, backedUp: [] };
  // Worktrees + submodules have `.git` as a FILE pointing at the real gitdir.
  // Follow the pointer so hooks land where git will actually invoke them
  // (and so `ensureDir` doesn't trip on ENOTDIR — bug 038, ADR-0015 session).
  const gitDir = await resolveGitDir(dotGit, target);
  if (!gitDir) return { installed: false, backedUp: [] };
  const hooksDir = join(gitDir, 'hooks');
  await ensureDir(hooksDir);
  const wrappers = {
    'pre-commit': '#!/bin/sh\nnode contextkit/runtime/git-hooks/pre-commit.mjs\n',
    'commit-msg': '#!/bin/sh\nnode contextkit/runtime/git-hooks/commit-msg.mjs "$1"\n',
    'pre-push': '#!/bin/sh\nnode contextkit/runtime/git-hooks/pre-push.mjs\n',
  };
  const backedUp = [];
  for (const [name, body] of Object.entries(wrappers)) {
    const p = join(hooksDir, name);
    if (existsSync(p) && !(await read(p)).includes('contextkit/runtime/git-hooks')) {
      const backup = `${p}.bak`;
      if (!existsSync(backup)) {
        await rename(p, backup);
        backedUp.push(name);
      }
    }
    await writeFile(p, body, 'utf-8');
    await chmod(p, 0o755).catch(() => {});
  }
  return { installed: true, backedUp };
}

/**
 * Reads `hooksPath` from a project's `.git/config` (the `[core]` section) without
 * spawning git — zero-dep and worktree-safe. Returns the configured path, or `null`
 * when unset/unreadable. Defensive: any failure degrades to `null` (rule 2).
 *
 * @param {string} gitDir — resolved git directory (from `resolveGitDir`)
 * @returns {Promise<string | null>}
 */
async function readCoreHooksPath(gitDir) {
  try {
    const cfg = await read(join(gitDir, 'config')).catch(() => '');
    const match = cfg.match(/^\s*hookspath\s*=\s*(.+)$/im);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

/** Per-manager integration suggestions — a shell line chaining OUR node wrapper. */
const COEXIST = {
  husky: {
    type: 'husky',
    details: 'found a .husky/ directory (Husky manages your git hooks)',
    suggestion: 'chain our hooks from yours, e.g.:\n  echo "node contextkit/runtime/git-hooks/pre-push.mjs" >> .husky/pre-push\n  echo "node contextkit/runtime/git-hooks/commit-msg.mjs \\"$1\\"" >> .husky/commit-msg',
  },
  lefthook: {
    type: 'lefthook',
    details: 'found a Lefthook config (lefthook.yml)',
    suggestion: 'add a command to lefthook.yml, e.g.:\n  pre-push:\n    commands:\n      contextkit:\n        run: node contextkit/runtime/git-hooks/pre-push.mjs',
  },
  'simple-git-hooks': {
    type: 'simple-git-hooks',
    details: 'found a "simple-git-hooks" key in package.json',
    suggestion: 'add our wrappers to the simple-git-hooks block in package.json, e.g.:\n  "pre-push": "node contextkit/runtime/git-hooks/pre-push.mjs",\n  "commit-msg": "node contextkit/runtime/git-hooks/commit-msg.mjs $1"',
  },
};

/**
 * Detects an existing git-hook MANAGER so the installer can SUGGEST integration
 * instead of silently clobbering. Checks, in order: a custom `core.hooksPath`
 * (≠ ours — we write into `.git/hooks/`, never set hooksPath), `.husky/`,
 * Lefthook config, a `simple-git-hooks` key in `package.json`, and a non-kit
 * hook already present in `.git/hooks/`.
 *
 * Pure detection — never mutates, never throws. Any read failure is treated as
 * "not detected" so a flaky filesystem can't block the install (rule 2).
 *
 * @param {string} target — project root
 * @returns {Promise<{ detected: boolean, type?: string, details?: string, suggestion?: string }>}
 */
export async function detectExistingHooksManager(target) {
  try {
    const dotGit = join(target, '.git');
    const gitDir = existsSync(dotGit) ? await resolveGitDir(dotGit, target) : null;

    // 1. A custom core.hooksPath. We never set one (we drop wrappers into
    //    .git/hooks/ directly), so ANY configured hooksPath is a foreign manager.
    if (gitDir) {
      const hooksPath = await readCoreHooksPath(gitDir);
      if (hooksPath) {
        return {
          detected: true,
          type: 'core.hooksPath',
          details: `git core.hooksPath is set to "${hooksPath}" — your hooks run from there, not .git/hooks/`,
          suggestion: `call our wrappers from that directory, e.g.:\n  echo "node contextkit/runtime/git-hooks/pre-push.mjs" >> ${hooksPath}/pre-push`,
        };
      }
    }

    // 2. Husky.
    if (existsSync(join(target, '.husky'))) return { detected: true, ...COEXIST.husky };

    // 3. Lefthook.
    if (existsSync(join(target, '.lefthook.yml')) || existsSync(join(target, 'lefthook.yml'))) {
      return { detected: true, ...COEXIST.lefthook };
    }

    // 4. simple-git-hooks in package.json.
    const pkgPath = join(target, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(await read(pkgPath));
        if (pkg && pkg['simple-git-hooks']) return { detected: true, ...COEXIST['simple-git-hooks'] };
      } catch {
        /* malformed package.json — treat as no manager */
      }
    }

    // 5. A non-kit hook already living in .git/hooks/.
    if (gitDir) {
      for (const name of ['pre-commit', 'commit-msg', 'pre-push']) {
        const hookPath = join(gitDir, 'hooks', name);
        if (!existsSync(hookPath)) continue;
        const body = await read(hookPath).catch(() => '');
        if (body && !body.includes('contextkit/runtime/git-hooks')) {
          return {
            detected: true,
            type: 'git-hooks',
            details: `found an existing ${name} hook in .git/hooks/ (not ours)`,
            suggestion: `we back it up to ${name}.bak; to keep both, chain it back:\n  node contextkit/runtime/git-hooks/${name}.mjs`,
          };
        }
      }
    }
  } catch {
    /* detection must never break the install — degrade to not-detected */
  }
  return { detected: false };
}

const GITIGNORE_BLOCK = [
  '',
  '# ContextDevKit — local runtime state (do not commit)',
  '.claude/.sessions/',
  '.claude/.workspace/',
  '.codex/.sessions/',
  '.codex/.workspace/',
  'contextkit/pipeline/state/',
  '.context-snapshot.md',
  '.distillation-proposal.md',
  '.agent-tuning-proposal.md',
  'contextkit/memory/tech-debt-findings.json',
  'contextkit/memory/deps-findings.json',
  'contextkit/memory/deep-analysis-findings.json',
  'contextkit/.cache/',
  'contextkit/.updates/',
].join('\n');

export async function patchGitignore(target) {
  const p = join(target, '.gitignore');
  let current = '';
  if (existsSync(p)) current = await read(p);
  if (current.includes('ContextDevKit — local runtime state')) {
    // Upgrade path: older installs have the block without the .updates line [ADR-0054].
    if (current.includes('contextkit/.updates/')) return false;
    await writeFile(p, current.replace('contextkit/.cache/', 'contextkit/.cache/\ncontextkit/.updates/'), 'utf-8');
    return true;
  }
  await writeFile(p, current + (current.endsWith('\n') || current === '' ? '' : '\n') + GITIGNORE_BLOCK + '\n', 'utf-8');
  return true;
}

export async function patchGitattributes(target, tplDir) {
  const tplPath = join(tplDir, 'gitattributes');
  if (!existsSync(tplPath)) return false;
  const block = await read(tplPath);
  const p = join(target, '.gitattributes');
  let current = '';
  if (existsSync(p)) current = await read(p);
  if (current.includes('ContextDevKit — keep engine scripts')) return false;
  await writeFile(p, current + (current.endsWith('\n') || current === '' ? '' : '\n') + block, 'utf-8');
  return true;
}

/**
 * VCS integration step: patch .gitignore/.gitattributes, seed GitHub templates,
 * install the L≥3 git hooks, and hint at connecting a remote. Defensive — a missing
 * `.git` degrades to a hint, never a failure (rule 2) [ADR-0037].
 * @param {string} target - project root
 * @param {string} tplDir - templates dir
 * @param {number} level - active level (git hooks only at L≥3)
 * @param {string[]} report - mutated with progress lines
 */
export async function installVcsIntegration(target, tplDir, level, args, report) {
  // Dogfood by default [ADR-0054]: install artifacts stay out of the user's git
  // history. Safe unconditionally — info/exclude only affects UNTRACKED paths.
  if (!args.tracked && (await applyDogfoodExclude(target))) {
    report.push('✓ install artifacts excluded from git (local-only; pass --tracked to commit them)');
    const tracked = detectTrackedKitPaths(target);
    if (tracked.length > 0) {
      report.push(`ℹ️  ${tracked.length} kit file(s) are ALREADY tracked — the exclude can't hide those.`);
      report.push('   To stop committing them (optional): git rm -r --cached contextkit .claude .agents .codex CLAUDE.md AGENTS.md ctx.mjs cdx.mjs');
    }
  }
  if (await patchGitignore(target)) report.push('✓ .gitignore patched');
  if (await patchGitattributes(target, tplDir)) report.push('✓ .gitattributes patched (LF for engine scripts)');
  const ghCount = await copyTreeIfMissing(join(tplDir, 'github'), join(target, '.github'));
  if (ghCount > 0) report.push(`✓ ${ghCount} GitHub template(s) added to .github/`);
  if (level >= 3) {
    // Detect an existing hook manager BEFORE we install. We still install our
    // backup-and-write default (the .bak fallback stays intact) but we SUGGEST
    // a non-destructive integration path so adoption stays friendly [ADR-0063].
    const coexist = await detectExistingHooksManager(target);
    const gitHooks = await installGitHooks(target);
    if (coexist.detected) {
      report.push(`ℹ️  existing git-hook manager detected (${coexist.type}): ${coexist.details}`);
      report.push(`   ↳ to integrate instead of running side-by-side: ${coexist.suggestion}`);
    }
    if (gitHooks.installed) {
      report.push('✓ git hooks installed (pre-commit, commit-msg, pre-push)');
      if (gitHooks.backedUp.length) report.push(`  ↳ backed up your existing ${gitHooks.backedUp.join(', ')} hook(s) → *.bak`);
    } else report.push('ℹ️  no .git found — run `git init` then re-run to install git hooks');
  }
  // Version-control hint: suggest connecting a remote if there isn't one.
  if (!existsSync(join(target, '.git')) || !(await read(join(target, '.git', 'config')).catch(() => '')).includes('[remote "origin"]')) {
    report.push('ℹ️  no git remote — run /git setup-remote to connect GitHub/GitLab/other (+ CLI)');
  }
}
