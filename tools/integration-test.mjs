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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    // Ancestor parity: /simulate-impact leaves a prediction trail file.
    existsSync(join(proj, 'vibekit', 'memory', 'predictions')) && readdirSync(join(proj, 'vibekit', 'memory', 'predictions')).some((f) => f.endsWith('.md'))
      ? ok('simulate-impact writes a prediction file (predictions/)')
      : bad('no prediction file written');

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
    existsSync(join(proj, '.claude', 'agents', 'infra-security.md')) ? ok('security-team infra-security agent installed') : bad('infra-security agent missing');

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

    // Ancestor parity: business-rules/ folder is scaffolded for domain-rule specs.
    existsSync(join(proj, 'vibekit', 'memory', 'business-rules', '_TEMPLATE.md')) ? ok('business-rules/ scaffolded (ancestor parity)') : bad('business-rules template missing');

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

    // DevPipeline ingest: analysis findings flow into the backlog, auto-prioritized.
    writeFileSync(join(proj, 'findings.json'), JSON.stringify({ findings: [
      { kind: 'line-budget', severity: 5, path: 'src/big.js', line: 400, message: 'too big' },
      { kind: 'todo-marker', severity: 1, path: 'src/x.js', line: 3, message: 'leftover TODO' },
    ] }));
    script('pipeline.mjs', 'ingest', 'findings.json', '--type', 'chore');
    const ingested = JSON.parse(script('pipeline.mjs', 'list', '--json').stdout || '[]')
      .filter((t) => /^line-budget|^todo-marker/.test(t.source || ''));
    ingested.length === 2 && ingested.some((t) => t.priority === 'P1') && ingested.some((t) => t.priority === 'P3')
      ? ok('pipeline ingest creates auto-prioritized tasks from findings') : bad(`ingest failed: ${JSON.stringify(ingested)}`);
    /Ingested 0 finding/.test(script('pipeline.mjs', 'ingest', 'findings.json', '--type', 'chore').stdout || '')
      ? ok('pipeline ingest is idempotent (no duplicates)') : bad('ingest re-added duplicates');
    const lb = ingested.find((t) => /^line-budget/.test(t.source));
    script('pipeline.mjs', 'prioritize', lb.id, 'P0');
    JSON.parse(script('pipeline.mjs', 'list', '--json').stdout || '[]').find((t) => t.id === lb.id)?.priority === 'P0'
      ? ok('pipeline prioritize overrides the auto priority (user-editable)') : bad('prioritize did not change priority');

    // WSJF (SAFe) → priority + bug severity (S1-S4) → priority + SLA due date.
    script('pipeline.mjs', 'add', '--type', 'feature', '--title', 'wsjf item', '--wsjf', '8,9,5,3');
    script('pipeline.mjs', 'add', '--type', 'bug', '--title', 'sev bug', '--severity', 'S1');
    const prio = JSON.parse(script('pipeline.mjs', 'list', '--json').stdout || '[]');
    const wsjfT = prio.find((t) => t.title === 'wsjf item');
    const sevT = prio.find((t) => t.title === 'sev bug');
    wsjfT?.priority === 'P1' && Number(wsjfT.wsjf) > 0 && sevT?.priority === 'P0' && sevT?.sla
      ? ok('pipeline WSJF→priority, bug severity→priority, SLA due date') : bad(`WSJF/severity failed: ${JSON.stringify({ wsjfT, sevT })}`);

    // Known-bugs map: bug tasks grouped + a map file generated.
    script('pipeline.mjs', 'bugs');
    existsSync(join(proj, 'vibekit', 'pipeline', 'known-bugs.md')) &&
      readFileSync(join(proj, 'vibekit', 'pipeline', 'known-bugs.md'), 'utf-8').includes('sev bug')
      ? ok('known-bugs map generated + groups bug tasks') : bad('known-bugs map missing/empty');

    // Deep analysis: aggregates the deterministic scanners into one report.
    const deep = JSON.parse(script('deep-analysis.mjs', '--json').stdout || '{}');
    deep.byScan && typeof deep.total === 'number' && Array.isArray(deep.findings)
      ? ok('deep-analysis aggregates scanners into one report') : bad(`deep-analysis failed: ${JSON.stringify(deep).slice(0, 120)}`);

    // Security mode: SessionStart reminds to /deep-analysis on the cadence (default-on, configurable).
    const secCfg = readJson(cfgPath);
    secCfg.securityMode = { active: true, everyNSessions: 1 };
    writeFileSync(cfgPath, JSON.stringify(secCfg, null, 2));
    writeFileSync(join(proj, 'vibekit', 'memory', 'sessions', '2026-01-01-01-x.md'), '# x');
    hook('session-start.mjs', { session_id: 'sec' }).includes('Security mode')
      ? ok('security-mode boot trigger fires on cadence') : bad('security-mode banner missing');
    secCfg.securityMode.active = false;
    writeFileSync(cfgPath, JSON.stringify(secCfg, null, 2));
    !hook('session-start.mjs', { session_id: 'sec' }).includes('Security mode')
      ? ok('security-mode disabled via config (active:false)') : bad('security-mode fired while disabled');

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

    // Dependency audit: flags no-lockfile + loose version ranges as findings.
    writeFileSync(join(proj, 'package.json'), JSON.stringify({ name: 'it', dependencies: { leftpad: '*' } }));
    const deps = JSON.parse(script('deps-audit.mjs', '--json').stdout || '{"findings":[]}').findings || [];
    deps.some((f) => f.kind === 'no-lockfile') && deps.some((f) => f.kind === 'loose-range')
      ? ok('deps-audit flags no-lockfile + loose ranges') : bad(`deps-audit findings: ${JSON.stringify(deps)}`);
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
