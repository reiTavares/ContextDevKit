/**
 * Boot signals — environment detectors for the SessionStart banner.
 *
 * Pure-ish read-only helpers split out of `session-start.mjs` to keep that hook
 * under the line budget: git divergence/branch, other active branches, project
 * name, greenfield detection, and the config-driven cadence triggers
 * (security-mode, predictions-review). All best-effort and silent on error —
 * a signal never blocks a session. Zero third-party deps.
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { loadConfigSync } from '../config/load.mjs';
import { pathsFor } from '../config/paths.mjs';

export function checkGitDivergence(root) {
  try {
    execSync('git fetch origin --quiet', { cwd: root, stdio: 'ignore', timeout: 5000 });
  } catch {
    return null;
  }
  try {
    const counts = execSync('git rev-list --left-right --count HEAD...@{u}', { cwd: root, encoding: 'utf-8', timeout: 3000 }).trim();
    const [a, b] = counts.split(/\s+/);
    return { ahead: Number.parseInt(a ?? '0', 10), behind: Number.parseInt(b ?? '0', 10) };
  } catch {
    return null;
  }
}

export function getBranch(root) {
  try {
    return execSync('git symbolic-ref --short HEAD', { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'detached';
  }
}

/**
 * Cross-machine + same-machine awareness (L3): recent OTHER branches — local
 * worktrees and remote feature branches — with author + age, so parallel work
 * (other devs/agents) is visible at boot. Read-only, best effort.
 */
export function activeBranches(root, currentBranch) {
  const lines = [];
  try {
    const worktrees = execSync('git worktree list --porcelain', { cwd: root, encoding: 'utf-8', timeout: 3000 })
      .split('\n')
      .filter((l) => l.startsWith('branch '))
      .map((l) => l.replace('branch refs/heads/', '').trim())
      .filter((b) => b && b !== currentBranch);
    for (const b of [...new Set(worktrees)].slice(0, 5)) lines.push(`- 🌳 local worktree on \`${b}\``);
  } catch {
    /* not a worktree setup */
  }
  try {
    const remote = execSync(
      `git for-each-ref --sort=-committerdate --count=20 --format="%(refname:short)|%(committerdate:relative)|%(authorname)" refs/remotes`,
      { cwd: root, encoding: 'utf-8', timeout: 3000 },
    )
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.split('|'))
      .filter(([ref]) => ref && !/\/(main|master|HEAD)$/.test(ref) && !ref.endsWith(`/${currentBranch}`))
      .filter(([, rel]) => !/(month|year)/.test(rel || ''))
      .slice(0, 5);
    for (const [ref, rel, author] of remote) lines.push(`- ☁️  \`${ref}\` — ${rel} by ${author}`);
  } catch {
    /* no remote */
  }
  return lines.length ? lines.join('\n') : null;
}

/** True when the project has no source code yet (routes first-run to /aidevtool-from0). */
export function isGreenfield(root) {
  return !['src', 'app', 'apps', 'packages', 'lib', 'components', 'pages', 'server', 'cmd', 'internal'].some((d) => existsSync(resolve(root, d)));
}

export async function projectName(root) {
  try {
    const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf-8'));
    if (typeof pkg?.name === 'string' && pkg.name) return pkg.name;
  } catch {
    /* no package.json */
  }
  return basename(root);
}

/** Counts registered session files. Shared by the cadence triggers. */
function sessionCount(root) {
  try {
    return readdirSync(pathsFor(root).sessions).filter((f) => f.endsWith('.md')).length;
  } catch {
    return 0;
  }
}

/**
 * ADR-0033 — cross-session engine-update signal. The installer (`--update`) stamps
 * `contextkit/.engine-version`; this compares it to a hook-side "seen" marker and
 * announces the bump ONCE on the next session (a SessionStart hook can't detect a
 * mid-session update, so the honest signal is cross-session). First observation is
 * set silently to avoid a banner on a fresh install. Returns a line or null.
 */
export function engineUpdateSignal(root) {
  try {
    const verPath = resolve(pathsFor(root).platform, '.engine-version');
    if (!existsSync(verPath)) return null;
    const current = readFileSync(verPath, 'utf-8').trim();
    if (!current) return null;
    const seenPath = resolve(pathsFor(root).ledgerDir, '.engine-seen');
    let seen = '';
    try {
      seen = readFileSync(seenPath, 'utf-8').trim();
    } catch {
      /* never seen */
    }
    if (seen === current) return null;
    try {
      writeFileSync(seenPath, current);
    } catch {
      return null; // can't persist → don't risk re-announcing every boot
    }
    return seen ? `🔄 ContextDevKit engine updated to **v${current}** since your last session — new commands/hooks are active (restart Claude Code if a command seems missing).` : null;
  } catch {
    return null;
  }
}

/**
 * ADR-0033 — weekly local value line (config-gated via `boot.valueLine`, default on;
 * local-only, no PII). Reflects the kit's accrued value back so the dev can see it.
 * Debounced to once per 7 days via a marker in the ledger dir. Returns a line or null.
 */
