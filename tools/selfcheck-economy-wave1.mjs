#!/usr/bin/env node
/**
 * Economy Runtime (WF0020) Wave-1 aggregate self-check.
 *
 * Dispatches every card's exported `econCheck*` suite in-process and rolls the
 * results up to a single pass/fail. The card modules live under
 * `templates/contextkit/tools/scripts/economy/`; each exports a check function
 * `(root) => { name, pass, detail }[]` (sync or async), advisory + fail-open.
 *
 * Cards covered: #254 output-contract, #255 findings-merge, #256 agent-contract,
 * #257 run-compact, #258 context-profiles, #259 boot-delta, #260 resume-pack,
 * #264 economy-governance.
 *
 * Standalone runnable: `node tools/selfcheck-economy-wave1.mjs`
 * Exit 0 on all-pass, exit 1 on any failure. Zero runtime deps — node:* only.
 */
import { rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dirname, '..');
const ECON = resolve(KIT, 'templates/contextkit/tools/scripts/economy');

/** Each entry: [label, module file, exported check fn name]. */
const CARDS = [
  ['#254 output-contract', 'output-contract.mjs', 'econCheckContract'],
  ['#255 findings-merge', 'findings-merge.mjs', 'econCheckFindingsMerge'],
  ['#256 agent-contract', 'agent-contract.mjs', 'econCheckAgentContract'],
  ['#257 run-compact', 'run-compact.mjs', 'econCheckRunCompact'],
  ['#258 context-profiles', 'context-profiles.mjs', 'econCheckProfiles'],
  ['#259 boot-delta', 'boot-delta.mjs', 'econCheckBootDelta'],
  ['#259 boot-delta-gate (wired)', 'boot-delta-gate.mjs', 'econCheckBootDeltaGate'],
  ['#260 resume-pack', 'resume-pack.mjs', 'econCheckResumePack'],
  ['#264 economy-governance', 'economy-governance.mjs', 'econCheckGovernance'],
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

// Clean up any `runs/` artifacts the run-compact check wrote under the root.
try { rmSync(resolve(KIT, 'runs'), { recursive: true, force: true }); } catch { /* advisory */ }

console.log(
  failures === 0
    ? '\n✅ Economy Runtime Wave-1 self-check: all checks passed.\n'
    : `\n❌ Economy Runtime Wave-1 self-check: ${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
