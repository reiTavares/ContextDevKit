/**
 * Integration test — legacy `vibekit/` → `contextkit/` migration (the rename).
 *
 * Scaffolds a throwaway project that looks like an OLD `vibedevkit` install,
 * then drives the real installer to prove the migration:
 *   - `--migrate --dry-run` changes nothing;
 *   - `--migrate` moves the folder (preserving user memory/config/.env), rewrites
 *     settings.json / CLAUDE.md / .gitignore / git hooks, backs up user files,
 *     and deletes the stale /vibe-* commands;
 *   - `--update` auto-migrates end-to-end and refreshes the engine (no dup hooks);
 *   - BOTH folders present → refuse (no changes);
 *   - re-running on a migrated project is a no-op.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KIT, node, run, git, reporter } from './it-helpers.mjs';
import { missingAfterCopy } from './install/migrate.mjs';

const rep = reporter();
const read = (p) => readFileSync(p, 'utf-8');
const tmp = () => mkdtempSync(join(tmpdir(), 'contextkit-mig-'));

/** Scaffolds a project that looks like a legacy VibeDevKit install. */
function makeLegacy(proj, { withGit = false } = {}) {
  if (withGit) {
    git(['init', '-b', 'main'], proj);
    git(['config', 'user.email', 'it@example.com'], proj);
    git(['config', 'user.name', 'IT'], proj);
  }
  const w = (rel, body) => {
    const p = join(proj, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, body, 'utf-8');
  };
  w('vibekit/config.json', JSON.stringify({ level: 5, setup: { completed: true }, ledger: {} }, null, 2));
  w('vibekit/runtime/hooks/session-start.mjs', '// legacy dummy engine\n');
  // Several ADRs with different numbers — the migration must carry ALL of them,
  // never "some but not all" (the reported data-loss symptom).
  w('vibekit/memory/decisions/0001-user-decision.md', '# 0001 — a precious user ADR\nkeep me\n');
  w('vibekit/memory/decisions/0002-second-decision.md', '# 0002 — second ADR\nkeep me too\n');
  w('vibekit/memory/decisions/0017-seventeenth-decision.md', '# 0017 — a later ADR\nalso precious\n');
  w('vibekit/.env', 'GOOGLE_AI_API_KEY=secret\nVIBE_GIT_TIMEOUT_MS=5000\n');
  w('.claude/settings.json', JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node vibekit/runtime/hooks/session-start.mjs' }] }] } },
    null, 2));
  w('.claude/commands/setup/vibe-level.md', 'old vibe-level command\n');
  w('.claude/commands/vibe-stats.md', 'old vibe-stats command\n');
  w('CLAUDE.md', 'This project uses VibeDevKit. Engine in vibekit/runtime. Run /vibe-level to change level.\n');
  w('.gitignore', '# VibeDevKit — local runtime state (do not commit)\nvibekit/memory/tech-debt-findings.json\n');
}

// ── Scenario A: dry-run changes nothing ──────────────────────────────────────
(() => {
  const proj = tmp();
  try {
    makeLegacy(proj);
    const out = run([join(KIT, 'install.mjs'), '--target', proj, '--migrate', '--dry-run']);
    out.status === 0 ? rep.ok('--migrate --dry-run exits 0') : rep.bad(`dry-run status ${out.status}: ${out.stderr}`);
    existsSync(join(proj, 'vibekit')) && !existsSync(join(proj, 'contextkit'))
      ? rep.ok('dry-run left vibekit/ in place and created no contextkit/')
      : rep.bad('dry-run mutated the filesystem');
    read(join(proj, 'CLAUDE.md')).includes('vibekit/') ? rep.ok('dry-run left CLAUDE.md untouched') : rep.bad('dry-run rewrote CLAUDE.md');
    /dry-run/i.test(out.stdout) ? rep.ok('dry-run output flags itself') : rep.bad('dry-run output missing the marker');
  } finally { rmSync(proj, { recursive: true, force: true }); }
})();