export function valueLine(root) {
  try {
    if (loadConfigSync(root)?.boot?.valueLine === false) return null;
    const markerPath = resolve(pathsFor(root).ledgerDir, '.value-nudge');
    let last = 0;
    try {
      last = Number.parseInt(readFileSync(markerPath, 'utf-8').trim(), 10) || 0;
    } catch {
      /* no prior */
    }
    if (Date.now() - last < 7 * 24 * 60 * 60 * 1000) return null;
    const sessions = sessionCount(root);
    let adrs = 0;
    try {
      adrs = readdirSync(pathsFor(root).decisions).filter((f) => /^\d{4}-.+\.md$/.test(f) && f !== '0000-record-architecture-decisions.md').length;
    } catch {
      /* no decisions dir */
    }
    if (sessions === 0 && adrs === 0) return null;
    try {
      writeFileSync(markerPath, String(Date.now()));
    } catch {
      return null;
    }
    return `📈 ContextDevKit here: **${sessions}** session(s) logged · **${adrs}** ADR(s) recorded — the kit is keeping this project's memory.`;
  } catch {
    return null;
  }
}

/**
 * ADR-0034 — open bugs awaiting resolution in backlog/working. Surfaces them at
 * boot so a pending bug isn't buried under new feature work. Returns
 * `{ total, p0, p1 }` or null when there are none. Best-effort, silent on error.
 */
export function openBugsDue(root) {
  try {
    const pipe = pathsFor(root).pipeline;
    let total = 0;
    let p0 = 0;
    let p1 = 0;
    for (const stage of ['backlog', 'working']) {
      let files = [];
      try {
        files = readdirSync(resolve(pipe, stage));
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.endsWith('.md')) continue;
        let text = '';
        try {
          text = readFileSync(resolve(pipe, stage, f), 'utf-8');
        } catch {
          continue;
        }
        if (!/^type:\s*bug\s*$/m.test(text)) continue;
        total += 1;
        if (/^priority:\s*P0\b/m.test(text)) p0 += 1;
        else if (/^priority:\s*P1\b/m.test(text)) p1 += 1;
      }
    }
    return total > 0 ? { total, p0, p1 } : null;
  } catch {
    return null;
  }
}

/** Source extensions the map counts — kept in sync with project-map-core's EXT_LANG. */
const MAP_SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.py', '.go', '.rs', '.java', '.kt', '.rb', '.php', '.cs', '.sql']);

/** Bounded files+bytes walk over a module dir (caps total stats to stay cheap). */
function filesAndBytesUnder(absDir, budget) {
  let files = 0;
  let bytes = 0;
  let entries = [];
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return { files, bytes };
  }
  for (const e of entries) {
    if (budget.n <= 0) break;
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const full = resolve(absDir, e.name);
    if (e.isDirectory()) {
      const r = filesAndBytesUnder(full, budget);
      files += r.files;
      bytes += r.bytes;
    } else {
      const dot = e.name.lastIndexOf('.');
      if (dot < 0 || !MAP_SOURCE_EXTS.has(e.name.slice(dot).toLowerCase())) continue;
      budget.n -= 1;
      files += 1;
      try {
        bytes += statSync(full).size;
      } catch {
        /* ignore */
      }
    }
  }
  return { files, bytes };
}

/**
 * project-map staleness — nudge when the committed structural map no longer
 * matches the tree. Compares each mapped module's saved `{files, bytes}` against
 * a BOUNDED (cap 400 stats) recompute. Structural, not mtime-based: it survives
 * a clone (which resets mtimes) and never churns. Stops once the budget is spent
 * so a truncated module is never falsely flagged (refuse-to-false-positive, rule
 * 8). Returns a line or null. Silent when no map exists or on error. Self-contained.
 */
export function projectMapStale(root) {
  try {
    const dir = pathsFor(root).projectMap;
    const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf-8'));
    if (!Array.isArray(manifest.modules) || manifest.modules.length === 0) return null;
    const budget = { n: 400 };
    for (const mod of manifest.modules) {
      if (budget.n <= 0) break;
      const cur = filesAndBytesUnder(resolve(root, String(mod.path)), budget);
      // Budget exhausted during this module → its count may be truncated; don't trust it.
      if (budget.n <= 0) break;
      if (cur.files !== Number(mod.files) || cur.bytes !== Number(mod.bytes)) {
        return '🗺️  Project map is **stale** — source changed since it was generated. Run `/project-map` to refresh it (or `/project-map --check` to diff).';
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Security mode (config): returns the cadence N when a /deep-analysis is due, else 0. */
export function securityModeDue(root) {
  const cfg = loadConfigSync(root)?.securityMode;
  if (!cfg || cfg.active !== true) return 0;
  const everyN = Number(cfg.everyNSessions) > 0 ? Number(cfg.everyNSessions) : 10;
  const n = sessionCount(root);
  return n > 0 && n % everyN === 0 ? everyN : 0;
}

/**
 * Predictions-review cadence (config): returns N when a review is due — an
 * every-N-sessions tick AND at least one `/simulate-impact` prediction is still
 * unreviewed (`fill on review` stub). Zero noise when there's nothing to review.
 */
export function predictionsReviewDue(root) {
  const cfg = loadConfigSync(root)?.predictionsReview;
  if (!cfg || cfg.active !== true) return 0;
  const everyN = Number(cfg.everyNSessions) > 0 ? Number(cfg.everyNSessions) : 10;
  const n = sessionCount(root);
  if (n === 0 || n % everyN !== 0) return 0;
  try {
    const dir = pathsFor(root).predictions;
    const unreviewed = readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .some((f) => {
        try {
          return readFileSync(resolve(dir, f), 'utf-8').includes('fill on review');
        } catch {
          return false;
        }
      });
    return unreviewed ? everyN : 0;
  } catch {
    return 0;
  }
}
