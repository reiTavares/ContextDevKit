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
import { mkdirSync, writeFileSync } from 'node:fs';
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
} catch (err) {
  bad(`crashed: ${err?.stack || err}`);
} finally {
  fx.cleanup();
}

rep.finish('Integration (Antigravity host)');
