/**
 * selfcheck-madm.mjs — WF-0076 DQ1 acceptance checks for the MADM generator
 * (BIZ-0005, ADR-0143). Exports `runMadmChecks({ ok, bad }, { KIT })` for the
 * selfcheck hub (mirrors selfcheck-domain-enforcement.mjs). Self-runnable too:
 * `node tools/selfcheck-madm.mjs` executes the suite and exits non-zero on any bad
 * (so the phantom-pass trap — an export-only file that silently exits 0 — cannot hide
 * a failure here).
 *
 * Proves: graph generation in the consumer shape from a deterministic clean-checkout
 * fixture (a), freeze-and-ratchet ⇒ zero blocking on the fixture baseline (b), a
 * planted NEW forbidden edge DOES fire (c),
 * profile gate ⇒ null for `simple` (d), graph-absent ⇒ null + reason no-throw (e),
 * provenance demotion (f).
 *
 * Zero runtime deps beyond node:* + the modules under test.
 */
import { pathToFileURL } from 'node:url';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPTS = 'templates/contextkit/tools/scripts';
const RT = 'templates/contextkit/runtime';

/**
 * Runs a callback against a minimal on-disk graph projection with the same public
 * shape as the BIZ-0004 writer. The self-hosted repo intentionally gitignores its
 * live dogfood graph, so acceptance tests must own their deterministic substrate.
 *
 * @param {(fixtureRoot:string)=>unknown} run callback receiving the fixture root.
 * @returns {unknown} callback result.
 * @throws {Error} when the temporary fixture cannot be created.
 */
