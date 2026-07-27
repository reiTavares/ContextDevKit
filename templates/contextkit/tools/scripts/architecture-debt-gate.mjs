#!/usr/bin/env node
/**
 * Architecture & Technical-Debt Governance Gate — the §15 COMPOSITION ROOT
 * (WF-0057 W4, ADR-0122). This is the sole engine that wires the pure W2
 * analyzers + the W3 governance into ONE whole-gate verdict (decisions.md
 * Fork-1: one CI entry · one findings store · one config authority).
 *
 * The engine is deliberately THIN — every analytical decision lives in the
 * injected/imported pure modules; this file only ORCHESTRATES:
 *   1. context  — `buildGateContext` over `scanProject` + `computeInsights`
 *                 + the reused tech-debt walk (line metrics) + an injected
 *                 changed-set reader (fail-closed to scope-nothing, never PASS).
 *   2. run      — `runFitness(buildDefaultRegistry(), context)` collects the
 *                 catalogue-bound Findings (F1-F3 + floors BLOCKING when their
 *                 evidence is present; line-count ADVISORY; semantic OBSERVE_ONLY).
 *   3. baseline — `classifyAgainstBaseline` + `applyRatchet` scope to the changed
 *                 set so unchanged legacy debt never blocks unrelated work (§25).
 *   4. verdict  — `evaluatePolicy(findings, ruleModes)` → the single GateOutcome.
 *   5. persist  — `upsertFindings` into the evolved `tech-debt-findings.json` +
 *                 `toBoard` (render-only) + `renderReport` (human report).
 *
 * DORMANT BY DESIGN (W4): `--ci` is runnable and correct but NOT yet referenced
 * by package.json — the L5-gate activation (and the atomic line-budget demotion)
 * is the FINAL wave (W6). On THIS repo's tree, with no real blocking config wired,
 * the gate currently produces PASS / PASS_WITH_OBSERVATION — proving it composes
 * end-to-end without crashing.
 *
 * Zero runtime deps, ESM, `node:`/relative imports only (immutable rule #1).
 * Defensive I/O, fail-closed to REVIEW (never a false PASS) on missing evidence.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadConfigSync } from '../../runtime/config/load.mjs';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { resolveArchDebtConfig } from '../../runtime/config/resolve-arch-debt-config.mjs';
import { scanProject } from './project-map-core.mjs';
import { computeInsights } from './project-map-insights.mjs';
import { walk } from './tech-debt-scan.mjs';
import { buildGateContext, resolveChangedSet } from './arch-debt/gate-context.mjs';
import { buildDefaultRegistry, runFitness, influencingFindings } from './arch-debt/fitness-registry.mjs';
import { classifyAgainstBaseline, applyRatchet, positiveEvidence } from './arch-debt/baseline-ratchet.mjs';
import { evaluatePolicy } from './arch-debt/policy-engine.mjs';
import { readStore, writeStore, upsertFindings, toBoard, emptyStore } from './arch-debt/debt-registry.mjs';
import { ciShouldBlock, isApproval } from './arch-debt/finding.mjs';
import { BaselineClass, Enforcement, FindingStatus } from './arch-debt/finding-enums.mjs';
import { renderReport } from './arch-debt/debt-report-renderer.mjs';
import { gradedGraphSignals } from './arch-debt/signal-collector.mjs';
import { collectGradedSignals } from './graph-graded-signals.mjs';
import { collectChangeEvidence } from './arch-debt/change-evidence.mjs';
import { applyEnforcementPosture } from './arch-debt/enforcement-posture.mjs';

/**
 * Count the lines of a source file, fail-soft to 0 on any read error so a single
 * unreadable file never crashes the gate (immutable rule #2).
 * @param {string} absPath  absolute file path.
 * @returns {number} line count (0 on error).
 */
function countLines(absPath) {
  try {
    const text = readFileSync(absPath, 'utf-8');
    if (text.length === 0) return 0;
    return text.split('\n').length;
  } catch {
    return 0;
  }
}

/**
 * Per-file size metrics for the line-count signal, reusing the tech-debt walk as
 * the StructuralSignalCollector input source (decisions.md Fork-1 — never a second
 * walk). Pure given `root`/`walkFn`.
 * @param {string} root  project root.
 * @param {(dir:string, acc:string[])=>string[]} walkFn  injected file walker.
 * @returns {Array<{path:string, lines:number}>}
 */
