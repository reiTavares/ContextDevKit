/**
 * Integration test — ADR-0054: dogfood-by-default + conflict-safe update.
 *
 * Drives the REAL installer against throwaway git projects to prove:
 *   A. a fresh install leaves ZERO kit files visible to git (info/exclude block);
 *   B. user-personalized kit files survive --update untouched (kept silently);
 *   C. a true 3-way conflict resolves to "both" without a TTY — the user's file
 *      stays, the kit's version is stashed under contextkit/.updates/;
 *   D. a resolved conflict does NOT re-conflict on the next --update;
 *   E. a legacy install (no manifest) refuses to clobber a modified kit file;
 *   F. a deleted kit file is restored by --update;
 *   G. --tracked skips the exclude block;
 *   H. an already-tracked install gets the untrack guidance, never an index touch.
 */
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KIT, run, git, reporter, readJson } from './it-helpers.mjs';
import { parseConflictChoice } from './install/sync.mjs';

const rep = reporter();
const read = (p) => readFileSync(p, 'utf-8');
const tmp = () => mkdtempSync(join(tmpdir(), 'contextkit-upd-'));
const kitVersion = readJson(join(KIT, 'package.json')).version;
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function freshInstall(proj, extra = []) {
  git(['init', '-b', 'main'], proj);
  git(['config', 'user.email', 'it@example.com'], proj);
  git(['config', 'user.name', 'IT'], proj);
  return run([join(KIT, 'install.mjs'), '--target', proj, '--level', '5', '--name', 'UpdApp', '--yes', ...extra]);
}
const update = (proj) => run([join(KIT, 'install.mjs'), '--target', proj, '--update']);

