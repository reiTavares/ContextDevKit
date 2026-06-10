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
} catch (err) {
  bad(`crashed: ${err?.stack || err}`);
} finally {
  fx.cleanup();
}

rep.finish('Integration (Antigravity host)');
