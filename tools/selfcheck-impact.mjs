#!/usr/bin/env node
/**
 * Selector self-test (TEA-004, SPEC §4/§12) — STANDALONE entrypoint (exit 0/1).
 *
 * WHY: the impact selector trades safety for speed, so its OWN tests must prove
 * the safety half holds: every broadening rule fires, every uncertainty path
 * escalates to FULL, and — the cardinal guarantee — NO input with changes ever
 * yields an empty selection. A regression here would let a real change skip the
 * suite that covers it (a false negative, the sin SPEC §4 calls out).
 *
 * Two layers: (1) table-driven unit cases over SYNTHETIC suite fixtures with
 * unique touches (deterministic, independent of how the real `touches[]` happen
 * to overlap); (2) a guardrail over the REAL `SUITES` asserting no changed input
 * collapses to empty. Registered in `test-suites.mjs` as a `smoke` suite so it
 * rides every run. Zero-dep, `node:*` only, Windows-safe.
 */
import { selectSuites, explainSelection } from './test-impact.mjs';
import { SUITES } from './test-suites.mjs';

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => {
  console.error(`  ✗ ${msg}`);
  failures += 1;
};

/** Assert deep-ish: the selected ids equal `expected` (order-insensitive). */
const assertIds = (label, selected, expected) => {
  const got = selected.map((s) => s.id).sort();
  const want = [...expected].sort();
  const equal = got.length === want.length && got.every((id, i) => id === want[i]);
  equal ? ok(`${label} → [${got.join(', ')}]`) : bad(`${label} → got [${got.join(', ')}], want [${want.join(', ')}]`);
};

/**
 * Synthetic suite fixtures with UNIQUE, non-overlapping touch seeds so each unit
 * case maps to a known, exact set. Tiers mirror the real ones the broadening
 * rules key on (installer cluster, hosts tier).
 * @type {ReadonlyArray<{id:string,file:string,tier:string,touches:string[]}>}
 */
const FIXTURES = Object.freeze([
  { id: 'only-a', file: 'tools/it-a.mjs', tier: 'smoke', touches: ['templates/contextkit/runtime/alpha/'] },
  { id: 'only-b', file: 'tools/it-b.mjs', tier: 'smoke', touches: ['templates/contextkit/runtime/beta/'] },
  { id: 'integration-test', file: 'tools/integration-test.mjs', tier: 'integration:core', touches: ['x/core/'] },
  { id: 'tooling', file: 'tools/it-tooling.mjs', tier: 'integration:installer', touches: ['x/tooling/'] },
  { id: 'migrate', file: 'tools/it-migrate.mjs', tier: 'integration:installer', touches: ['x/migrate/'] },
  { id: 'update-safety', file: 'tools/it-update.mjs', tier: 'integration:installer', touches: ['x/update/'] },
  { id: 'guards', file: 'tools/it-guards.mjs', tier: 'integration:installer', touches: ['x/guards/'] },
  { id: 'install-cycle', file: 'tools/it-cycle.mjs', tier: 'smoke', touches: ['x/cycle/'] },
  { id: 'host-codex', file: 'tools/it-codex.mjs', tier: 'integration:hosts', touches: ['x/codex/'] },
  { id: 'host-antig', file: 'tools/it-antig.mjs', tier: 'integration:hosts', touches: ['x/antig/'] },
]);

