/**
 * Dogfood-by-default VCS posture [ADR-0054 part A; narrowed by ADR-0132].
 *
 * Writes a managed BEGIN/END block to `<common-git-dir>/info/exclude` covering
 * the install-generated MACHINERY, so a fresh install keeps the kit's engine,
 * tooling and disposable state out of the user's git while **user memory**
 * (`contextkit/memory/**` — the durable biz/op/workflow/session/ADR record) is
 * left trackable by default so a teammate's clone carries the project's memory.
 *
 * Why `info/exclude` and not `.gitignore`: it is per-clone and never committed,
 * so the kit's posture doesn't leak into the user's tracked files — and it only
 * affects UNTRACKED paths, which makes applying it unconditionally safe: a
 * project that already commits the kit sees no behavior change at all (we only
 * print the opt-in untrack guidance — the installer never touches the index,
 * rule 8). `--tracked` skips the block entirely.
 *
 * ADR-0132 memory boundary (load-bearing): git cannot re-include a path whose
 * parent is excluded, so we CANNOT exclude `/contextkit/` wholesale and then
 * negate `!contextkit/memory/`. Instead the block enumerates the machinery
 * subpaths and simply omits `contextkit/memory/`, leaving memory trackable.
 *
 * ADR-0132 dogfood/self-host GUARD (F-D BLOCKER — highest blast radius): in the
 * ContextDevKit repo itself, memory is PRIVATE (private-mirror). Narrowing here
 * must NEVER un-ignore this repo's `contextkit/memory/**`, or a human
 * `git add -A && git push` would leak it publicly. So when the install target is
 * self-hosting, we re-exclude `/contextkit/` wholesale (the pre-ADR-0132 posture)
 * — mechanized via `detectSelfHost`, proven by a blocker-level test.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { read, ensureDir } from './fs.mjs';
import { resolveGitDir, resolveCommonDir } from './git-paths.mjs';

const BLOCK_BEGIN = '# >>> ContextDevKit install (managed block, local-only) [ADR-0054] >>>';
const BLOCK_END = '# <<< ContextDevKit install <<<';

/**
 * Host front-ends + scaffolded artifacts the installer generates OUTSIDE
 * `contextkit/`. Always excluded (they are regenerable kit output, never the
 * user's durable record). Kept in sync with the install steps.
 */
const SHARED_EXCLUDED_PATHS = [
  // Generated governance digest projection (ADR-0132 §2) — regenerable from the
  // registries, so never committed (and in the dogfood repo it derives from the
  // PRIVATE memory record). Excluded in BOTH the default and self-host postures.
  '/_contextkit/',
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
 * `contextkit/` MACHINERY — kit-owned engine, tooling, policy tables, playbooks,
 * root docs and disposable runtime state. Enumerated (never the wholesale
 * `/contextkit/`) so that the SIBLING `contextkit/memory/` is NOT excluded and
 * stays trackable (ADR-0132). Keep in sync with the engine install steps; adding
 * a new top-level kit dir under `contextkit/` means adding it here.
 *
 * `contextkit/memory/` is deliberately absent. Its regenerable indices
 * (SESSIONS.md, WORKSPACE.md, project-map/, findings JSONs) are kept out of the
 * COMMITTED `.gitignore` instead (git.mjs GITIGNORE_BLOCK), so the durable record
 * is versioned while the derived indices are not.
 */
const CONTEXTKIT_MACHINERY_PATHS = [
  '/contextkit/runtime/',
  '/contextkit/tools/',
  '/contextkit/policy/',
  '/contextkit/detectors/',
  '/contextkit/mcp/',
  '/contextkit/mcp-server/',
  '/contextkit/skills/',
  '/contextkit/squads/',
  '/contextkit/starters/',
  '/contextkit/scripts/',
  '/contextkit/workflows/',
  '/contextkit/pipeline/',
  '/contextkit/config.json',
  '/contextkit/README.md',
  '/contextkit/best-practices.md',
  '/contextkit/behaviors.md',
  '/contextkit/behaviors-examples.md',
  '/contextkit/review-protocol.md',
  '/contextkit/instrucoes.md',
  '/contextkit/CLAUDE.child.md.tpl',
  '/contextkit/.cache/',
  '/contextkit/.updates/',
  // Kit-generated bookkeeping — stamped/seeded by the installer, never user data.
  // `.engine-version` changes every release, so leaving it trackable would churn a
  // version bump into every downstream project's history (ADR-0132 review blocker).
  '/contextkit/.engine-version',
  '/contextkit/.install-manifest.json',
  '/contextkit/.env.example',
];

/**
 * Default (non-dogfood) exclude set — machinery only; `contextkit/memory/` stays
 * trackable (ADR-0132). MUST NOT contain the wholesale `/contextkit/`.
 */
export const EXCLUDED_PATHS = [...SHARED_EXCLUDED_PATHS, ...CONTEXTKIT_MACHINERY_PATHS];

/**
 * Self-host exclude set — the pre-ADR-0132 posture: `/contextkit/` wholesale, so
 * this repo's PRIVATE `contextkit/memory/**` stays ignored and can never leak via
 * a public push (the F-D BLOCKER guard).
 */
export const SELF_HOST_EXCLUDED_PATHS = [...SHARED_EXCLUDED_PATHS, '/contextkit/'];

/**
 * Chooses the exclude set for the target: the self-host guard keeps `/contextkit/`
 * wholesale (memory ignored) in the ContextDevKit repo; every other project gets
 * the narrowed machinery-only set (memory trackable).
 * @param {boolean} selfHost whether the install target is self-hosting.
 * @returns {string[]} the ordered exclude paths.
 */
export function excludePathsFor(selfHost) {
  return selfHost === true ? SELF_HOST_EXCLUDED_PATHS : EXCLUDED_PATHS;
}

/**
 * Writes (or refreshes) the managed exclude block. Idempotent: an existing
 * block is replaced in place, never duplicated. No `.git` ⇒ silent skip.
 *
 * @param {string} target project root.
 * @param {{ selfHost?: boolean }} [opts] `selfHost` re-excludes `/contextkit/`
 *   wholesale so the dogfood repo's private memory stays ignored (ADR-0132 F-D).
 *   Defaults to the narrowed, memory-trackable posture.
 * @returns {Promise<boolean>} whether the block was written
 */
export async function applyDogfoodExclude(target, opts = {}) {
  const gitDir = await resolveGitDir(join(target, '.git'), target);
  if (!gitDir) return false;
  const excludePath = join(await resolveCommonDir(gitDir), 'info', 'exclude');
  let current = '';
  try {
    if (existsSync(excludePath)) current = await read(excludePath);
  } catch {
    return false;
  }
  const paths = excludePathsFor(opts.selfHost === true);
  const block = [BLOCK_BEGIN, ...paths, BLOCK_END].join('\n');
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
