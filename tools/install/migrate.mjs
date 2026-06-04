/**
 * Legacy-install migration: VibeDevKit (`vibekit/`) → ContextDevKit (`contextkit/`).
 *
 * Existing users installed the old `vibedevkit` package, which laid down a
 * `vibekit/` platform folder, `/vibe-*` slash commands, `vibekit/...` hook
 * wiring and `VibeDevKit` / `VIBE_*` references. After the rename, running
 * `npx contextdevkit --update` must carry that install FORWARD — without data
 * loss and without leaving two installs side by side.
 *
 * Strategy (idempotent, refuse-on-ambiguity — constitution rule 8):
 *   1. detect a legacy `vibekit/` with no `contextkit/`;
 *   2. MOVE the folder (atomic rename → preserves memory / config / pipeline / .env);
 *   3. rewrite the rename tokens in the control files (settings.json, .gitignore,
 *      .gitattributes, git hooks, contextkit/.env, CLAUDE.md — the last two backed
 *      up to `*.bak` first, as they hold user content);
 *   4. delete the stale `/vibe-*` + `setupvibedevkit` command files.
 * The normal installer flow then refreshes the engine into `contextkit/`.
 *
 * Zero third-party deps (runs via `npx` on a bare machine). Rule 2: it never
 * throws into the installer — all I/O is defensive; a failure degrades to a
 * warning and leaves the project untouched.
 */
import { rename, cp, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const LEGACY_DIR = 'vibekit';
const NEW_DIR = 'contextkit';

// Order matters: longest / most-specific tokens first so no rule eats another.
const TOKENS = [
  ['VibeDevKit', 'ContextDevKit'],
  ['VIBEDEVKIT', 'CONTEXTDEVKIT'],
  ['vibedevkit', 'contextdevkit'],
  ['vibekit', 'contextkit'],
  ['VIBE_', 'CONTEXT_'],
  ['vibe-', 'context-'],
];

/** Control files whose kit-managed content carries old tokens. `backup` files hold user content. */
const CONTROL = [
  { rel: '.claude/settings.json', backup: false },
  { rel: '.gitignore', backup: false },
  { rel: '.gitattributes', backup: false },
  { rel: 'CLAUDE.md', backup: true },
  { rel: join(NEW_DIR, '.env'), backup: true }, // after the move
];
const GIT_HOOKS = ['pre-commit', 'commit-msg', 'pre-push'];
const STALE_COMMANDS = [
  '.claude/commands/vibe-stats.md',
  '.claude/commands/setup/vibe-config.md',
  '.claude/commands/setup/vibe-doctor.md',
  '.claude/commands/setup/vibe-level.md',
  '.claude/commands/setup/setupvibedevkit.md',
];

function rewriteTokens(text) {
  let out = text;
  for (const [from, to] of TOKENS) out = out.split(from).join(to);
  return out;
}

/**
 * Detects whether `target` holds a legacy install and whether the new folder
 * already exists. A legacy install is a `vibekit/` with a config or runtime.
 */
export function detectLegacy(target) {
  const legacy = join(target, LEGACY_DIR);
  const isLegacy = existsSync(legacy) && (existsSync(join(legacy, 'config.json')) || existsSync(join(legacy, 'runtime')));
  return { isLegacy, hasNew: existsSync(join(target, NEW_DIR)) };
}

async function rewriteFile(path, { backup, dryRun }) {
  if (!existsSync(path)) return false;
  let text;
  try {
    text = await readFile(path, 'utf-8');
  } catch {
    return false;
  }
  const next = rewriteTokens(text);
  if (next === text) return false;
  if (dryRun) return true;
  if (backup && !existsSync(`${path}.bak`)) await writeFile(`${path}.bak`, text, 'utf-8').catch(() => {});
  await writeFile(path, next, 'utf-8').catch(() => {});
  return true;
}

async function moveFolder(from, to) {
  try {
    await rename(from, to);
  } catch (err) {
    if (err && err.code === 'EXDEV') {
      // Cross-device (e.g. target on another volume): copy then remove.
      await cp(from, to, { recursive: true, force: true });
      await rm(from, { recursive: true, force: true });
      return;
    }
    throw err;
  }
}

/**
 * Runs the legacy → new migration on `target`. No-ops cleanly when there is
 * nothing to migrate. NEVER throws — returns `{ migrated, report }`.
 *
 * @param {string} target project root
 * @param {{ dryRun?: boolean }} [opts] `dryRun` reports without writing
 * @returns {Promise<{ migrated: boolean, report: string[] }>}
 */
export async function migrateLegacy(target, opts = {}) {
  const dryRun = !!opts.dryRun;
  const report = [];
  let det;
  try {
    det = detectLegacy(target);
  } catch {
    return { migrated: false, report };
  }
  if (!det.isLegacy) return { migrated: false, report };

  if (det.hasNew) {
    report.push('⚠️  found BOTH vibekit/ (legacy) and contextkit/ — not merging automatically.');
    report.push('    Your old data is in vibekit/. Move what you need into contextkit/, then delete vibekit/.');
    return { migrated: false, report };
  }

  const tag = dryRun ? '[dry-run] would' : '✓';
  report.push(dryRun ? '🔎 legacy VibeDevKit install detected (dry-run — no changes):' : '🔄 migrating legacy VibeDevKit install → ContextDevKit…');

  // 1) move the folder — carries ALL user data (memory, config, pipeline, .env) forward.
  if (!dryRun) {
    try {
      await moveFolder(join(target, LEGACY_DIR), join(target, NEW_DIR));
    } catch (err) {
      report.push(`⚠️  could not move vibekit/ → contextkit/ (${err?.code || err}); migration aborted, nothing changed.`);
      return { migrated: false, report };
    }
  }
  report.push(`  ${tag} vibekit/ → contextkit/ (memory, config, pipeline, .env preserved)`);

  // 2) rewrite the control files (CLAUDE.md + .env are backed up to *.bak first).
  for (const { rel, backup } of CONTROL) {
    if (await rewriteFile(join(target, rel), { backup, dryRun })) report.push(`  ${tag} updated ${rel}${backup ? ' (backup *.bak)' : ''}`);
  }

  // 3) git-hook wrappers (best-effort; the installer re-installs them properly afterwards).
  for (const hook of GIT_HOOKS) {
    if (await rewriteFile(join(target, '.git', 'hooks', hook), { backup: false, dryRun })) report.push(`  ${tag} rewired .git/hooks/${hook}`);
  }

  // 4) delete the stale /vibe-* + setupvibedevkit command files (new ones reinstalled by the flow).
  for (const rel of STALE_COMMANDS) {
    const path = join(target, rel);
    if (!existsSync(path)) continue;
    if (!dryRun) await rm(path, { force: true }).catch(() => {});
    report.push(`  ${tag} removed stale ${rel}`);
  }

  report.push(dryRun ? '🔎 dry-run complete — re-run without --dry-run to apply.' : '✅ migration complete — continuing with the engine refresh…');
  return { migrated: !dryRun, report };
}
