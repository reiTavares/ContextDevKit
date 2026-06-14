/**
 * Neutral Git path-resolution helpers for the installer.
 *
 * Extracted from `git.mjs` to break the `git.mjs` ↔ `exclude.mjs` ESM import
 * cycle [CDK-011]: `git.mjs` needs the dogfood-exclude routine from
 * `exclude.mjs`, while `exclude.mjs` needs Git path resolution that used to live
 * in `git.mjs`. Both now depend only on this leaf module (which itself depends
 * on `node:*` + `fs.mjs`), so there is a single, acyclic direction of import.
 *
 * This module is pure path resolution — it reads pointer files but never writes,
 * and every failure degrades to `null`/identity so the installer can treat a
 * malformed or absent `.git` as "no git" rather than an error (rule 2: hooks /
 * install steps never break real work).
 */
import { stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { read } from './fs.mjs';

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
 * Resolves a (possibly worktree-private) git dir to the COMMON git dir.
 *
 * `info/exclude` lives in the common git dir — a worktree's private git dir
 * only points at it via the `commondir` file. Follow that pointer so the
 * dogfood-exclude block lands where git actually reads it. Degrades to the
 * input git dir when the pointer is absent or unreadable.
 *
 * @param {string} gitDir — resolved git dir (possibly a worktree's), from `resolveGitDir`
 * @returns {Promise<string>} the common git dir
 */
export async function resolveCommonDir(gitDir) {
  const pointerPath = join(gitDir, 'commondir');
  if (!existsSync(pointerPath)) return gitDir;
  try {
    const pointer = (await read(pointerPath)).trim();
    return isAbsolute(pointer) ? pointer : resolve(gitDir, pointer);
  } catch {
    return gitDir;
  }
}