function fileMetricsFor(root, walkFn) {
  const files = walkFn(root, []);
  return files.map((rel) => ({ path: rel, lines: countLines(resolve(root, rel)) }));
}

/** The conformance fitness rules (F1/F2/F3) that are baseline-relative (§25). */
const CONFORMANCE_RULES = Object.freeze(['F1.forbidden-cycle', 'F2.boundary', 'F3.state-authority']);

/**
 * Decide which analyzers are UNCONFIGURED for this run and must degrade to
 * DISABLED (→ SKIPPED, never a material UNKNOWN that blocks unrelated work). A
 * baseline-relative conformance floor is only APPLICABLE once its baseline
 * evidence is wired (W5); on an unconfigured tree (clean-clone / greenfield,
 * §34.28/§34.29) it is not-applicable, not a missing-evidence UNKNOWN.
 *
 * This is the §12 sanctioned mechanism: the policy drops DISABLED findings. It is
 * NOT silently passing — a genuinely STALE baseline (present but graph missing)
 * still flows through as UNKNOWN → REVIEW_REQUIRED (§34.22), because in that case
 * the conformance IS configured and these rules stay enabled.
 *
 * @param {Object|null} baseline  the wired baseline (null ⇒ conformance unconfigured).
 * @param {Object} config         the wired config slices.
 * @param {Object} explicit       caller-supplied ruleModes (take precedence).
 * @returns {Object<string,string>} ruleId → Enforcement override map.
 */
function degradeUnconfigured(baseline, config, explicit) {
  const modes = { ...(explicit && typeof explicit === 'object' ? explicit : {}) };
  const conformanceConfigured = Boolean(baseline)
    || Boolean(config && (config.layerRules || config.ownership || config.writeAuthorities));
  if (!conformanceConfigured) {
    for (const ruleId of CONFORMANCE_RULES) {
      if (!(ruleId in modes)) modes[ruleId] = 'DISABLED';
    }
  }
  return modes;
}

/**
 * Resolve the FINDINGS baseline the ratchet compares against — deliberately
 * distinct from the GRAPH baseline that F1/F2/F3 evaluate against (OP-0012).
 *
 * The two used to be conflated: the graph baseline
 * `{cycles, forbiddenEdges, stateAuthorities}` was handed to
 * `classifyAgainstBaseline`, which looks for a findings ARRAY. It found none, so
 * every finding classified as INTRODUCED and the repayment outcomes
 * (REDUCED/PAID ⇒ DEBT_REDUCED, §26) were unreachable.
 *
 * Resolution order, most explicit first. Falls back to the previously PERSISTED
 * findings store, which is the only honest record of "what this tree looked like
 * before". No store ⇒ an empty baseline: everything is INTRODUCED, which is the
 * correct first-run semantics (nothing is grandfathered by accident).
 *
 * @param {Object} opts  the runGate options (reads `findingsBaseline`, `storePath`).
 * @param {Object|Array|null} baseline  the graph baseline (legacy array seam).
 * @returns {Object[]} the findings baseline (possibly empty, never null).
 */
function resolveFindingsBaseline(opts, baseline) {
  if (Array.isArray(opts.findingsBaseline)) return opts.findingsBaseline;
  // Legacy/test seam: some callers pass a bare findings ARRAY as `baseline`.
  if (Array.isArray(baseline)) return baseline;
  if (baseline && Array.isArray(baseline.findings)) return baseline.findings;
  if (opts.storePath) {
    try {
      const prior = readStore(opts.storePath);
      if (prior && Array.isArray(prior.findings)) return verdictPopulation(prior.findings);
    } catch {
      // Unreadable store ⇒ empty baseline (everything INTRODUCED). Conservative:
      // it can over-report, never silently grandfather real debt.
    }
  }
  return [];
}

/**
 * Restrict a finding list to the SAME population the verdict set is drawn from.
 *
 * The store deliberately holds EVERY finding (including OBSERVE_ONLY, which the
 * board renders), while the verdict set excludes OBSERVE_ONLY via
 * `influencingFindings`. Comparing the two populations directly makes every
 * OBSERVE_ONLY baseline entry look like it VANISHED, so the ratchet re-injects it
 * as REDUCED/PAID repayment evidence — dragging its stale status (often UNKNOWN)
 * into the verdict and producing a bogus non-passing outcome. Both sides of a
 * baseline comparison must be the same population.
 *
 * @param {Object[]} findings  a stored finding list.
 * @returns {Object[]} only the findings that can influence a verdict.
 */
