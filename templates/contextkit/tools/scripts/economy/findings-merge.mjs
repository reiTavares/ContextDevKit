/**
 * findings-merge.mjs — Multi-agent findings merge pipeline for Economy Runtime
 * (WF0020, CDK-255 ECON-02).
 *
 * Public surface:
 *   mergeFindings(findingArrays, contract?) → { artifact, backlog, digest }
 *   econCheckFindingsMerge(root)            → { name, pass, detail }[]  (CI gate)
 *
 * Optional CLI:
 *   node findings-merge.mjs <a.json> <b.json> ...
 *   Prints the digest object to stdout as JSON.
 *
 * Design notes:
 *   - COMPOSES WITH the ADR-0044 attribution ledger: the `agent` field on each
 *     finding is the join key. This file does NOT write to any ledger.
 *   - Advisory + fail-open: missing/malformed inputs produce empty results,
 *     never a false pass or an unhandled exception.
 *   - Zero runtime dependencies — node:fs, node:path, node:url only.
 *   - Pure merge/dedup logic lives in findings-merge-core.mjs (constitution §1).
 *
 * Cohesion note: digest build + CI gate + CLI are kept here (not in core) so
 * that findings-merge-core.mjs stays a pure function module with no I/O surface.
 */

import { readFileSync }                               from 'node:fs';
import { resolve, dirname }                           from 'node:path';
import { fileURLToPath }                              from 'node:url';
import { ECONOMY_DEFAULTS }                           from './economy-defaults.mjs';
import { applyFindingCaps }                           from './output-contract.mjs';
import { deduplicateFindings, sortFindings, extractBacklog }
                                                      from './findings-merge-core.mjs';
import { SEVERITY_ORDER }                             from './findings.mjs';

// ---------------------------------------------------------------------------
// mergeFindings
// ---------------------------------------------------------------------------

/**
 * Merges N finding arrays from different agents into a single structured result.
 *
 * @param {Array<object[]>} findingArrays  - One array per agent/source
 * @param {typeof ECONOMY_DEFAULTS['output']} [contract]  - Output contract (defaults applied)
 * @returns {{
 *   artifact : object[],
 *   backlog  : object[],
 *   digest   : {
 *     kept     : object[],
 *     deferred : object[],
 *     counts   : {
 *       total        : number,
 *       bySeverity   : Record<string, number>,
 *       keptCount    : number,
 *       deferredCount: number
 *     }
 *   }
 * }}
 */
export function mergeFindings(findingArrays, contract = ECONOMY_DEFAULTS.output) {
  // Fail-open: accept anything iterable; skip non-arrays silently.
  const safeArrays = Array.isArray(findingArrays) ? findingArrays : [];

  // Step 1: dedup by fingerprint (highest confidence wins on collision).
  const deduped = deduplicateFindings(safeArrays);

  // Step 2: sort — severity then path then line.
  const artifact = sortFindings(deduped);

  // Step 3: actionable backlog (open + non-empty action).
  const backlog = extractBacklog(artifact);

  // Step 4: lossless-by-severity digest via the shared invariant.
  // applyFindingCaps keeps ALL critical/high + ALL skipped; caps medium/low prose.
  const digest = applyFindingCaps(artifact, contract);

  return { artifact, backlog, digest };
}

// ---------------------------------------------------------------------------
// CI check export
// ---------------------------------------------------------------------------

/**
 * Self-check suite for the findings merge module.
 * Pure and fail-open: every assertion is caught individually.
 * Called by the wave selfcheck runner with the repo root path.
 *
 * QA regression scenario (spec):
 *   Input: 10 findings — 3 high (open), 1 skipped low, 6 open low
 *   Contract: maxFindings.low = 2
 *   Expected after merge:
 *     - digest.kept contains all 3 highs + the skipped low (4 items minimum)
 *     - deferred lows are resolvable in artifact (artifact.length = 10 deduplicated)
 *     - counts.total === 10
 *     - Two identical findings (same fingerprint) deduplicate to one in artifact
 *
 * @param {string} _root - Repo root (unused; present for runner signature parity)
 * @returns {{ name: string, pass: boolean, detail: string }[]}
 */
