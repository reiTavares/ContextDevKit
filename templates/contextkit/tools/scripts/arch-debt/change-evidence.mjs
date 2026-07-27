/**
 * change-evidence.mjs — the CHANGE-EVIDENCE COLLECTOR for the Architecture &
 * Technical-Debt Governance Gate (OP-0012 hotfix, ADR-0122 §9.6 / §17).
 *
 * WHY THIS EXISTS. The gate's blocking floors were correct and unit-tested but
 * DORMANT on the real CLI path: `gate-context.mjs` reads
 * `cfg.securityChangedFiles` / `cfg.reliability` / `cfg.changedBehaviors` /
 * `cfg.impactedTests`, and the config resolver produced NONE of those keys. So
 * `securityFloor([])` scanned nothing and the gate could only ever emit
 * PASS / PASS_WITH_OBSERVATION. A floor that receives no evidence is not a
 * floor — it is decoration. This module is the missing producer.
 *
 * WHAT IT PRODUCES (only what can be OBSERVED, never invented):
 *   - `securityChangedFiles` — per-file added/removed LINES from a real unified
 *     diff, which is exactly the shape `securityFloor` consumes. Derived from
 *     git, so it is reproducible and requires no project declaration.
 *   - `diffBase` / `changedPaths` — the review range the whole gate scopes to.
 *
 * WHAT IT DELIBERATELY DOES NOT INVENT (constitution §8, §9): reliability
 * metadata (which migrations are irreversible, which async paths are critical)
 * and behavior criticality are DECLARED facts, not inferable from a diff. This
 * collector never guesses them — the resolver passes the project's declaration
 * through, and absent a declaration the floor stays silent rather than faking a
 * verdict in either direction. Guessing "this looks like a migration" would
 * produce exactly the false-positive CI failures that get a gate switched off.
 *
 * PURITY. Every git invocation is INJECTED (`runGit`) so the parsing and the
 * base-resolution logic are unit-testable with zero I/O. All failures degrade to
 * "no evidence" (an empty set), never to a thrown error inside the gate
 * (immutable rule 2) — and "no evidence" can never become a PASS claim, because
 * an unevaluated floor emits nothing rather than emitting a pass.
 *
 * Zero runtime deps, ESM, `node:`/relative imports only (immutable rule #1).
 */

import { execFileSync } from 'node:child_process';

/**
 * Default git runner — argv array (never a shell string) so no path or ref can be
 * interpolated into a command. Returns `null` on ANY failure so every caller has
 * exactly one degraded path to handle.
 *
 * @param {string} root  cwd for the git invocation.
 * @param {string[]} args  git arguments.
 * @returns {string|null} stdout, or null when git is unavailable/failed.
 */
