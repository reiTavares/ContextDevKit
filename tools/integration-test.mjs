#!/usr/bin/env node
/**
 * VibeDevKit integration test — exercises the REAL hooks end-to-end.
 *
 * Unlike `selfcheck.mjs` (static import smoke test), this installs the kit into
 * a throwaway temp project and drives the hooks through `child_process` with a
 * real stdin pipe — exactly how Claude Code invokes them. Cross-platform
 * (avoids PowerShell's broken string-to-stdin piping) and self-cleaning, so it
 * runs identically locally and in CI.
 *
 * Run:  node tools/integration-test.mjs   (exit 0 = healthy)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => {
  console.error(`  ✗ ${m}`);
  failures++;
};

const node = process.execPath;
const run = (args, opts = {}) => spawnSync(node, args, { encoding: 'utf-8', ...opts });
const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf-8' });

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf-8').replace(/^﻿/, ''));
}

async function main() {
  console.log('\n🌀 VibeDevKit integration test\n');
  const proj = mkdtempSync(join(tmpdir(), 'vibekit-it-'));
  try {
    git(['init', '-b', 'main'], proj);
    git(['config', 'user.email', 'it@example.com'], proj);
    git(['config', 'user.name', 'IT'], proj);

    // Install at Level 5.
    const inst = run([join(KIT, 'install.mjs'), '--target', proj, '--level', '5', '--name', 'IT App', '--yes']);
    inst.status === 0 ? ok('install at Level 5') : bad(`install failed (status ${inst.status}): ${inst.stderr}`);

    const hook = (name, payload) =>
      run([join(proj, 'vibekit', 'runtime', 'hooks', name)], { cwd: proj, input: JSON.stringify(payload) }).stdout || '';
    const script = (rel, ...a) => run([join(proj, 'vibekit', 'tools', 'scripts', rel), ...a], { cwd: proj });

    // L3 git hooks installed (pre-push conflict check).
    existsSync(join(proj, '.git', 'hooks', 'pre-push')) ? ok('pre-push git hook installed') : bad('pre-push hook missing');

    // First-run trigger.
    hook('session-start.mjs', {}).includes('First run')
      ? ok('SessionStart fires the first-run trigger')
      : bad('first-run banner missing');

    // Drift ledger + Stop block.
    hook('track-edits.mjs', { session_id: 'it', tool_name: 'Write', tool_input: { file_path: 'src/a.js' } });
    hook('track-edits.mjs', { session_id: 'it', tool_name: 'Write', tool_input: { file_path: 'src/b.js' } });
    existsSync(join(proj, '.claude', '.sessions', 'it.json')) ? ok('PostToolUse writes the ledger') : bad('ledger not written');
    hook('check-registration.mjs', { session_id: 'it' }).includes('"decision":"block"')
      ? ok('Stop blocks on drift')
      : bad('Stop did not block on drift');

    // L5 gate: block, then allow after a simulation record.
    const cfgPath = join(proj, 'vibekit', 'config.json');
    const cfg = readJson(cfgPath);
    cfg.l5.highRiskPaths = ['src/secure/'];
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    hook('simulate-gate.mjs', { session_id: 'it', tool_name: 'Write', tool_input: { file_path: 'src/secure/x.js' } }).includes('"decision":"block"')
      ? ok('L5 gate blocks an unsimulated high-risk edit')
      : bad('L5 gate did not block');
    script('mark-simulation.mjs', 'cover secure', 'src/secure/');
    hook('simulate-gate.mjs', { session_id: 'it', tool_name: 'Write', tool_input: { file_path: 'src/secure/x.js' } }).trim() === ''
      ? ok('L5 gate allows after /simulate-impact')
      : bad('L5 gate still blocked after simulation');

    // Concurrency guard (L3+): another session edited a file; a different session
    // about to edit the same file is warned (cross-session collision).
    hook('track-edits.mjs', { session_id: 'other', tool_name: 'Write', tool_input: { file_path: 'src/shared.js' } });
    hook('concurrency-guard.mjs', { session_id: 'me', tool_name: 'Write', tool_input: { file_path: 'src/shared.js' } }).includes('Concurrency')
      ? ok('concurrency-guard warns on cross-session collision')
      : bad('concurrency-guard did not warn');
    const l5settings = readJson(join(proj, '.claude', 'settings.json'));
    (l5settings.hooks?.PreToolUse || []).some((g) => (g.hooks || []).some((h) => h.command.includes('concurrency-guard')))
      ? ok('L5 wires the concurrency guard (PreToolUse)') : bad('concurrency-guard not wired at L5');

    // Safe --update: preserves CLAUDE.md, config (level + overrides), memory.
    writeFileSync(join(proj, 'CLAUDE.md'), readFileSync(join(proj, 'CLAUDE.md'), 'utf-8') + '\n## USER MARKER\n');
    run([join(KIT, 'install.mjs'), '--target', proj, '--update']);
    const afterCfg = readJson(join(proj, 'vibekit', 'config.json'));
    readFileSync(join(proj, 'CLAUDE.md'), 'utf-8').includes('USER MARKER') && afterCfg.level === 5 && !existsSync(join(proj, 'CLAUDE.vibedevkit.md'))
      ? ok('--update preserves CLAUDE.md + level (no data loss)')
      : bad('--update lost data (CLAUDE.md/level/side-file)');

    // setup-complete silences the trigger.
    script('setup-complete.mjs');
    !hook('session-start.mjs', {}).includes('First run')
      ? ok('first-run trigger silent after setup-complete')
      : bad('trigger still firing after setup-complete');

    // vibe-level down to L2 removes PreToolUse wiring.
    script('vibe-level.mjs', '2');
    const settings = readJson(join(proj, '.claude', 'settings.json'));
    !settings.hooks?.PreToolUse ? ok('vibe-level 2 removes the L5 PreToolUse hook') : bad('PreToolUse still wired at L2');
    settings.hooks?.SessionStart && settings.hooks?.Stop ? ok('vibe-level 2 keeps L1/L2 hooks') : bad('L1/L2 hooks lost');

    // GitHub templates + QA agents installed.
    existsSync(join(proj, '.github', 'PULL_REQUEST_TEMPLATE.md')) ? ok('GitHub PR template installed') : bad('PR template not installed');
    existsSync(join(proj, '.claude', 'agents', 'qa-orchestrator.md')) ? ok('QA squad agents installed (L5)') : bad('qa-orchestrator agent missing');
    existsSync(join(proj, 'vibekit', 'squads', 'README.md')) ? ok('squad manifest installed') : bad('squads/README.md missing');
    existsSync(join(proj, '.claude', 'agents', 'privacy-lgpd.md')) && existsSync(join(proj, '.claude', 'agents', 'ux-designer.md'))
      ? ok('compliance + design squads installed') : bad('new squad agents missing');

    // vibe-config show/set round-trip.
    script('vibe-config.mjs', 'set', 'qa.coverageTarget.lines', '90');
    const showOut = script('vibe-config.mjs', 'show', 'qa.coverageTarget.lines').stdout || '';
    showOut.trim() === '90' ? ok('vibe-config set/show round-trips') : bad(`vibe-config round-trip failed: ${showOut}`);

    // doctor runs and reports.
    const doc = script('doctor.mjs');
    /VibeDevKit doctor/i.test(doc.stdout || '') ? ok('doctor runs') : bad(`doctor failed: ${doc.stderr}`);

    // L5/L6 scanners run and produce JSON.
    const debt = script('tech-debt-scan.mjs', '--json');
    (() => { try { return Array.isArray(JSON.parse(debt.stdout).findings); } catch { return false; } })()
      ? ok('tech-debt-scan emits JSON findings') : bad(`tech-debt-scan failed: ${debt.stderr}`);
    const stats = script('stats.mjs', '--json');
    (() => { try { return typeof JSON.parse(stats.stdout).driftRatePct === 'number'; } catch { return false; } })()
      ? ok('stats emits JSON metrics') : bad(`stats failed: ${stats.stderr}`);

    // best-practices doc installed.
    existsSync(join(proj, 'vibekit', 'best-practices.md')) ? ok('best-practices.md installed') : bad('best-practices.md missing');

    // Roadmap seeded (undefined) + find reports it as not-defined.
    existsSync(join(proj, 'vibekit', 'memory', 'roadmap.md')) ? ok('roadmap.md installed') : bad('roadmap.md missing');
    const rm = script('roadmap.mjs', 'find', '--json');
    (() => { try { return JSON.parse(rm.stdout).canonicalDefined === false; } catch { return false; } })()
      ? ok('roadmap find reports undefined (seed placeholder)') : bad(`roadmap find failed: ${rm.stderr || rm.stdout}`);

    // Modular CLAUDE.md: two apps lacking CLAUDE.md → scaffold creates both.
    mkdirSync(join(proj, 'apps', 'api'), { recursive: true });
    mkdirSync(join(proj, 'apps', 'web'), { recursive: true });
    writeFileSync(join(proj, 'apps', 'api', 'package.json'), '{"name":"api"}');
    writeFileSync(join(proj, 'apps', 'web', 'package.json'), '{"name":"web"}');
    const cmFind = script('claude-md.mjs', 'find', '--json');
    (() => { try { return JSON.parse(cmFind.stdout).moduleRoots.length === 2; } catch { return false; } })()
      ? ok('claude-md detects 2 module roots') : bad(`claude-md find failed: ${cmFind.stdout || cmFind.stderr}`);
    script('claude-md.mjs', 'scaffold');
    existsSync(join(proj, 'apps', 'api', 'CLAUDE.md')) && existsSync(join(proj, 'apps', 'web', 'CLAUDE.md'))
      ? ok('claude-md scaffolds scoped CLAUDE.md per module') : bad('module CLAUDE.md not scaffolded');

    // Version control: git.mjs reports a repo with no remote (temp project has none).
    const gitStatus = script('git.mjs', 'status', '--json');
    (() => { try { const g = JSON.parse(gitStatus.stdout); return g.isRepo === true && g.remoteUrl === null; } catch { return false; } })()
      ? ok('git.mjs reports repo + missing remote') : bad(`git.mjs failed: ${gitStatus.stdout || gitStatus.stderr}`);

    // DevPipeline: add → move → sync reflects in devpipeline.md.
    script('pipeline.mjs', 'add', '--type', 'bug', '--priority', 'P1', '--title', 'login crash');
    const board1 = readFileSync(join(proj, 'vibekit', 'pipeline', 'devpipeline.md'), 'utf-8');
    board1.includes('login crash') && /Backlog \*\*1\*\*/.test(board1) ? ok('pipeline add → backlog on board') : bad('pipeline add not reflected');
    script('pipeline.mjs', 'move', '001', 'testing');
    const board2 = readFileSync(join(proj, 'vibekit', 'pipeline', 'devpipeline.md'), 'utf-8');
    /Testing \*\*1\*\*/.test(board2) ? ok('pipeline move → testing on board') : bad('pipeline move not reflected');

    // Security: a crafted base-branch arg must reach git LITERALLY (the whole
    // string is one invalid ref → non-zero exit), not be split by a shell. The
    // old execSync(string) path would run `git ... HEAD` (valid) THEN the injected
    // `echo`, exiting 0 — so a non-zero exit here proves no shell was involved.
    const wt = script('worktree-new.mjs', 'feat', 'HEAD; echo INJECTED_PWNED');
    wt.status !== 0
      ? ok('worktree-new passes the base-branch arg literally (no shell injection)')
      : bad('worktree-new shell injection NOT neutralized (a shell split the arg)');

    // tech-debt --ci gate: a clean project has no RED-zone finding → exits 0.
    const debtCi = script('tech-debt-scan.mjs', '--ci');
    debtCi.status === 0 && /CI gate/.test(debtCi.stdout || '')
      ? ok('tech-debt --ci gate passes on a clean project')
      : bad(`tech-debt --ci gate failed: ${debtCi.stdout || debtCi.stderr}`);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }

  console.log(failures === 0 ? '\n✅ Integration test passed.\n' : `\n❌ ${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('integration test crashed:', err);
  process.exit(1);
});