export function econCheckFindingsMerge(_root) {
  const results = [];

  /** @param {string} name @param {()=>void} fn */
  function check(name, fn) {
    try {
      fn();
      results.push({ name, pass: true, detail: 'ok' });
    } catch (err) {
      results.push({ name, pass: false, detail: err?.message ?? String(err) });
    }
  }

  /** @param {boolean} cond @param {string} msg */
  function assert(cond, msg) {
    if (!cond) throw new Error(msg);
  }

  // Shared test data ─────────────────────────────────────────────────────────

  /** Builds a minimal valid finding. @param {Partial<object>} overrides */
  const mkFinding = (overrides) => ({
    id:         'f-default',
    severity:   'low',
    path:       'src/foo.mjs',
    line:       10,
    claim:      'default claim',
    evidence:   '',
    action:     'fix it',
    confidence: 0.8,
    status:     'open',
    agent:      'agent-a',
    ...overrides,
  });

  const CONTRACT_LOW2 = {
    maxFindings: { critical: null, high: null, medium: 8, low: 2 },
  };

  // Regression inputs ────────────────────────────────────────────────────────

  const highs = [
    mkFinding({ id: 'h1', severity: 'high', path: 'a.mjs', line: 1, claim: 'high finding 1', evidence: 'snippet:a.mjs:1', agent: 'agent-a' }),
    mkFinding({ id: 'h2', severity: 'high', path: 'b.mjs', line: 2, claim: 'high finding 2', evidence: 'snippet:b.mjs:2', agent: 'agent-a' }),
    mkFinding({ id: 'h3', severity: 'high', path: 'c.mjs', line: 3, claim: 'high finding 3', evidence: 'snippet:c.mjs:3', agent: 'agent-b' }),
  ];

  const skippedLow = mkFinding({
    id: 'sl1', severity: 'low', path: 'd.mjs', line: 4,
    claim: 'skipped low', action: '', status: 'skipped', agent: 'agent-a',
  });

  const openLows = Array.from({ length: 6 }, (_, i) =>
    mkFinding({
      id: `ol${i + 1}`, severity: 'low', path: `e${i}.mjs`, line: i + 10,
      claim: `open low ${i + 1}`, agent: 'agent-b',
    })
  );

  // A duplicate of h1 — same (severity, path, line, claim), lower confidence.
  const h1Duplicate = mkFinding({
    id: 'h1-dup', severity: 'high', path: 'a.mjs', line: 1,
    claim: 'high finding 1', evidence: 'same defect, different agent',
    confidence: 0.5, agent: 'agent-b',
  });

  // Ten unique findings (highs + skippedLow + openLows).
  const tenFindings = [...highs, skippedLow, ...openLows];

  // ─────────────────────────────────────────────────────────────────────────
  // Check 1: counts.total === 10 after merging the 10-finding set.
  check('merge 10 findings: counts.total === 10', () => {
    const { digest } = mergeFindings([tenFindings], CONTRACT_LOW2);
    assert(digest.counts.total === 10, `expected total 10, got ${digest.counts.total}`);
  });

  // Check 2: digest.kept contains all 3 highs.
  check('merge 10 findings: all 3 highs in digest.kept', () => {
    const { digest } = mergeFindings([tenFindings], CONTRACT_LOW2);
    const keptHighs = digest.kept.filter((f) => f.severity === 'high');
    assert(keptHighs.length === 3, `expected 3 highs kept, got ${keptHighs.length}`);
  });

  // Check 3: digest.kept contains the skipped low.
  check('merge 10 findings: skipped low in digest.kept', () => {
    const { digest } = mergeFindings([tenFindings], CONTRACT_LOW2);
    const keptSkipped = digest.kept.filter((f) => f.status === 'skipped');
    assert(keptSkipped.length === 1, `expected 1 skipped kept, got ${keptSkipped.length}`);
  });

  // Check 4: deferred open lows are resolvable in artifact (not lost).
  check('merge 10 findings: deferred lows resolvable in artifact', () => {
    const { artifact, digest } = mergeFindings([tenFindings], CONTRACT_LOW2);
    // With low cap=2: 2 open lows kept, 4 open lows deferred.
    assert(digest.deferred.length === 4, `expected 4 deferred, got ${digest.deferred.length}`);
    // Every deferred finding must appear in artifact.
    for (const def of digest.deferred) {
      const inArtifact = artifact.includes(def);
      assert(inArtifact, `deferred finding ${def.id} missing from artifact`);
    }
  });

  // Check 5: two identical findings (fingerprint collision) deduplicate to one.
  check('fingerprint collision: deduplicate to one in artifact', () => {
    // h1 and h1Duplicate share the same (severity, path, line, claim) → same fingerprint.
    // h1 has confidence 0.8, h1Duplicate has 0.5 → h1 must win.
    const { artifact } = mergeFindings([[...highs, skippedLow, ...openLows, h1Duplicate]], CONTRACT_LOW2);
    const h1Entries = artifact.filter(
      (f) => f.severity === 'high' && f.path === 'a.mjs' && f.claim === 'high finding 1'
    );
    assert(h1Entries.length === 1, `expected 1 entry for h1 fingerprint, got ${h1Entries.length}`);
    assert(h1Entries[0].id === 'h1', `expected winner id 'h1' (higher confidence), got '${h1Entries[0].id}'`);
  });

  // Check 6: artifact is sorted — all highs before lows.
  check('artifact is sorted severity-first', () => {
    const { artifact } = mergeFindings([tenFindings], CONTRACT_LOW2);
    let lastRank = -1;
    for (const f of artifact) {
      const rank = SEVERITY_ORDER.indexOf(f.severity);
      assert(rank >= lastRank, `sort order violated at finding ${f.id}: ${f.severity} after rank ${lastRank}`);
      lastRank = rank;
    }
  });

  // Check 7: backlog contains only open findings with non-empty action.
  check('backlog contains only open findings with action', () => {
    const { backlog } = mergeFindings([tenFindings], CONTRACT_LOW2);
    for (const f of backlog) {
      assert(f.status === 'open', `backlog item ${f.id} has status '${f.status}', expected 'open'`);
      assert(typeof f.action === 'string' && f.action.trim() !== '', `backlog item ${f.id} has empty action`);
    }
    // skippedLow has empty action and status 'skipped', must NOT be in backlog.
    const hasSkipped = backlog.some((f) => f.id === 'sl1');
    assert(!hasSkipped, 'skipped low must not appear in backlog');
  });

  // Check 8: fail-open — empty input returns empty artifact.
  check('fail-open: empty input returns empty artifact', () => {
    const { artifact, backlog, digest } = mergeFindings([], CONTRACT_LOW2);
    assert(artifact.length === 0, 'expected empty artifact');
    assert(backlog.length === 0, 'expected empty backlog');
    assert(digest.counts.total === 0, 'expected total 0');
  });

  return results;
}

// ---------------------------------------------------------------------------
// Optional CLI entry point
// ---------------------------------------------------------------------------

const _filename = fileURLToPath(import.meta.url);
const _isMain   = process.argv[1] && resolve(process.argv[1]) === resolve(_filename);

if (_isMain) {
  const files = process.argv.slice(2);

  if (files.length === 0) {
    process.stderr.write('Usage: node findings-merge.mjs <a.json> <b.json> ...\n');
    process.exit(1);
  }

  const arrays = files.map((filePath) => {
    try {
      const raw  = readFileSync(resolve(dirname(_filename), filePath), 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      process.stderr.write(`Warning: could not read ${filePath}: ${err.message}\n`);
      return [];
    }
  });

  const { digest } = mergeFindings(arrays);
  process.stdout.write(JSON.stringify(digest, null, 2) + '\n');
}