export function defaultRunGit(root, args) {
  try {
    return execFileSync('git', args, {
      cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

/**
 * Resolve the diff BASE the gate should review against.
 *
 * `git diff HEAD` (the previous behaviour) only sees UNCOMMITTED work, so on a
 * clean CI checkout the changed-set was always empty — which silently disabled
 * the whole changed-set scoping story ("only your changed files can block").
 * The ladder below prefers an explicit base, then the host's PR base, then the
 * merge-base with the default branch, and only falls back to the working tree.
 *
 * @param {Object} [env]  process env (injected for tests).
 * @param {string} [root] project root.
 * @param {(root:string,args:string[])=>(string|null)} [runGit]  injected runner.
 * @returns {{range:string[], base:string|null, kind:string}} git args + provenance.
 */
export function resolveDiffBase(env = {}, root = process.cwd(), runGit = defaultRunGit) {
  const explicit = typeof env.CONTEXTKIT_DIFF_BASE === 'string' && env.CONTEXTKIT_DIFF_BASE.trim()
    ? env.CONTEXTKIT_DIFF_BASE.trim()
    : null;
  const prBase = typeof env.GITHUB_BASE_REF === 'string' && env.GITHUB_BASE_REF.trim()
    ? `origin/${env.GITHUB_BASE_REF.trim()}`
    : null;

  for (const candidate of [explicit, prBase]) {
    if (!candidate) continue;
    // Verify the ref exists before trusting it; an unknown ref must not make the
    // gate blind (it would degrade to an empty changed-set = nothing in scope).
    if (runGit(root, ['rev-parse', '--verify', '--quiet', candidate]) !== null) {
      return { range: [`${candidate}...HEAD`], base: candidate, kind: 'merge-base' };
    }
  }
  // Working tree (local dev): uncommitted changes vs HEAD.
  return { range: ['HEAD'], base: 'HEAD', kind: 'working-tree' };
}

/** Strip a trailing CR so Windows-checkout diffs parse identically (rule 4). */
const stripCr = (line) => line.replace(/\r$/, '');

/**
 * Parse a unified diff into per-file added/removed LINE CONTENT — the exact
 * shape `securityFloor(changedFiles)` consumes.
 *
 * Only `+`/`-` content lines are collected (the `+++`/`---` headers and the `@@`
 * hunk markers are excluded), so a pattern can never match on diff syntax
 * itself. Renames report under the new path.
 *
 * @param {string} text  `git diff -U0` output.
 * @returns {{path:string, addedLines:string[], removedLines:string[]}[]}
 */
export function parseUnifiedDiff(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const files = [];
  let current = null;

  for (const raw of text.split('\n')) {
    const line = stripCr(raw);
    if (line.startsWith('diff --git ')) {
      if (current) files.push(current);
      current = null;
      continue;
    }
    if (line.startsWith('+++ ')) {
      // `+++ b/path`, or `+++ /dev/null` for a deletion (nothing added to scan).
      const target = line.slice(4).trim();
      if (target === '/dev/null') { current = null; continue; }
      const path = target.replace(/^[ab]\//, '');
      current = { path, addedLines: [], removedLines: [] };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('---') || line.startsWith('@@')) continue;
    if (line.startsWith('+')) current.addedLines.push(line.slice(1));
    else if (line.startsWith('-')) current.removedLines.push(line.slice(1));
  }
  // `files` already holds every `current` (pushed at creation); dedupe defensively.
  return files.filter((file, index) => files.indexOf(file) === index);
}

/**
 * Collect the change evidence for one gate run: the diff base, the changed paths,
 * and the per-file added/removed lines the security floor scans.
 *
 * Degrades to an EMPTY evidence set on any git failure. An empty set means the
 * security floor emits nothing — NOT that it passed (constitution §8: a check
 * that cannot run reports nothing, never a pass).
 *
 * @param {Object} [opts]
 * @param {string} [opts.root]  project root.
 * @param {Object} [opts.env]   process env (injected for tests).
 * @param {(root:string,args:string[])=>(string|null)} [opts.runGit]  injected runner.
 * @returns {{securityChangedFiles:Array, changedPaths:string[], diffBase:string|null,
 *   baseKind:string, available:boolean}}
 */
export function collectChangeEvidence(opts = {}) {
  const root = opts.root || process.cwd();
  const env = opts.env || {};
  const runGit = typeof opts.runGit === 'function' ? opts.runGit : defaultRunGit;

  const { range, base, kind } = resolveDiffBase(env, root, runGit);
  const nameOut = runGit(root, ['diff', '--name-only', ...range]);
  const diffOut = runGit(root, ['diff', '-U0', ...range]);

  if (nameOut === null && diffOut === null) {
    return {
      securityChangedFiles: [], changedPaths: [], diffBase: base,
      baseKind: kind, available: false,
    };
  }

  const changedPaths = (nameOut || '')
    .split('\n').map((s) => stripCr(s).trim()).filter(Boolean);

  return {
    securityChangedFiles: parseUnifiedDiff(diffOut || ''),
    changedPaths,
    diffBase: base,
    baseKind: kind,
    available: true,
  };
}