// ── Scenario B: real migration preserves data + rewrites references ──────────
(() => {
  const proj = tmp();
  try {
    makeLegacy(proj);
    const out = run([join(KIT, 'install.mjs'), '--target', proj, '--migrate']);
    out.status === 0 ? rep.ok('--migrate exits 0') : rep.bad(`--migrate status ${out.status}: ${out.stderr}`);

    !existsSync(join(proj, 'vibekit')) ? rep.ok('vibekit/ is gone') : rep.bad('vibekit/ still present');
    existsSync(join(proj, 'contextkit')) ? rep.ok('contextkit/ exists') : rep.bad('contextkit/ missing');

    // user data preserved — EVERY ADR, not just the first (regression guard for
    // the cross-device partial-copy data loss).
    const decDir = join(proj, 'contextkit', 'memory', 'decisions');
    const adrsSurvive = [
      ['0001-user-decision.md', 'precious user ADR'],
      ['0002-second-decision.md', 'second ADR'],
      ['0017-seventeenth-decision.md', 'a later ADR'],
    ].every(([file, marker]) => existsSync(join(decDir, file)) && read(join(decDir, file)).includes(marker));
    adrsSurvive ? rep.ok('ALL user ADRs preserved through the move (0001, 0002, 0017)') : rep.bad('an ADR was lost in the migration');
    try {
      JSON.parse(read(join(proj, 'contextkit', 'config.json'))).level === 5 ? rep.ok('config level 5 preserved') : rep.bad('config level changed');
    } catch { rep.bad('config.json unreadable after migration'); }

    // .env migrated + backed up
    const env = read(join(proj, 'contextkit', '.env'));
    env.includes('CONTEXT_GIT_TIMEOUT_MS') && !env.includes('VIBE_') ? rep.ok('.env VIBE_* → CONTEXT_*') : rep.bad('.env env-var not migrated');
    existsSync(join(proj, 'contextkit', '.env.bak')) ? rep.ok('.env backed up to .env.bak') : rep.bad('.env.bak missing');

    // settings.json rewired (no legacy paths, no duplicate)
    const settings = read(join(proj, '.claude', 'settings.json'));
    !settings.includes('vibekit/') && settings.includes('contextkit/runtime/hooks') ? rep.ok('settings.json rewired to contextkit/') : rep.bad('settings.json still references vibekit/');

    // CLAUDE.md rewritten + backed up
    const claude = read(join(proj, 'CLAUDE.md'));
    !claude.includes('vibekit/') && claude.includes('contextkit/') && claude.includes('/context-level') && claude.includes('ContextDevKit')
      ? rep.ok('CLAUDE.md references rewritten') : rep.bad('CLAUDE.md not fully rewritten');
    existsSync(join(proj, 'CLAUDE.md.bak')) && read(join(proj, 'CLAUDE.md.bak')).includes('VibeDevKit')
      ? rep.ok('CLAUDE.md backed up to .bak') : rep.bad('CLAUDE.md.bak missing/wrong');

    // stale commands removed
    !existsSync(join(proj, '.claude', 'commands', 'setup', 'vibe-level.md')) && !existsSync(join(proj, '.claude', 'commands', 'vibe-stats.md'))
      ? rep.ok('stale /vibe-* command files removed') : rep.bad('stale command files left behind');

    // .gitignore de-duplicated (now ContextDevKit)
    read(join(proj, '.gitignore')).includes('ContextDevKit') ? rep.ok('.gitignore block rewritten') : rep.bad('.gitignore not migrated');

    // idempotent: second run is a clean no-op
    const again = run([join(KIT, 'install.mjs'), '--target', proj, '--migrate']);
    again.status === 0 && /nothing to migrate/i.test(again.stdout) ? rep.ok('re-running --migrate is a no-op') : rep.bad('second --migrate was not a clean no-op');
  } finally { rmSync(proj, { recursive: true, force: true }); }
})();

