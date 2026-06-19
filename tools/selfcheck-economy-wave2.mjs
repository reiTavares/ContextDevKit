#!/usr/bin/env node
/**
 * Economy Runtime (WF0020) Wave-2 aggregate self-check.
 *
 * Dispatches the three gate-coupled advisory cards' `econCheck*` suites
 * in-process. The modules live under `templates/contextkit/tools/scripts/economy/`;
 * each exports `(root) => { name, pass, detail }[]`, advisory + fail-open. These
 * cards COMPUTE projectState-compatible signals for WF0019's CDK-032 gate but are
 * UNREGISTERED — nothing wires them into the live gate (deferred activation).
 *
 * Cards: #261 lean-loop, #262 loop-breaker, #263 patch-economy.
 * Plus gate-advisory (ADR-0103): the WIRED adapter that emits #262/#263 as
 * warn-only nudges on the live CDK-032 PreToolUse gate (fail-open, never blocks).
 *
 * Standalone runnable: `node tools/selfcheck-economy-wave2.mjs`
 * Exit 0 on all-pass, exit 1 on any failure. Zero runtime deps — node:* only.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dirname, '..');
const ECON = resolve(KIT, 'templates/contextkit/tools/scripts/economy');

/** Each entry: [label, module file, exported check fn name]. */
const CARDS = [
  ['#261 lean-loop', 'lean-loop.mjs', 'econCheckLeanLoop'],
  ['#262 loop-breaker', 'loop-breaker.mjs', 'econCheckLoopBreaker'],
  ['#263 patch-economy', 'patch-economy.mjs', 'econCheckPatchEconomy'],
  ['gate-advisory (wired)', 'gate-advisory.mjs', 'econCheckGateAdvisory'],
];

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { console.error(`  ✗ ${msg}`); failures += 1; };

for (const [label, file, fnName] of CARDS) {
  console.log(`\n── ${label} (${file}) ──`);
  let mod;
  try {
    mod = await import(pathToFileURL(resolve(ECON, file)).href);
  } catch (importErr) {
    bad(`${label}: import failed — ${importErr?.message ?? importErr}`);
    continue;
  }
  const fn = mod[fnName];
  if (typeof fn !== 'function') {
    bad(`${label}: missing export ${fnName}()`);
    continue;
  }
  let results;
  try {
    results = await fn(KIT);
  } catch (runErr) {
    bad(`${label}: ${fnName}() threw — ${runErr?.message ?? runErr}`);
    continue;
  }
  if (!Array.isArray(results) || results.length === 0) {
    bad(`${label}: ${fnName}() returned no results`);
    continue;
  }
  for (const r of results) {
    r && r.pass
      ? ok(`${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
      : bad(`${r?.name ?? '(unnamed)'} — ${r?.detail ?? 'failed'}`);
  }
}

console.log(
  failures === 0
    ? '\n✅ Economy Runtime Wave-2 self-check: all checks passed.\n'
    : `\n❌ Economy Runtime Wave-2 self-check: ${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