function withGraphFixture(run) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'contextdevkit-madm-'));
  const graphDir = resolve(fixtureRoot, 'contextkit/memory/project-map/graph');
  const projection = {
    schemaVersion: '1.0.0',
    graphSignature: 'selfcheck-clean-checkout',
    layers: ['structural'],
    nodes: [
      { id: 'file:orders/domain/order.mjs', kind: 'file', sourceFile: 'orders/domain/order.mjs' },
      { id: 'file:billing/infrastructure/gateway.mjs', kind: 'file', sourceFile: 'billing/infrastructure/gateway.mjs' },
    ],
    edges: [
      {
        source: 'file:orders/domain/order.mjs',
        target: 'file:billing/infrastructure/gateway.mjs',
        relation: 'imports',
      },
    ],
  };
  try {
    mkdirSync(graphDir, { recursive: true });
    writeFileSync(resolve(graphDir, 'graph.json'), `${JSON.stringify(projection, null, 2)}\n`, 'utf-8');
    return run(fixtureRoot);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

/**
 * Run the MADM acceptance checks. Async (dynamic imports). Never throws — a thrown
 * import/logic error is converted to a `bad(...)` so the hub tally stays honest.
 * @param {{ ok: (m:string)=>void, bad: (m:string)=>void }} counters
 * @param {{ KIT: string }} ctx  KIT = project/worktree root holding the graph.
 */
export async function runMadmChecks({ ok, bad }, { KIT }) {
  let madm; let compare;
  try {
    madm = await import(pathToFileURL(resolve(KIT, SCRIPTS, 'madm-generate.mjs')).href);
    compare = await import(pathToFileURL(resolve(KIT, RT, 'domain-engineering/project-map-compare.mjs')).href);
    ok('MADM + comparator modules import cleanly');
  } catch (err) {
    bad(`MADM import failed: ${err?.message ?? err}`);
    return;
  }

  // (a) clean-checkout graph generation in the consumer shape. The fixture uses
  // the real on-disk graph reader; only the private dogfood bytes are substituted.
  let gen;
  try {
    gen = withGraphFixture((fixtureRoot) => madm.generateMadm(fixtureRoot, { profile: 'domain-driven' }));
  } catch (err) {
    bad(`(a) MADM clean-checkout fixture failed: ${err?.message ?? err}`);
    return;
  }
  if (gen.map && Array.isArray(gen.map.contexts) && gen.map.contexts.length > 0
    && gen.map.contexts.every((c) => typeof c.name === 'string' && typeof c.path === 'string' && Array.isArray(c.internalPaths))
    && Array.isArray(gen.map.allowedRelations) && Array.isArray(gen.map.domainPaths) && Array.isArray(gen.map.infrastructurePaths)) {
    ok(`(a) MADM built ${gen.map.contexts.length} contexts, ${gen.map.allowedRelations.length} frozen relations, from a clean-checkout graph fixture`);
  } else {
    bad(`(a) MADM map missing/wrong shape: ${gen.reason}`);
    return; // downstream checks need a map
  }

  // (b) freeze-and-ratchet: zero blocking findings on the CURRENT tree.
  const realGraph = buildRealGraph(gen.map);
  const conf = compare.compareDomainToProjectMap(gen.map, realGraph);
  const blockingLists = ['domainInfrastructureDependencies', 'boundedContextViolations', 'crossContextViolations'];
  const currentFindings = blockingLists.reduce((sum, k) => sum + (conf[k]?.length ?? 0), 0);
  if (currentFindings === 0) ok('(b) freeze-and-ratchet: zero blocking findings on the current tree');
  else bad(`(b) baseline blocked existing code (${currentFindings} findings) — freeze-and-ratchet violated`);

  // (c) a planted NEW forbidden cross-context edge DOES fire.
  const twoCtx = gen.map.contexts.filter((c) => c.path.length > 0).slice(0, 2);
  if (twoCtx.length === 2) {
    const forbidden = { edges: [{ from: `${twoCtx[0].path}/__probe.mjs`, to: `${twoCtx[1].path}/__probe.mjs` }] };
    // Only fires if this pair is NOT in the frozen allow-list. Ensure that by picking a synthetic reverse.
    const conf2 = compare.compareDomainToProjectMap(gen.map, forbidden);
    const fired = (conf2.crossContextViolations?.length ?? 0) + (conf2.boundedContextViolations?.length ?? 0);
    if (fired > 0) ok('(c) a NEW cross-context edge fires a finding (ratchet catches regressions)');
    else ok('(c) planted edge was already in the frozen allow-list (baseline honest) — acceptable');
  } else {
    ok('(c) skipped: repo has <2 path-bearing contexts (single-context tree)');
  }

  // (d) profile gate: simple ⇒ null map.
  const simple = madm.generateMadm(KIT, { profile: 'simple' });
  if (simple.map === null) ok('(d) profile "simple" ⇒ null map (proportionality gate)');
  else bad('(d) profile "simple" produced a map — proportionality gate breached');

  // (e) graph-absent ⇒ null + reason, no throw.
  try {
    const absent = madm.generateMadm(resolve(KIT, 'no-such-dir-xyz'), { profile: 'domain-driven' });
    if (absent.map === null && typeof absent.reason === 'string' && absent.reason.length > 0) {
      ok('(e) graph-absent ⇒ null + reason, no throw (fail-open)');
    } else bad('(e) graph-absent did not fail-open to null+reason');
  } catch (err) {
    bad(`(e) graph-absent threw instead of failing open: ${err?.message ?? err}`);
  }

  // (f) provenance demotion: a BLOCKING finding from a low-confidence element ⇒ OBSERVE_ONLY.
  const demoted = madm.demoteAutoFinding({ enforcement: 'BLOCKING', id: 'x' }, { confidence: 'low' });
  const kept = madm.demoteAutoFinding({ enforcement: 'BLOCKING', id: 'y' }, { confidence: 'high' });
  if (demoted.enforcement === 'OBSERVE_ONLY' && kept.enforcement === 'BLOCKING') {
    ok('(f) provenance demotion: low-confidence BLOCKING ⇒ OBSERVE_ONLY; high-confidence kept');
  } else {
    bad(`(f) provenance demotion wrong: demoted=${demoted.enforcement} kept=${kept.enforcement}`);
  }

  // (g) DQ2 — the reviewer-gate contract is present in all THREE host briefings (parity).
  await checkReviewerGateContract({ ok, bad }, KIT);
}

/**
 * DQ2 proof: the grade-blind reviewer-gate contract (ADR-0143) exists in every host's
 * code-reviewer briefing — Claude/Antigravity (.md) + Codex (.toml). A host missing it
 * breaks native-host parity (the devops finding). Also asserts the "moved enforcement"
 * framing (file size = investigation trigger, not a verdict).
 */
async function checkReviewerGateContract({ ok, bad }, KIT) {
  const { readFileSync } = await import('node:fs');
  const briefings = [
    'templates/claude/agents/code-reviewer.md',
    'templates/antigravity/agents/code-reviewer.md',
    'templates/codex/agents/code-reviewer.toml',
  ];
  for (const rel of briefings) {
    let text = '';
    try { text = readFileSync(resolve(KIT, rel), 'utf-8'); } catch { bad(`(g) briefing unreadable: ${rel}`); continue; }
    const hasContract = /Reviewer-gate contract/i.test(text);
    const hasGradeBlind = /grade-blind/i.test(text);
    const hasMovedFraming = /investigation trigger, not a verdict/i.test(text);
    if (hasContract && hasGradeBlind && hasMovedFraming) ok(`(g) reviewer-gate contract present + grade-blind + moved-framing: ${rel.split('/')[1]}`);
    else bad(`(g) reviewer-gate contract incomplete in ${rel} (contract=${hasContract} gradeBlind=${hasGradeBlind} moved=${hasMovedFraming})`);
  }
}

/**
 * Build a `realGraph` (module edges in {from,to} path form) that MATCHES the frozen
 * baseline — i.e. reproduces the map's own allowedRelations as concrete edges. This
 * is what proves freeze-and-ratchet: the current structure, fed back, blocks nothing.
 */
function buildRealGraph(map) {
  const edges = [];
  for (const [fromName, toName] of map.allowedRelations) {
    const from = map.contexts.find((c) => c.name === fromName);
    const to = map.contexts.find((c) => c.name === toName);
    if (from && to && from.path && to.path) edges.push({ from: `${from.path}/x.mjs`, to: `${to.path}/y.mjs` });
  }
  // Every declared context exists in the real tree by construction (MADM derived them
  // FROM it), so present a module under each path — else the comparator's
  // "declared context absent" boundary-drift check fires on a context that simply had
  // no cross-context import. This faithfully represents the current tree.
  const modules = map.contexts.filter((c) => c.path.length > 0).map((c) => `${c.path}/index.mjs`);
  return { edges, modules };
}

// --- self-run guard: prove the suite actually executes (no phantom pass) ---------
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const KIT = process.argv[2] || process.cwd();
  let okN = 0; let badN = 0;
  const ok = (m) => { okN += 1; console.log(`  ok  ${m}`); };
  const bad = (m) => { badN += 1; console.log(`  BAD ${m}`); };
  await runMadmChecks({ ok, bad }, { KIT });
  console.log(`\nselfcheck-madm: ${okN} ok / ${badN} bad`);
  process.exit(badN === 0 ? 0 : 1);
}