function verdictPopulation(findings) {
  return findings.filter((f) => f && f.enforcement !== Enforcement.OBSERVE_ONLY);
}

/**
 * Neutralise the STATUS of repayment entries (§26).
 *
 * `classifyAgainstBaseline` re-injects a baseline finding that is no longer
 * reported as REDUCED/PAID — but it re-injects the OLD finding object, status and
 * all. Left alone, a debt that was actually FIXED keeps voting with its stale
 * VIOLATION/UNKNOWN status and can still fail the gate: the exact opposite of
 * what repayment evidence means.
 *
 * A repaid finding is satisfied, so its status becomes PASS. The policy engine
 * skips PASS findings when bucketing (they cannot downgrade a clean verdict) yet
 * still counts their `deltaFromBaseline` for the DEBT_REDUCED outcome — so
 * repayment stays visible without ever blocking.
 *
 * @param {{delta:string, finding:Object}[]} ratcheted  output of applyRatchet.
 * @returns {Object[]} the findings for the verdict, repayment entries neutralised.
 */
function verdictFindingsFrom(ratcheted) {
  const REPAID = new Set([BaselineClass.REDUCED, BaselineClass.PAID]);
  return ratcheted.map((entry) => (
    REPAID.has(entry.delta) && entry.finding && typeof entry.finding === 'object'
      ? { ...entry.finding, status: FindingStatus.PASS }
      : entry.finding
  ));
}

/**
 * Run the whole architecture-debt gate end-to-end. Pure composition: it reads no
 * config beyond what it is injected and writes the findings store only when a
 * `storePath` is supplied. Every analytical decision lives in the imported pure
 * modules — this function only orchestrates and shapes the result.
 *
 * @param {Object} [opts]
 * @param {string} [opts.root]            project root (default `process.cwd()`).
 * @param {Object|null} [opts.config]     loaded config slices for the analyzers
 *   (layerRules/ownership/writeAuthorities/floors/lineBands…). Absent ⇒ the
 *   conformance + floor analyzers degrade to SKIPPED/UNKNOWN, never a silent PASS.
 * @param {Object|null} [opts.baseline]   pre-change graph baseline (null ⇒ F1/F2/F3
 *   surface UNKNOWN → REVIEW_REQUIRED, never PASS, §34.22).
 * @param {(()=>(string[]|null))} [opts.readChangedFiles]  injected changed-set reader.
 * @param {Object} [opts.model]           injected project-map model (skips the scan
 *   in tests). Defaults to `scanProject(root)`.
 * @param {Object} [opts.insights]        injected graph insights (skips `computeInsights`
 *   in tests; an insights object lacking `cycles` exercises the §34.22 stale-graph path).
 * @param {(dir:string,acc:string[])=>string[]} [opts.walkFn]  injected file walker.
 * @param {Object} [opts.ruleModes]       per-rule enforcement overrides (§12).
 * @param {string|null} [opts.storePath]  absolute path to `tech-debt-findings.json`
 *   to persist into (null ⇒ in-memory only, no write).
 * @param {Array<{path:string,lines:number}>} [opts.fileMetrics]  injected size metrics
 *   (skips the walk in tests).
 * @returns {{outcome:string, store:Object, board:string, report:string,
 *   exitCode:number, blocking:Object[], review:Object[], advisory:Object[],
 *   positive:Object[], reasons:string[], skipped:string[], fileCount:number}}
 */
