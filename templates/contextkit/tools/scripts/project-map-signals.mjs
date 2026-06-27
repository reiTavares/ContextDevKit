/**
 * Project-map STRUCTURAL SIGNALS — the GRAPH_DERIVED / HISTORY_DERIVED public
 * contract the Architecture & Technical-Debt Gate (WF-0057) reads instead of
 * scraping the private manifest. [WF-0057 W1.1 · ADR-0122]
 *
 * Pure functions over the EXISTING edge model (`module.deps`) — no second graph,
 * no clock, no I/O on the graph signals. The single history signal (`coChange`)
 * is HISTORY_DERIVED and DEGRADABLE: it takes an INJECTED git-log reader so the
 * module stays pure/testable, and it returns an explicit `{ available:false,
 * reason }` whenever git is absent or history is too shallow — it NEVER fabricates
 * a zero (W0-contracts §16: UNKNOWN/SKIPPED ≠ PASS).
 *
 * Sibling of `project-map-insights.mjs` (cycles/orphans/oversized) — split out so
 * neither file exceeds the line budget and the gate has one clearly-named import
 * surface. Everything is sorted/normalized so the committed manifest stays
 * churn-free (ADR-0039/0046). [project-map]
 */

/** Evidence class for the per-module graph signals (W0-contracts §2, class #3). */
export const GRAPH_EVIDENCE_CLASS = 'GRAPH_DERIVED';
/** Evidence class for the co-change signal (W0-contracts §2, class #6). */
export const HISTORY_EVIDENCE_CLASS = 'HISTORY_DERIVED';

/** Build `path → [dep paths]` from the model (only edges to mapped modules). */
function adjacency(modules) {
  const known = new Set((modules || []).map((m) => m.path));
  const out = new Map();
  for (const m of modules || []) {
    out.set(m.path, (m.deps || []).filter((d) => known.has(d) && d !== m.path));
  }
  return out;
}

/** Reverse adjacency `path → [importer paths]` (who depends on this module). */
function importers(adj) {
  const rev = new Map();
  for (const path of adj.keys()) rev.set(path, []);
  for (const [from, deps] of adj) {
    for (const dep of deps) if (rev.has(dep)) rev.get(dep).push(from);
  }
  for (const list of rev.values()) list.sort();
  return rev;
}

/**
 * Transitive importer set for one module — the blast radius if it changes.
 * Cycle-safe (visited set) and bounded by the module count, so a dependency cycle
 * can never loop forever. The starting module is excluded from its own radius.
 *
 * @param {string} start module path to measure from
 * @param {Map<string,string[]>} rev reverse adjacency (importers per module)
 * @returns {string[]} sorted transitive importers (the blast radius set)
 */
function transitiveImporters(start, rev) {
  const seen = new Set();
  const stack = [start];
  while (stack.length) {
    const node = stack.pop();
    for (const up of rev.get(node) || []) {
      if (!seen.has(up)) {
        seen.add(up);
        stack.push(up);
      }
    }
  }
  seen.delete(start); // a module is never in its own blast radius
  return [...seen].sort();
}

/**
 * Per-module structural signals derived from the EXISTING edge model — all
 * GRAPH_DERIVED, all deterministic:
 *   - `fanIn`        importer count (how many modules depend on this one)
 *   - `fanOut`       import count  (how many modules this one depends on)
 *   - `instability`  fanOut / (fanIn + fanOut), 0..1 (Martin's I-metric). The
 *                    0/0 case (an isolated module, no edges either way) is defined
 *                    as 0 — maximally stable, nothing depends on it changing.
 *   - `blastRadius`  size of the transitive importer set (cycle-safe traversal).
 *
 * @param {Array<{path:string, deps?:string[]}>} modules the project-map model modules
 * @returns {{perModule: Record<string, {fanIn:number, fanOut:number, instability:number, blastRadius:number}>, evidenceClass: string}}
 */
export function structuralSignals(modules) {
  const adj = adjacency(modules);
  const rev = importers(adj);
  const perModule = {};
  for (const path of [...adj.keys()].sort()) {
    const fanOut = (adj.get(path) || []).length;
    const fanIn = (rev.get(path) || []).length;
    const total = fanIn + fanOut;
    const instability = total === 0 ? 0 : fanOut / total;
    perModule[path] = {
      fanIn,
      fanOut,
      instability,
      blastRadius: transitiveImporters(path, rev).length,
    };
  }
  return { perModule, evidenceClass: GRAPH_EVIDENCE_CLASS };
}

/**
 * Default minimum number of commits required before co-change is trustworthy.
 * Below this the history is "shallow" and the signal degrades rather than emit a
 * misleadingly-confident pairing from one or two commits.
 */
const MIN_COMMITS_FOR_COCHANGE = 5;

/**
 * Co-change clusters (HISTORY_DERIVED, DEGRADABLE) — pairs of files that tend to
 * change together, derived from recent git history. The git access is INJECTED as
 * `readGitLog()` (returns commit groups: an array of arrays of changed file paths,
 * or `null`/`[]` when git is unavailable) so this stays a pure, testable function
 * and the host owns the actual `git log` spawn.
 *
 * DEGRADATION CONTRACT (W0-contracts §16 — never fabricate): when git is absent,
 * errors, or history is shallower than `minCommits`, returns
 * `{ available:false, reason, evidenceClass }`. A consumer MUST map that to
 * UNKNOWN/SKIPPED, never to a silent zero or PASS.
 *
 * @param {() => (string[][]|null)} readGitLog injected reader: commit → changed files
 * @param {{minCommits?:number, minPairCount?:number}} [opts]
 * @returns {{available:false, reason:string, evidenceClass:string}
 *   | {available:true, pairs:Array<{files:[string,string], count:number}>, commits:number, evidenceClass:string}}
 */
export function coChange(readGitLog, opts = {}) {
  const minCommits = opts.minCommits ?? MIN_COMMITS_FOR_COCHANGE;
  const minPairCount = opts.minPairCount ?? 2;
  const evidenceClass = HISTORY_EVIDENCE_CLASS;

  if (typeof readGitLog !== 'function') {
    return { available: false, reason: 'no git-log reader provided', evidenceClass };
  }
  let commits;
  try {
    commits = readGitLog();
  } catch (err) {
    return { available: false, reason: `git log failed: ${err?.message ?? err}`, evidenceClass };
  }
  if (!Array.isArray(commits) || commits.length === 0) {
    return { available: false, reason: 'git history unavailable', evidenceClass };
  }
  if (commits.length < minCommits) {
    return {
      available: false,
      reason: `history too shallow (${commits.length} < ${minCommits} commits)`,
      evidenceClass,
    };
  }

  const counts = new Map();
  for (const group of commits) {
    const files = [...new Set((group || []).filter((f) => typeof f === 'string' && f))].sort();
    for (let i = 0; i < files.length; i += 1) {
      for (let j = i + 1; j < files.length; j += 1) {
        const key = `${files[i]} ${files[j]}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }
  const pairs = [...counts.entries()]
    .filter(([, count]) => count >= minPairCount)
    .map(([key, count]) => ({ files: /** @type {[string,string]} */ (key.split(' ')), count }))
    .sort((a, b) => b.count - a.count || a.files[0].localeCompare(b.files[0]) || a.files[1].localeCompare(b.files[1]));

  return { available: true, pairs, commits: commits.length, evidenceClass };
}
