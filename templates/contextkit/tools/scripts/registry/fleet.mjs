/**
 * Fleet awareness — enumerate the sibling git worktrees on this machine so intake
 * numbering (BIZ / OP / WF / ADR) can be reconciled across every parallel working
 * copy, not just the local one (ADR-0119).
 *
 * The numbering allocators in `ids.mjs` historically scanned only `process.cwd()`,
 * so two worktrees running intake at the same time picked the same next number and
 * collided on merge. `fleetMemoryRoots` gives those allocators the full set of
 * memory roots to take the global max over.
 *
 * Defensive by contract (immutable rule 2): any git/IO failure collapses to the
 * local root alone — fleet reconciliation is best-effort and never throws, never
 * breaks an allocation. Pure `node:*`, zero runtime dependencies.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { pathsFor } from '../../../runtime/config/paths.mjs';

/** Normalise a path to forward slashes so Windows/git spellings dedupe cleanly. */
const norm = (value) => String(value).replace(/\\/g, '/');

/**
 * Parses `git worktree list --porcelain` into `[{ path, branch }]`.
 *
 * Uses `execFileSync` with an argv array (no shell) so nothing can be injected,
 * and returns `[]` on any failure (not a git repo, git missing, parse error) —
 * callers treat an empty fleet as "local only".
 *
 * @param {string} [root] - directory to run git in (default cwd).
 * @returns {{path: string, branch: string|null}[]} one entry per worktree.
 */
export function listWorktrees(root = process.cwd()) {
  let out;
  try {
    out = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: root,
      encoding: 'utf-8',
      // Swallow git's stderr ("not a git repository") — the catch handles failure;
      // we never want the diagnostic to leak into a caller's clean output.
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return [];
  }
  const trees = [];
  let current = null;
  for (const rawLine of out.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith('worktree ')) {
      if (current) trees.push(current);
      current = { path: line.slice('worktree '.length).trim(), branch: null };
    } else if (line.startsWith('branch ') && current) {
      current.branch = line.slice('branch '.length).trim();
    } else if (line === '' && current) {
      trees.push(current);
      current = null;
    }
  }
  if (current) trees.push(current);
  return trees;
}

/**
 * Every worktree's `memory/` root that exists on disk, local-first and deduped.
 *
 * The local memory root is ALWAYS included (even before it exists on disk) so an
 * allocation in a brand-new checkout still works. Sibling roots are included only
 * when present, so a worktree without the (gitignored) dogfood install contributes
 * nothing rather than a phantom path.
 *
 * @param {string} [root] - project root (default cwd).
 * @returns {string[]} absolute `memory/` directories, forward-slash normalised.
 */
export function fleetMemoryRoots(root = process.cwd()) {
  const localMemory = norm(pathsFor(root).memory);
  const seen = new Set();
  const roots = [];
  const add = (memory, requireExists) => {
    if (!memory || seen.has(memory)) return;
    if (requireExists && !existsSync(memory)) return;
    seen.add(memory);
    roots.push(memory);
  };
  add(localMemory, false); // local root first, always present
  for (const worktree of listWorktrees(root)) {
    try {
      add(norm(pathsFor(worktree.path).memory), true);
    } catch {
      /* skip a worktree whose path can't be resolved */
    }
  }
  return roots;
}