export async function runGate(opts = {}) {
  const root = opts.root || process.cwd();
  const config = opts.config || {};
  const baseline = Object.prototype.hasOwnProperty.call(opts, 'baseline') ? opts.baseline : null;
  const walkFn = typeof opts.walkFn === 'function' ? opts.walkFn : walk;

  // 1. Structural model + graph insights (reuse project-map; no second graph).
  const model = opts.model || scanProject(root, Date.now(), opts.config ? { projectMap: opts.config.projectMap } : null);
  // `insights` may be injected to exercise the graph-stale path (§34.22) where the
  // baseline is configured but the structural graph evidence is missing.
  const insights = Object.prototype.hasOwnProperty.call(opts, 'insights')
    ? opts.insights
    : computeInsights(model.modules);
  const fileCount = typeof model.fileCount === 'number' ? model.fileCount : (model.modules || []).length;

  // CHANGE EVIDENCE (OP-0012). Produces the per-file added/removed LINES the
  // security floor scans plus the changed-set the ratchet scopes to, diffed
  // against the merge-base (not just the working tree) so a clean CI checkout is
  // not blind. Skipped entirely when the caller injects its own reader (tests).
  const changeEvidence = opts.changeEvidence
    || (typeof opts.readChangedFiles === 'function'
      ? null
      : collectChangeEvidence({ root, env: opts.env || process.env }));

  // Changed-set (injected reader → fail-closed empty set = scope nothing).
  const reader = typeof opts.readChangedFiles === 'function'
    ? opts.readChangedFiles
    : () => (changeEvidence && changeEvidence.available ? changeEvidence.changedPaths : null);
  const { changedSet } = resolveChangedSet(reader);

  // Per-file line metrics — reuse the tech-debt walk as the collector input.
  const fileMetrics = Array.isArray(opts.fileMetrics)
    ? opts.fileMetrics
    : fileMetricsFor(root, walkFn);

  // 2. Build the single context the catalogue reads, then run the registry.
  //    The diff-derived security evidence is folded in here — an explicitly
  //    injected `config.securityChangedFiles` still wins (test seam).
  const gateConfig = changeEvidence && changeEvidence.available && !config.securityChangedFiles
    ? { ...config, securityChangedFiles: changeEvidence.securityChangedFiles }
    : config;
  const context = buildGateContext({
    insights, modules: model.modules, baseline, changedSet, fileMetrics, config: gateConfig,
  });
  const registry = await buildDefaultRegistry();
  const run = runFitness(registry, context);
  // WF-0073 (ENFORCES, ADR-0137 shadow): fold graph graded signals into the BOARD
  // set only, as OBSERVE_ONLY. influencingFindings() excludes OBSERVE_ONLY, so these
  // can never sway the verdict/CI while the graph is regex-tier. Fail-open.
  let graphGraded = [];
  try { graphGraded = gradedGraphSignals(collectGradedSignals(root)); } catch { graphGraded = []; }
  const allFindings = [...run.findings, ...graphGraded];
  // ENFORCEMENT POSTURE (OP-0012): resolve each dimension's real authority before
  // the verdict. `guarded` (default) keeps the declared authority — so the twelve
  // dimensions genuinely block; `advisory` demotes everything to observation.
  // Line count can never be promoted, in any posture (ADR-0143).
  // `enabled:false` is the documented master switch and was previously INERT (the
  // gate ran and blocked regardless). It now resolves to the `advisory` posture:
  // every finding still reaches the board, nothing blocks. Honest off-switch —
  // never a silent "PASS" claim, because the findings remain visible.
  const posture = config.enabled === false
    ? 'advisory'
    : (typeof config.enforcement === 'string' ? config.enforcement : 'guarded');
  const governed = applyEnforcementPosture(influencingFindings(run), {
    posture, authorities: config.floorAuthorities,
  });

  // 3. Baseline ratchet — scope to the changed set (unchanged legacy never blocks).
  //    NOTE the two DISTINCT baselines that used to be conflated: `baseline` is the
  //    GRAPH baseline (cycles/forbiddenEdges/stateAuthorities) that F1/F2/F3 evaluate
  //    against; the ratchet needs a FINDINGS list. Passing the graph baseline here
  //    made `.findings` always undefined ⇒ every finding looked INTRODUCED and
  //    DEBT_REDUCED was unreachable. The prior run's persisted findings are the
  //    honest findings baseline.
  const findingsBaseline = resolveFindingsBaseline(opts, baseline);
  const classified = classifyAgainstBaseline(governed, findingsBaseline);
  const ratcheted = applyRatchet(classified, { changedSet });
  // Repayment entries are neutralised to PASS: a debt that was FIXED must not keep
  // voting with its stale VIOLATION/UNKNOWN status (see verdictFindingsFrom).
  const scopedFindings = verdictFindingsFrom(ratcheted);
  const positive = positiveEvidence(classified);

  // 4. The single whole-gate verdict (the one CI consumes). Unconfigured
  //    baseline-relative analyzers degrade to DISABLED→SKIPPED (§12) — not a
  //    blocking UNKNOWN — so a clean tree with nothing wired PASSes (§34.28/29),
  //    while a STALE-but-configured baseline still surfaces UNKNOWN (§34.22).
  //    `config.ruleModes` is now honoured (§12): it was resolved but never read.
  const ruleModes = degradeUnconfigured(baseline, config, {
    ...(config.ruleModes && typeof config.ruleModes === 'object' ? config.ruleModes : {}),
    ...(opts.ruleModes && typeof opts.ruleModes === 'object' ? opts.ruleModes : {}),
  });
  const policy = evaluatePolicy(scopedFindings, ruleModes);

  // 5. Persist the facts + render the board + the human report.
  const baseStore = opts.storePath ? readStore(opts.storePath) : emptyStore();
  const merged = upsertFindings(baseStore, allFindings, fileCount);
  const store = { ...merged, outcome: policy.outcome, blockingRuleIds: policy.blocking.map((f) => f.ruleId) };
  if (opts.storePath) writeStore(opts.storePath, store);
  const board = toBoard(store);

  const blockCi = !isApproval(policy.outcome) || ciShouldBlock(scopedFindings);
  const report = renderReport({
    outcome: policy.outcome,
    blocking: policy.blocking,
    review: policy.review,
    advisory: policy.advisory,
    positive,
    reasons: policy.reasons,
    skipped: run.skipped,
    fileCount,
  });

  return {
    outcome: policy.outcome,
    store, board, report,
    exitCode: blockCi ? 1 : 0,
    blocking: policy.blocking, review: policy.review, advisory: policy.advisory,
    positive, reasons: policy.reasons, skipped: run.skipped, fileCount,
  };
}