// ── Scenario C: BOTH folders present → refuse, change nothing ────────────────
(() => {
  const proj = tmp();
  try {
    makeLegacy(proj);
    mkdirSync(join(proj, 'contextkit'), { recursive: true });
    writeFileSync(join(proj, 'contextkit', 'config.json'), JSON.stringify({ level: 3 }), 'utf-8');
    const out = run([join(KIT, 'install.mjs'), '--target', proj, '--migrate']);
    out.status === 0 ? rep.ok('refuse-both exits 0') : rep.bad(`refuse-both status ${out.status}`);
    /BOTH/i.test(out.stdout) ? rep.ok('warns about BOTH installs') : rep.bad('no BOTH warning');
    existsSync(join(proj, 'vibekit')) ? rep.ok('refuse-both left vibekit/ untouched') : rep.bad('refuse-both deleted vibekit/');
  } finally { rmSync(proj, { recursive: true, force: true }); }
})();

// ── Scenario D: --update auto-migrates AND refreshes the real engine ─────────
(() => {
  const proj = tmp();
  try {
    makeLegacy(proj, { withGit: true });
    const out = run([join(KIT, 'install.mjs'), '--target', proj, '--update']);
    out.status === 0 ? rep.ok('--update on a legacy install exits 0') : rep.bad(`--update status ${out.status}: ${out.stderr}`);
    !existsSync(join(proj, 'vibekit')) ? rep.ok('--update migrated away vibekit/') : rep.bad('--update left vibekit/');
    // real engine refreshed (the dummy 1-line hook is replaced by the actual script)
    const hook = join(proj, 'contextkit', 'runtime', 'hooks', 'session-start.mjs');
    existsSync(hook) && read(hook).length > 200 ? rep.ok('--update refreshed the real engine') : rep.bad('engine not refreshed');
    // no duplicate hooks: exactly one SessionStart group, referencing contextkit/
    const s = JSON.parse(read(join(proj, '.claude', 'settings.json')));
    const ss = s.hooks?.SessionStart || [];
    ss.length === 1 && !JSON.stringify(s).includes('vibekit/') ? rep.ok('no duplicate hooks after --update') : rep.bad(`duplicate/legacy hooks remain (SessionStart groups: ${ss.length})`);
  } finally { rmSync(proj, { recursive: true, force: true }); }
})();

// ── Scenario E: fresh install is unaffected (no legacy → no-op) ──────────────
(() => {
  const proj = tmp();
  try {
    const out = run([join(KIT, 'install.mjs'), '--target', proj, '--migrate']);
    out.status === 0 && /nothing to migrate/i.test(out.stdout) ? rep.ok('no-legacy --migrate is a clean no-op') : rep.bad('no-legacy --migrate misbehaved');
  } finally { rmSync(proj, { recursive: true, force: true }); }
})();

// ── Scenario F: the cross-device data-loss guard detects a partial copy ──────
// moveFolder's EXDEV fallback must VERIFY every source file landed before it
// removes the source. We can't force a real EXDEV in CI, so we test the guard
// (`missingAfterCopy`) directly: a destination missing a file is reported, which
// is what makes moveFolder throw-and-preserve instead of rm-ing the source.
(() => {
  const proj = tmp();
  try {
    const from = join(proj, 'src');
    const to = join(proj, 'dst');
    for (const rel of ['memory/decisions/0001-a.md', 'memory/decisions/0002-b.md', 'config.json']) {
      const p = join(from, rel);
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, `# ${rel}\n`, 'utf-8');
    }
    // Simulate a PARTIAL copy: everything but 0002-b.md landed.
    for (const rel of ['memory/decisions/0001-a.md', 'config.json']) {
      const p = join(to, rel);
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, `# ${rel}\n`, 'utf-8');
    }
    const missing = missingAfterCopy(from, to);
    missing.length === 1 && missing[0].replace(/\\/g, '/') === 'memory/decisions/0002-b.md'
      ? rep.ok('partial-copy guard flags the file that did not land (source would be preserved)')
      : rep.bad(`partial-copy guard wrong: ${JSON.stringify(missing)}`);
    // A complete copy reports nothing missing → the rm is allowed.
    const p = join(to, 'memory/decisions/0002-b.md');
    writeFileSync(p, '# memory/decisions/0002-b.md\n', 'utf-8');
    missingAfterCopy(from, to).length === 0
      ? rep.ok('complete copy reports nothing missing (rm allowed)')
      : rep.bad('guard false-positive on a complete copy');
  } finally { rmSync(proj, { recursive: true, force: true }); }
})();

rep.finish('Integration (migration)');
