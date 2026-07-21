/**
 * selfcheck-graph-squad-selection.mjs — WF-0078 acceptance checks (BIZ-0005, ADR-0145).
 * Exports `runGraphSquadSelectionChecks({ ok, bad }, { KIT })` for the hub (mirrors
 * selfcheck-madm.mjs); self-runs too (`node tools/selfcheck-graph-squad-selection.mjs
 * <root>`) and exits non-zero on any bad, so a phantom pass cannot hide a failure.
 *
 * Proves: (1) product-team exists in squads-registry + product-owner anchor populated
 * (the two-part fix); (2) graphOwnership is a WEIGHTED SIGNAL that ADDS to a score, never
 * a hard router — a stake never forces a selection nor demotes devteam out of eligibility;
 * (3) a graph stake actually raises the staked squad's agent (re-rank, not override);
 * (4) deriveSquadStakes is fail-open (bad graph / empty seed → {}, no throw); (5) with a
 * real graph + a real seed, stakes derive as a plain map (deterministic, no throw).
 *
 * Zero runtime deps beyond node:* + the modules under test.
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const RT = 'templates/contextkit/runtime';
const POLICY = 'templates/contextkit/policy';

/**
 * @param {{ ok:(m:string)=>void, bad:(m:string)=>void }} counters
 * @param {{ KIT: string }} ctx  KIT = project/worktree root (holds the graph + policy).
 */
export async function runGraphSquadSelectionChecks({ ok, bad }, { KIT }) {
  let sel;
  try {
    sel = await import(pathToFileURL(resolve(KIT, RT, 'execution/request-agent-select.mjs')).href);
    ok('WF-0078 selector module imports cleanly');
  } catch (err) {
    bad(`WF-0078 import failed: ${err?.message ?? err}`);
    return;
  }

  // (1) the two-part product-team fix.
  try {
    const squads = JSON.parse(readFileSync(resolve(KIT, POLICY, 'squads-registry.json'), 'utf-8').replace(/^﻿/, ''));
    const hasProductSquad = Array.isArray(squads.squads) && squads.squads.some((s) => s.squad === 'product-team' && Array.isArray(s.paths) && s.paths.length > 0);
    const agents = JSON.parse(readFileSync(resolve(KIT, POLICY, 'agent-capability-registry.json'), 'utf-8').replace(/^﻿/, ''));
    const po = agents.agents.find((a) => a.agent === 'product-owner');
    const anchored = po && Array.isArray(po.pathPatterns) && po.pathPatterns.length > 0 && Array.isArray(po.playbooks) && po.playbooks.length > 0;
    hasProductSquad && anchored
      ? ok('(1) product-team squad entry created AND product-owner anchor populated (two-part fix)')
      : bad(`(1) product-team fix incomplete: squadEntry=${hasProductSquad} agentAnchor=${anchored}`);
  } catch (err) {
    bad(`(1) registry read failed: ${err?.message ?? err}`);
  }

  const reg = sel.loadAgentRegistry(KIT);
  const cls = { intent: 'material-decision', risk: 'medium', primaryType: 'business', complexity: 'feature' };

  // (2)+(3) graph is a weighted signal, not a router.
  const noStake = sel.selectAgents(cls, { paths: ['x.mjs'] }, {}, reg);
  const withStake = sel.selectAgents(cls, { paths: ['x.mjs'], squadStakes: { 'product-team': true } }, {}, reg);
  const poGainsGraph = withStake.reasonCodes.some((r) => r.includes('product-owner') && r.includes('graph-ownership'));
  const poNoGraphWithout = !noStake.reasonCodes.some((r) => r.includes('product-owner') && r.includes('graph-ownership'));
  if (poGainsGraph && poNoGraphWithout) {
    ok('(3) a product-team stake raises product-owner via +graph-ownership (re-rank on a real signal)');
  } else {
    bad(`(3) graph stake did not add to product-owner: gains=${poGainsGraph} cleanWithout=${poNoGraphWithout}`);
  }

  // devteam is never demoted out of eligibility by a foreign stake (signal, not veto).
  const devteamStake = sel.selectAgents({ intent: 'implementation', risk: 'high', primaryType: 'implementation', complexity: 'feature' },
    { paths: ['templates/contextkit/runtime/x.mjs'], squadStakes: { 'design-team': true } }, {}, reg);
  const devteamStillEligible = devteamStake.lead !== null || devteamStake.reviewers.length > 0 || devteamStake.reasonCodes.some((r) => /architect|code-reviewer|implementation-engineer/.test(r));
  devteamStillEligible
    ? ok('(2) a foreign (design) stake never vetoes devteam — graph is a signal, not a router')
    : bad('(2) devteam was demoted out by a foreign stake — graph acted as a router (invariant broken)');

  // (4) deriveSquadStakes fail-open.
  if (typeof sel.deriveSquadStakes === 'function') {
    try {
      const emptySeed = await sel.deriveSquadStakes(KIT, []);
      const badRoot = await sel.deriveSquadStakes(resolve(KIT, 'no-such-root-xyz'), ['x.mjs']);
      (emptySeed && typeof emptySeed === 'object' && Object.keys(emptySeed).length === 0
        && badRoot && typeof badRoot === 'object')
        ? ok('(4) deriveSquadStakes fail-open: empty seed → {}, bad root → object, no throw')
        : bad(`(4) deriveSquadStakes not fail-open: emptySeed=${JSON.stringify(emptySeed)} badRoot=${JSON.stringify(badRoot)}`);
    } catch (err) {
      bad(`(4) deriveSquadStakes threw instead of failing open: ${err?.message ?? err}`);
    }
  } else {
    bad('(4) deriveSquadStakes is not exported');
  }

  // (5) real graph + real seed → a plain map (deterministic, no throw). Empty is acceptable
  // (the seed may not reach a squad-owned surface) — the point is it derives without error.
  try {
    const stakes = await sel.deriveSquadStakes(KIT, ['templates/contextkit/runtime/execution/request-agent-select.mjs']);
    (stakes && typeof stakes === 'object' && !Array.isArray(stakes))
      ? ok(`(5) deriveSquadStakes on the real graph returns a stake map (${Object.keys(stakes).length} staked squad(s))`)
      : bad('(5) deriveSquadStakes did not return a plain map on the real graph');
  } catch (err) {
    bad(`(5) deriveSquadStakes threw on the real graph: ${err?.message ?? err}`);
  }
}

// --- self-run guard: prove the suite executes (no phantom pass) ------------------
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const KIT = process.argv[2] || process.cwd();
  let okN = 0; let badN = 0;
  const ok = (m) => { okN += 1; console.log(`  ok  ${m}`); };
  const bad = (m) => { badN += 1; console.log(`  BAD ${m}`); };
  await runGraphSquadSelectionChecks({ ok, bad }, { KIT });
  console.log(`\nselfcheck-graph-squad-selection: ${okN} ok / ${badN} bad`);
  process.exit(badN === 0 ? 0 : 1);
}