/**
 * CLI entry. `--ci` exits 1 iff the policy outcome is non-passing (or any
 * BLOCKING VIOLATION). ACTIVE: wired into `npm run ci` / `npm run ci:fast`
 * (package.json) and the installed-project `quality.yml` workflow.
 */
async function main() {
  const args = process.argv.slice(2);
  // The SINGLE config authority: resolve the gate slices from contextkit/config.json
  // (migrating the deprecated l5.lineBudget alias onto the advisory lineSignals).
  const root = process.cwd();
  const resolved = resolveArchDebtConfig(loadConfigSync(root));
  if (resolved.deprecationNotice) {
    process.stderr.write(`[arch-debt] ${resolved.deprecationNotice}\n`);
  }
  // Persist into the ONE findings store (decisions.md Fork-1). The CLI previously
  // omitted `storePath`, so step 5 of this engine's contract never ran: the store
  // and board were never updated by a gate run, AND the ratchet had no prior
  // findings to compare against (making DEBT_REDUCED unreachable). Fail-soft: a
  // memory dir that cannot be resolved degrades to in-memory only.
  let storePath = null;
  try {
    storePath = resolve(pathsFor(root).memory, 'tech-debt-findings.json');
  } catch {
    storePath = null;
  }
  // `conformanceBaseline` is null until the project wires layerRules/ownership —
  // then F1/F2/F3 EVALUATE against it (empty by default: the current tree is the
  // conformant baseline, so a regression blocks and nothing pre-existing is faked
  // as "new"). Null keeps the floors SKIPPED, never a blocking UNKNOWN (§34.28/29).
  const result = await runGate({
    root, config: resolved, baseline: resolved.conformanceBaseline, storePath,
  });
  process.stdout.write(result.report);
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({ outcome: result.outcome, blockingRuleIds: result.store.blockingRuleIds }, null, 2) + '\n');
  }
  if (args.includes('--ci')) {
    if (result.exitCode !== 0) {
      console.error(`\n✗ architecture-debt gate: outcome ${result.outcome} (non-passing).`);
      process.exit(1);
    }
    console.log(`\n✓ architecture-debt gate: outcome ${result.outcome} (passing).`);
  }
}

import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((err) => {
    console.error('architecture-debt-gate failed:', err?.message ?? err);
    process.exit(1);
  });
}