// ── A. fresh install is dogfooded: zero kit files visible to git ─────────────
// ── B. personalized files survive --update silently ─────────────────────────
// ── C/D. forced conflict → "both" without TTY → no re-conflict next time ────
(() => {
  const proj = tmp();
  try {
    const inst = freshInstall(proj);
    inst.status === 0 ? rep.ok('fresh install exits 0') : rep.bad(`install status ${inst.status}: ${inst.stderr}`);

    const excludePath = join(proj, '.git', 'info', 'exclude');
    existsSync(excludePath) && read(excludePath).includes('/contextkit/') && read(excludePath).includes('ADR-0054')
      ? rep.ok('info/exclude has the managed dogfood block')
      : rep.bad('info/exclude block missing');
    const visible = (git(['status', '--porcelain'], proj).stdout || '').split('\n').filter(Boolean);
    const leaked = visible.filter((l) => /contextkit\/|\.claude\/|CLAUDE\.md|\.agents\/|INSTRUCTIONS\.md|ctx\.mjs|\.codex\/|AGENTS\.md|cdx\.mjs|\.github\//.test(l));
    leaked.length === 0
      ? rep.ok(`no kit artifact visible to git (untracked lines: ${visible.length})`)
      : rep.bad(`kit artifacts leak into git status: ${leaked.join(' | ')}`);

    const manifestPath = join(proj, 'contextkit', '.install-manifest.json');
    const manifest = existsSync(manifestPath) ? readJson(manifestPath) : { files: {} };
    Object.keys(manifest.files).length > 50
      ? rep.ok(`manifest stamped (${Object.keys(manifest.files).length} files)`)
      : rep.bad('manifest missing or near-empty');

    // B — personalize one kit agent + create a custom one, then update.
    const agentPath = join(proj, '.claude', 'agents', 'security.md');
    writeFileSync(agentPath, 'MY TUNED SECURITY AGENT\n', 'utf-8');
    writeFileSync(join(proj, '.claude', 'agents', 'my-custom.md'), 'MY OWN AGENT\n', 'utf-8');
    const up1 = update(proj);
    up1.status === 0 ? rep.ok('--update exits 0') : rep.bad(`--update status ${up1.status}: ${up1.stderr}`);
    read(agentPath) === 'MY TUNED SECURITY AGENT\n'
      ? rep.ok('personalized kit agent survived --update (kit unchanged → kept silently)')
      : rep.bad('personalized agent was clobbered by --update');
    read(join(proj, '.claude', 'agents', 'my-custom.md')) === 'MY OWN AGENT\n'
      ? rep.ok('user-created agent untouched')
      : rep.bad('user-created agent was modified');
    /kept 1 personalized/.test(up1.stdout) ? rep.ok('report counts the kept personalization') : rep.bad('report missing the kept count');
    !existsSync(join(proj, 'contextkit', '.updates')) ? rep.ok('no conflict ⇒ no .updates stash') : rep.bad('.updates created without a conflict');

    // C — simulate "kit changed too": corrupt the baseline hash for that file.
    const tampered = readJson(manifestPath);
    tampered.files['.claude/agents/security.md'] = 'deadbeef-not-a-real-baseline';
    writeFileSync(manifestPath, JSON.stringify(tampered, null, 2), 'utf-8');
    const up2 = update(proj);
    read(agentPath) === 'MY TUNED SECURITY AGENT\n'
      ? rep.ok('conflict (no TTY) kept the user file')
      : rep.bad('conflict clobbered the user file');
    const stashPath = join(proj, 'contextkit', '.updates', `v${kitVersion}`, '.claude', 'agents', 'security.md');
    existsSync(stashPath) && read(stashPath).includes('security')
      ? rep.ok('kit version stashed under contextkit/.updates/')
      : rep.bad(`kit version not stashed at ${stashPath}`);
    /⚠️\s+conflict \.claude\/agents\/security\.md/.test(up2.stdout)
      ? rep.ok('conflict reported loudly')
      : rep.bad('conflict not reported');

    // D — next update must NOT re-conflict (baseline now stamped to the kit hash).
    const up3 = update(proj);
    !/⚠️\s+conflict/.test(up3.stdout) && read(agentPath) === 'MY TUNED SECURITY AGENT\n'
      ? rep.ok('resolved conflict does not re-conflict on the next update')
      : rep.bad('conflict re-fired or file changed on the next update');

    // F — a deleted kit command is restored by --update.
    const cmdPath = join(proj, '.claude', 'commands', 'debate.md');
    unlinkSync(cmdPath);
    update(proj);
    existsSync(cmdPath) ? rep.ok('deleted kit command restored by --update') : rep.bad('deleted kit command not restored');
  } finally { rmSync(proj, { recursive: true, force: true }); }
})();

// ── E. legacy install (no manifest): modified kit file ⇒ refuse to clobber ──
// -- E. contextkit/README.md refreshes when kit-owned, but local edits survive --
(() => {
  const proj = tmp();
  try {
    freshInstall(proj);
    const manifestPath = join(proj, 'contextkit', '.install-manifest.json');
    const readmePath = join(proj, 'contextkit', 'README.md');
    const oldReadme = '# Old ContextDevKit README\n';
    const manifest = readJson(manifestPath);
    manifest.files['contextkit/README.md'] = sha256(oldReadme);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    writeFileSync(readmePath, oldReadme, 'utf-8');
    const refreshed = update(proj);
    read(readmePath).includes('ContextDevKit platform')
      ? rep.ok('--update refreshes an unchanged old contextkit/README.md')
      : rep.bad('contextkit/README.md did not refresh from the kit template');
    /refreshed contextkit\/README\.md/.test(refreshed.stdout)
      ? rep.ok('README refresh is reported')
      : rep.bad('README refresh missing from installer report');

    const personalized = '# My local kit notes\n';
    writeFileSync(readmePath, personalized, 'utf-8');
    const kept = update(proj);
    read(readmePath) === personalized
      ? rep.ok('personalized contextkit/README.md survives --update')
      : rep.bad('personalized contextkit/README.md was clobbered');
    /kept personalized contextkit\/README\.md/.test(kept.stdout)
      ? rep.ok('personalized README keep is reported')
      : rep.bad('personalized README keep missing from installer report');
  } finally { rmSync(proj, { recursive: true, force: true }); }
})();

(() => {
  const proj = tmp();
  try {
    freshInstall(proj);
    const cmdPath = join(proj, '.claude', 'commands', 'advise.md');
    writeFileSync(cmdPath, 'MY TUNED COMMAND\n', 'utf-8');
    rmSync(join(proj, 'contextkit', '.install-manifest.json'), { force: true });
    const out = update(proj);
    read(cmdPath) === 'MY TUNED COMMAND\n'
      ? rep.ok('legacy (manifest-less) update kept the modified file')
      : rep.bad('legacy update clobbered the modified file');
    existsSync(join(proj, 'contextkit', '.updates', `v${kitVersion}`, '.claude', 'commands', 'advise.md'))
      ? rep.ok('legacy conflict stashed the kit version')
      : rep.bad('legacy conflict did not stash the kit version');
    /⚠️\s+conflict/.test(out.stdout) ? rep.ok('legacy conflict reported') : rep.bad('legacy conflict silent');
  } finally { rmSync(proj, { recursive: true, force: true }); }
})();

// ── G. --tracked opts out of the exclude block ───────────────────────────────
// ── H. already-tracked install → guidance only, index untouched ──────────────
(() => {
  const proj = tmp();
  try {
    const inst = freshInstall(proj, ['--tracked']);
    inst.status === 0 ? rep.ok('--tracked install exits 0') : rep.bad(`--tracked status ${inst.status}`);
    const excludePath = join(proj, '.git', 'info', 'exclude');
    !(existsSync(excludePath) && read(excludePath).includes('ADR-0054'))
      ? rep.ok('--tracked skipped the exclude block')
      : rep.bad('--tracked still wrote the exclude block');

    // Commit the kit, then update with the default posture: guidance, no index change.
    git(['add', '-A'], proj);
    git(['commit', '-m', 'chore: commit the kit'], proj);
    const trackedBefore = (git(['ls-files', 'contextkit'], proj).stdout || '').split('\n').filter(Boolean).length;
    const out = update(proj);
    /ALREADY tracked/.test(out.stdout) && /git rm -r --cached/.test(out.stdout)
      ? rep.ok('tracked install gets the opt-in untrack guidance')
      : rep.bad('untrack guidance missing for a tracked install');
    const trackedAfter = (git(['ls-files', 'contextkit'], proj).stdout || '').split('\n').filter(Boolean).length;
    trackedAfter === trackedBefore && trackedAfter > 0
      ? rep.ok(`index untouched (${trackedAfter} kit files still tracked)`)
      : rep.bad(`index changed: ${trackedBefore} → ${trackedAfter}`);
  } finally { rmSync(proj, { recursive: true, force: true }); }
})();

// ── I. parseConflictChoice: per-file picks + the "apply to all" suffix ───────
(() => {
  const cases = [
    ['b', 'b', false], ['', 'b', false], ['both', 'b', false],
    ['r', 'r', false], ['replace', 'r', false],
    ['k', 'k', false], ['keep', 'k', false],
    ['ba', 'b', true], ['ra', 'r', true], ['ka', 'k', true],
    ['r all', 'r', true], ['keepall', 'k', true], ['b!', 'b', true],
    ['  RA  ', 'r', true], ['all', 'b', true],
  ];
  const wrong = cases.filter(([input, choice, all]) => {
    const got = parseConflictChoice(input);
    return got.choice !== choice || got.all !== all;
  });
  wrong.length === 0
    ? rep.ok(`parseConflictChoice maps all ${cases.length} cases (base letter + 'all' suffix)`)
    : rep.bad(`parseConflictChoice mismatches: ${wrong.map(([i]) => JSON.stringify(i)).join(', ')}`);
})();

rep.finish('Integration (update safety, ADR-0054)');