/** Run the synthetic table — one row per behaviour, naming the layer it covers. */
function unitTable() {
  const sel = (changed) => selectSuites({ changed, suites: FIXTURES });
  const ALL = FIXTURES.map((s) => s.id);

  // Happy path: a single unique touch selects exactly that one suite (not full).
  assertIds('single-suite touch (happy)', sel(['templates/contextkit/runtime/alpha/x.mjs']), ['only-a']);
  const single = explainSelection({ changed: ['templates/contextkit/runtime/alpha/x.mjs'], suites: FIXTURES });
  single.confidence === 'high' ? ok('single-suite → confidence high') : bad(`single-suite confidence ${single.confidence}`);
  single.full === false ? ok('single-suite → not a full run') : bad('single-suite escalated to full');

  // Broadening: installer rule (install.mjs / tools/install/**) → installer cluster.
  assertIds('rule:installer (install.mjs)', sel(['install.mjs']),
    ['integration-test', 'tooling', 'migrate', 'update-safety', 'guards', 'install-cycle']);
  assertIds('rule:installer (tools/install/**)', sel(['tools/install/engine.mjs']),
    ['integration-test', 'tooling', 'migrate', 'update-safety', 'guards', 'install-cycle']);

  // Broadening: hosts rule (host/bridge template) → every hosts-tier suite.
  assertIds('rule:hosts (codex template)', sel(['templates/contextkit/runtime/codex/x.mjs']),
    ['host-codex', 'host-antig']);
  assertIds('rule:hosts (ctx.mjs bridge)', sel(['templates/ctx.mjs']), ['host-codex', 'host-antig']);

  // Broadening → FULL: config/loader change forces the whole list.
  assertIds('rule:full (config)', sel(['templates/contextkit/runtime/config/paths.mjs']), ALL);
  // Broadening → FULL: test-infra change forces the whole list.
  assertIds('rule:full (test-infra run-suites)', sel(['tools/run-suites.mjs']), ALL);
  assertIds('rule:full (test-infra test-suites)', sel(['tools/test-suites.mjs']), ALL);

  // Uncertainty → FULL: an unmapped SOURCE path forces the whole list.
  assertIds('rule:full (unmapped source)', sel(['templates/contextkit/runtime/zzz/new.mjs']), ALL);
  // Uncertainty → FULL: empty diff on a (dirty) tree forces the whole list.
  assertIds('rule:full (empty diff)', sel([]), ALL);
  const emptyConf = explainSelection({ changed: [], suites: FIXTURES });
  emptyConf.confidence === 'low' ? ok('empty diff → confidence low') : bad(`empty diff confidence ${emptyConf.confidence}`);
}

/**
 * Cardinal guarantee over the REAL suite list: no changed input may collapse to
 * an empty selection. We probe a spread of realistic paths plus an unmapped one;
 * each must yield ≥1 suite (full is acceptable, empty is never).
 */
function noEmptyGuard() {
  const probes = [
    ['install.mjs'], ['tools/install/engine.mjs'], ['templates/contextkit/runtime/execution/foo.mjs'],
    ['templates/contextkit/runtime/codex/bar.mjs'], ['templates/contextkit/runtime/config/load.mjs'],
    ['tools/run-suites.mjs'], ['some/totally/unmapped/source.mjs'], ['docs/only.md'], [],
  ];
  let empties = 0;
  for (const changed of probes) {
    const selected = selectSuites({ changed, suites: SUITES });
    if (!Array.isArray(selected) || selected.length === 0) {
      empties += 1;
      bad(`EMPTY selection for changed=[${changed.join(', ')}] (cardinal sin)`);
    }
  }
  empties === 0 ? ok(`no changed input collapses to empty (${probes.length} probes over real SUITES)`) : null;
}

/** A non-array / undefined input must degrade safely (empty array, not throw). */
function defensiveInputs() {
  try {
    const a = selectSuites({ changed: 'oops', suites: SUITES });
    const b = selectSuites(undefined);
    Array.isArray(a) && Array.isArray(b)
      ? ok('non-array / undefined input degrades to an array (no throw)')
      : bad('defensive input did not return an array');
  } catch (err) {
    bad(`defensive input threw: ${err?.message ?? err}`);
  }
}

function main() {
  console.log('\n🌀 ContextDevKit test:impact selector self-test\n');
  unitTable();
  noEmptyGuard();
  defensiveInputs();
  console.log(failures === 0 ? '\n✅ selector self-test passed.\n' : `\n❌ ${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
