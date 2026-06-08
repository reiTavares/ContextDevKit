/**
 * Git integration for the installer: drop the L≥3 git-hook wrappers, and patch
 * `.gitignore` / `.gitattributes` idempotently (never double-append).
 */
import { writeFile, chmod, rename, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { ensureDir, read } from './fs.mjs';

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

const GITIGNORE_BLOCK = [
  '',
  '# ContextDevKit — local runtime state (do not commit)',
  '.claude/.sessions/',
  '.claude/.workspace/',
  '.context-snapshot.md',
  '.distillation-proposal.md',
  '.agent-tuning-proposal.md',
  'contextkit/memory/tech-debt-findings.json',
  'contextkit/memory/deps-findings.json',
  'contextkit/memory/deep-analysis-findings.json',
  'contextkit/.cache/',
].join('\n');

export async function patchGitignore(target) {
  const p = join(target, '.gitignore');
  let current = '';
  if (existsSync(p)) current = await read(p);
  if (current.includes('ContextDevKit — local runtime state')) return false;
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
