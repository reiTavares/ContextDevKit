/**
 * Dogfood-by-default VCS posture [ADR-0054 part A].
 *
 * Writes a managed BEGIN/END block to `<common-git-dir>/info/exclude` covering
 * everything the installer generates, so a fresh install produces ZERO tracked
 * files and `--update` produces zero commits in the target project's history.
 *
 * Why `info/exclude` and not `.gitignore`: it is per-clone and never committed,
 * so the kit's posture doesn't leak into the user's tracked files — and it only
 * affects UNTRACKED paths, which makes applying it unconditionally safe: a
 * project that already commits the kit sees no behavior change at all (we only
 * print the opt-in untrack guidance — the installer never touches the index,
 * rule 8). `--tracked` skips the block entirely.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { read, ensureDir } from './fs.mjs';
import { resolveGitDir, resolveCommonDir } from './git-paths.mjs';

const BLOCK_BEGIN = '# >>> ContextDevKit install (managed block, local-only) [ADR-0054] >>>';
const BLOCK_END = '# <<< ContextDevKit install <<<';

/** Everything the installer generates — kept in sync with the install steps. */
const EXCLUDED_PATHS = [
  '/contextkit/',
  '/.claude/',
  '/CLAUDE.md',
  '/CLAUDE.contextdevkit.md',
  '/docs/CHANGELOG.md',
  '/.context-snapshot.md',
  '/.distillation-proposal.md',
  '/.agent-tuning-proposal.md',
  // Antigravity host [ADR-0036/0048]
  '/.agents/',
  '/INSTRUCTIONS.md',
  '/INSTRUCTIONS.contextdevkit.md',
  '/ctx.mjs',
  // Codex host
  '/.codex/',
  '/AGENTS.md',
  '/AGENTS.contextdevkit.md',
  '/cdx.mjs',
  // Scaffolded GitHub templates + CI
  '/.github/ISSUE_TEMPLATE/',
  '/.github/PULL_REQUEST_TEMPLATE.md',
  '/.github/dependabot.yml',
  '/.github/workflows/quality.yml',
  '/.github/workflows/security.yml',
  '/.github/workflows/squad-issue.yml',
];

/**
 * Writes (or refreshes) the managed exclude block. Idempotent: an existing
 * block is replaced in place, never duplicated. No `.git` ⇒ silent skip.
 * @returns {Promise<boolean>} whether the block was written
 */
export async function applyDogfoodExclude(target) {
  const gitDir = await resolveGitDir(join(target, '.git'), target);
  if (!gitDir) return false;
  const excludePath = join(await resolveCommonDir(gitDir), 'info', 'exclude');
  let current = '';
  try {
    if (existsSync(excludePath)) current = await read(excludePath);
  } catch {
    return false;
  }
  const block = [BLOCK_BEGIN, ...EXCLUDED_PATHS, BLOCK_END].join('\n');
  const beginAt = current.indexOf(BLOCK_BEGIN);
  const endAt = current.indexOf(BLOCK_END);
  let next;
  if (beginAt !== -1 && endAt !== -1 && endAt > beginAt) {
    next = current.slice(0, beginAt) + block + current.slice(endAt + BLOCK_END.length);
  } else {
    next = current + (current === '' || current.endsWith('\n') ? '' : '\n') + '\n' + block + '\n';
  }
  if (next === current) return true;
  await ensureDir(join(excludePath, '..'));
  await writeFile(excludePath, next, 'utf-8');
  return true;
}

/**
 * Lists kit paths the project ALREADY tracks (exclude can't hide those).
 * Used only to print the opt-in untrack guidance — never to act on the index.
 * Degrades to [] when git is unavailable (rule 2).
 * @returns {string[]} tracked kit-owned paths (possibly empty)
 */
export function detectTrackedKitPaths(target) {
  try {
    const result = spawnSync(
      'git',
      ['-C', target, 'ls-files', '--', 'contextkit', '.claude', 'CLAUDE.md', 'ctx.mjs', '.agents', '.codex', 'AGENTS.md', 'cdx.mjs'],
      { encoding: 'utf-8', windowsHide: true },
    );
    if (result.status !== 0 || !result.stdout) return [];
    return result.stdout.trim() ? result.stdout.trim().split('\n') : [];
  } catch {
    return [];
  }
}
