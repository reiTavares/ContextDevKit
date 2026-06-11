#!/usr/bin/env node
/**
 * ContextDevKit integration test — Antigravity host (ctx.mjs runner + session lifecycle).
 *
 * Installs the kit into a throwaway temp project and drives the `ctx.mjs` CLI
 * runner exactly as an Antigravity agent would (`node ctx.mjs <command>`).
 * Covers the dispatch contract (exact/alias only, did-you-mean on a miss),
 * the path-confinement guard, and the explicit governance checkpoints that
 * replace Claude Code hooks on this host. Shared harness: `it-helpers.mjs`.
 *
 * Run:  node tools/integration-test-antigravity.mjs   (exit 0 = healthy)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { run, reporter, installFixture } from './it-helpers.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\n🌀 ContextDevKit integration test — Antigravity host\n');
const fx = installFixture(rep);
const { proj } = fx;

/** Runs `node ctx.mjs ...args` inside the fixture project. */
const ctx = (...args) => run([join(proj, 'ctx.mjs'), ...args], { cwd: proj });

try {
  // ── ADR-0048: install lands in the agy-native dir, legacy tree gone ──
  existsSync(join(proj, '.agents', 'agents')) && existsSync(join(proj, '.agents', 'skills')) &&
    existsSync(join(proj, 'ctx.mjs')) && existsSync(join(proj, 'INSTRUCTIONS.md'))
    ? ok('Antigravity assets installed (.agents/{agents,skills} + ctx.mjs + INSTRUCTIONS.md)')
    : bad('Antigravity assets not installed by the installer');
  !existsSync(join(proj, '.antigravity'))
    ? ok('no legacy .antigravity/ tree created (ADR-0048)')
    : bad('installer still creates the legacy .antigravity/ tree');
  existsSync(join(proj, '.agents', 'README.md')) &&
    readFileSync(join(proj, '.agents', 'README.md'), 'utf-8').includes('Host-coexistence')
    ? ok('.agents/README.md ships the host-coexistence note')
    : bad('.agents/README.md missing or lacks the coexistence note');

  // ── dispatch contract (ticket 089) ──
  const exact = ctx('doctor');
  exact.status === 0 && /doctor|ContextDevKit/i.test(exact.stdout + exact.stderr)
    ? ok('ctx.mjs dispatches an exact script name (doctor)')
    : bad(`exact dispatch failed (status ${exact.status})`);

  const alias = ctx('tech-debt', '--ci');
  alias.status === 0 || /tech-debt/i.test(alias.stdout + alias.stderr)
    ? ok('ctx.mjs dispatches a declared alias (tech-debt → tech-debt-scan)')
    : bad(`alias dispatch failed (status ${alias.status}): ${alias.stderr}`);

  // A bare prefix must NOT silently run the wrong script (ticket 089).
  const prefix = ctx('tech');
  prefix.status !== 0 && !/tech-debt-scan ran/i.test(prefix.stdout)
    ? ok('ctx.mjs refuses a bare prefix instead of guessing (089)')
    : bad('ctx.mjs silently dispatched a prefix match');

  // Pure prompt command should be found in .agents/skills/ when .claude/ is absent (ADR-0048, ticket 085)
  const claudeDir = join(proj, '.claude');
  if (existsSync(claudeDir)) {
    rmSync(claudeDir, { recursive: true, force: true });
  }
  const purePrompt = ctx('bug-hunt', 'weird memory leak');
  purePrompt.status === 0 && /Skill: bug-hunt/i.test(purePrompt.stdout) && /weird memory leak/.test(purePrompt.stdout)
    ? ok('ctx.mjs finds and runs pure-prompt commands from .agents/skills when .claude is absent')
    : bad(`pure-prompt command loading failed (status ${purePrompt.status}): ${purePrompt.stdout + purePrompt.stderr}`);

  // ── did-you-mean + per-command help (ticket 096) ──
  const typo = ctx('doctr');
  typo.status !== 0 && /Did you mean:.*doctor/i.test(typo.stderr) && !/Commands by category/i.test(typo.stderr + typo.stdout)
    ? ok('unknown command suggests the closest matches, no full menu dump (096)')
    : bad(`did-you-mean missing for "doctr": ${typo.stderr.slice(0, 200)}`);

  const helpOne = ctx('help', 'doctor');
  helpOne.status === 0 && /doctor/i.test(helpOne.stdout) && /Run: node ctx\.mjs doctor/.test(helpOne.stdout)
    ? ok('help <command> prints the single-command card (096)')
    : bad(`help doctor failed: ${(helpOne.stdout + helpOne.stderr).slice(0, 200)}`);

  const menu = ctx();
  /Commands by category/i.test(menu.stdout)
    ? ok('bare ctx.mjs prints the categorised menu from the engine module (096)')
    : bad('categorised menu missing — ctx-menu.mjs not loaded');

  // ── path confinement (ticket 090): a traversal-shaped command must not dispatch ──
  const traversal = ctx('../../runtime/hooks/session-start');
  traversal.status !== 0 && /Unknown command/i.test(traversal.stderr)
    ? ok('ctx.mjs refuses a path-shaped command — dispatch confined to SCRIPTS_DIR (090)')
    : bad('ctx.mjs dispatched a path-shaped command outside SCRIPTS_DIR');

  // ── shared drift predicate (ticket 092): session status agrees with the Stop hook ──
  const ledgerDir = join(proj, '.claude', '.sessions');
  mkdirSync(ledgerDir, { recursive: true });
  const mkLedger = (id, paths) => writeFileSync(join(ledgerDir, `${id}.json`), JSON.stringify({
    sessionId: id, startedAt: Date.now(), registered: false, stopWarnedAt: null, simulations: [],
    modifications: paths.map((p) => ({ path: p, at: Date.now() })),
  }));
  mkLedger('agdrift', ['src/app.js', 'src/lib/core.js']);
  mkLedger('agnoise', ['scratch/notes.txt']); // matches no ledger.important prefix
  const status = ctx('session', 'status');
  /Pending drift.*1 session/i.test(status.stdout) && /agdrift/.test(status.stdout) && !/agnoise/.test(status.stdout)
    ? ok('session status counts drift via the shared ledger predicate — noise-only ledger ignored (092)')
    : bad(`session status drift mismatch: ${status.stdout.slice(0, 300)}`);

  // ── agy guard — explicit L5 pre-edit checkpoint (ticket 095) ──
  const cfgPath = join(proj, 'contextkit', 'config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
  cfg.l5.highRiskPaths = ['src/secure/'];
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

  const safe = ctx('guard', 'src/app.js');
  safe.status === 0 && /allowed/i.test(safe.stdout)
    ? ok('guard allows a non-high-risk path (095)')
    : bad(`guard blocked a safe path (status ${safe.status}): ${safe.stdout.slice(0, 150)}`);

  const blocked = ctx('guard', 'src/secure/auth.js');
  blocked.status === 1 && /BLOCKED/i.test(blocked.stdout) && /simulate-impact/i.test(blocked.stdout)
    ? ok('guard blocks a high-risk path with no simulation — exit 1 (095)')
    : bad(`guard did not block (status ${blocked.status}): ${blocked.stdout.slice(0, 150)}`);

  run([join(proj, 'contextkit', 'tools', 'scripts', 'mark-simulation.mjs'), 'cover secure', 'src/secure/'], { cwd: proj });
  const covered = ctx('guard', 'src/secure/auth.js');
  covered.status === 0 && /covered/i.test(covered.stdout)
    ? ok('guard allows after a covering /simulate-impact record (095)')
    : bad(`guard still blocked after simulation (status ${covered.status}): ${covered.stdout.slice(0, 150)}`);

  // ── native agy lifecycle hooks (ADR-0049) ──
  const agyHooksPath = join(proj, '.agents', 'hooks.json');
  const agyHooks = (() => { try { return JSON.parse(readFileSync(agyHooksPath, 'utf-8')); } catch { return null; } })();
  const kitGroup = agyHooks?.contextdevkit;
  kitGroup?.enabled === true &&
    /session-manager\.mjs start$/.test(kitGroup.SessionStart?.[0]?.hooks?.[0]?.command ?? '') &&
    (kitGroup.PreToolUse ?? []).some((e) => e.matcher === 'write_to_file' && /simulate-gate\.mjs --host agy$/.test(e.hooks?.[0]?.command ?? ''))
    ? ok('.agents/hooks.json wired at install — SessionStart + per-tool L5 gate with --host agy (ADR-0049)')
    : bad(`.agents/hooks.json wiring wrong: ${JSON.stringify(agyHooks)?.slice(0, 200)}`);

  // session-manager start mints the stable agy session id hooks share.
  run([join(proj, 'contextkit', 'runtime', 'antigravity', 'session-manager.mjs'), 'start'], { cwd: proj });
  const markerPath = join(proj, '.claude', '.sessions', '.agy-active.json');
  const agySid = (() => { try { return JSON.parse(readFileSync(markerPath, 'utf-8')).sid; } catch { return null; } })();
  agySid && agySid.startsWith('agy_')
    ? ok('session-manager start mints the .agy-active.json session marker (ADR-0049)')
    : bad('agy session marker missing after session-manager start');

  // track-edits --host agy understands the toolCall/TargetFile wire format.
  run([join(proj, 'contextkit', 'runtime', 'hooks', 'track-edits.mjs'), '--host', 'agy'], {
    cwd: proj, input: JSON.stringify({ toolCall: { name: 'write_to_file', args: { TargetFile: 'src/app.js' } } }),
  });
  const agyLedger = (() => { try { return JSON.parse(readFileSync(join(ledgerDir, `${agySid}.json`), 'utf-8')); } catch { return null; } })();
  agyLedger?.modifications?.some((m) => m.path === 'src/app.js' && m.tool === 'write_to_file')
    ? ok('track-edits --host agy ledgers an agy write under the minted session id (ADR-0049)')
    : bad(`agy edit not ledgered: ${JSON.stringify(agyLedger)?.slice(0, 200)}`);

  // simulate-gate --host agy answers in the agy dialect: decision "deny".
  const agyGate = run([join(proj, 'contextkit', 'runtime', 'hooks', 'simulate-gate.mjs'), '--host', 'agy'], {
    cwd: proj, input: JSON.stringify({ toolCall: { name: 'write_to_file', args: { TargetFile: 'src/secure/auth.js' } } }),
  });
  const gateVerdict = (() => { try { return JSON.parse(agyGate.stdout); } catch { return null; } })();
  gateVerdict?.decision === 'deny' && /simulate-impact/.test(gateVerdict?.reason ?? '')
    ? ok('simulate-gate --host agy denies an uncovered high-risk agy write (ADR-0049)')
    : bad(`agy gate verdict wrong: ${agyGate.stdout.slice(0, 200)}`);

  // ── antigravity-aware doctor (ticket 086) ──
  const healthy = ctx('doctor');
  /ctx\.mjs runner present/.test(healthy.stdout) && /asset trees populated/.test(healthy.stdout) && /INSTRUCTIONS\.md present, fully rendered/.test(healthy.stdout)
    ? ok('doctor verifies the Antigravity host on a fresh install (086)')
    : bad(`doctor missing antigravity checks: ${healthy.stdout.slice(-400)}`);

  writeFileSync(join(proj, 'INSTRUCTIONS.md'), '# {{PROJECT_NAME}}\nbroken render\n');
  const stale = ctx('doctor');
  /unrendered placeholder.*\{\{PROJECT_NAME\}\}/.test(stale.stdout)
    ? ok('doctor flags a leftover {{TOKEN}} in INSTRUCTIONS.md (086)')
    : bad('doctor did not flag the unrendered placeholder');
} catch (err) {
  bad(`crashed: ${err?.stack || err}`);
} finally {
  fx.cleanup();
}

rep.finish('Integration (Antigravity host)');
