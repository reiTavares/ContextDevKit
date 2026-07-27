/**
 * In-process self-test for the WF-0086 IN2 plane-wide governance measurement
 * (`economics/governance-north-star.mjs`; BIZ-0006, ADR-0148 §13).
 *
 * Zero disk I/O and zero model calls: the ledger reader takes an injected
 * `readEvents` seam and the corpus counter takes injected `roots` + `readState`.
 * What it proves:
 *   [a] resource classification  — the 4 observable levers are EXCLUDED from
 *                                  governance spend (folding a saving into a spend
 *                                  measurement would make the guardrail unfalsifiable)
 *   [b] ledger reader            — per-session totals, prior-session baseline in
 *                                  ledger-append order, and every fail-open branch
 *   [c] the HARD guardrail       — a rising series FAILS and blocks promotion; flat
 *                                  and falling pass; unavailable is `skipped` and
 *                                  never behaves as a pass
 *   [d] concluded-context count  — state authority decides, never placement
 *   [e] north-star               — baseline/target stay null; a missing numerator
 *                                  or denominator yields `available:false`, never a
 *                                  flattering zero
 *   [f] no-llm-to-decide         — asserted statically over the module source
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GOVERNANCE_CATEGORIES,
  GOVERNANCE_RESOURCES,
  readGovernanceTokenSeries,
  countConcludedContexts,
  evaluateGovernanceTokenGuardrail,
  northStarReading,
  presentGovernanceNorthStar,
} from './governance-north-star.mjs';
import { ECONOMY_CATEGORIES, ECONOMY_LEVERS } from '../economy/registry.mjs';

const failures = [];
const assert = (label, condition) => {
  if (condition) process.stdout.write(`  ok  ${label}\n`);
  else { failures.push(label); process.stdout.write(`  BAD ${label}\n`); }
};

const ROOT = 'D:/synthetic-root';
const row = (lever, sessionId, tokens) => ({ lever, sessionId, observed: { tokens } });
const series = (rows) => readGovernanceTokenSeries(ROOT, { sessionId: 'self', readEvents: () => rows });

// ── [a] resource classification ──────────────────────────────────────────────
for (const lever of ECONOMY_LEVERS) {
  assert(`[a] observable lever "${lever}" is NOT counted as governance spend`,
    !GOVERNANCE_RESOURCES.includes(lever));
}
// The allow-list must stay exhaustive against the registry: GOVERNANCE_CATEGORIES
// plus 'lever' has to cover ECONOMY_CATEGORIES exactly. A category added later
// fails HERE, forcing someone to classify it on purpose, instead of being silently
// absorbed (a `!== 'lever'` filter would widen the denominator) or silently
// dropped (an allow-list alone would narrow it — the unsafe direction for a
// guardrail, since a smaller denominator flatters the north-star).
assert('[a] GOVERNANCE_CATEGORIES + lever covers every ECONOMY_CATEGORIES member exactly',
  (() => {
    const classified = new Set([...GOVERNANCE_CATEGORIES, 'lever']);
    return classified.size === ECONOMY_CATEGORIES.length
      && ECONOMY_CATEGORIES.every((category) => classified.has(category));
  })());
assert('[a] no category is both governance spend and an observable lever',
  !GOVERNANCE_CATEGORIES.includes('lever'));
assert('[a] content-fill IS governance spend (the engine spends tokens)',
  GOVERNANCE_RESOURCES.includes('content-fill'));
assert('[a] lifecycle/advisory resources are governance spend (dev-start, context-pack)',
  GOVERNANCE_RESOURCES.includes('dev-start') && GOVERNANCE_RESOURCES.includes('context-pack'));

// ── [b] ledger reader ────────────────────────────────────────────────────────
assert('[b] no root ⇒ unavailable with a reason, never a zero that reads as cheap',
  (() => { const r = readGovernanceTokenSeries('', { sessionId: 'self' }); return r.available === false && typeof r.reason === 'string' && r.sessionTokens === null; })());
assert('[b] an unreadable ledger fails open to unavailable + reason',
  (() => { const r = readGovernanceTokenSeries(ROOT, { sessionId: 'self', readEvents: () => { throw new Error('boom'); } }); return r.available === false && /unreadable/.test(r.reason); })());
assert('[b] a ledger with no governance rows is unavailable (nothing measured yet)',
  (() => { const r = series([row('project-map', 'self', 999)]); return r.available === false && /no governance rows/.test(r.reason); })());
assert('[b] a non-array ledger payload fails open rather than throwing',
  readGovernanceTokenSeries(ROOT, { sessionId: 'self', readEvents: () => null }).available === false);
// `options.sessionId ?? process.env.CLAUDE_CODE_SESSION_ID` (the convention
// `token-guardrail.mjs` established) means an explicit `null` reads as "not
// supplied" and defers to the environment — so the no-session branch is only
// reachable with the env var genuinely absent. Clear it around the assertion
// rather than weakening the module's contract.
assert('[b] no session id ⇒ unavailable (cannot scope a per-session comparison)',
  (() => {
    const saved = process.env.CLAUDE_CODE_SESSION_ID;
    delete process.env.CLAUDE_CODE_SESSION_ID;
    try {
      const r = readGovernanceTokenSeries(ROOT, { readEvents: () => [row('dev-start', 'a', 10)] });
      return r.available === false && /no session id/.test(r.reason);
    } finally {
      if (saved !== undefined) process.env.CLAUDE_CODE_SESSION_ID = saved;
    }
  })());
assert('[b] an explicit sessionId overrides the environment',
  series([row('dev-start', 'self', 3), row('dev-start', 'a', 9)]).sessionTokens === 3);
assert('[b] only this session in the ledger ⇒ unavailable (a baseline is required)',
  (() => { const r = series([row('dev-start', 'self', 10)]); return r.available === false && /no prior session/.test(r.reason) && r.sessionTokens === 10; })());
assert('[b] per-session totals sum every governance row for that session',
  (() => { const r = series([row('dev-start', 'self', 10), row('context-pack', 'self', 5), row('dev-start', 'a', 100)]); return r.available === true && r.sessionTokens === 15; })());
assert('[b] the prior session is the LAST DISTINCT session in append order',
  (() => { const r = series([row('dev-start', 'a', 100), row('dev-start', 'b', 7), row('dev-start', 'self', 1)]); return r.priorSessionTokens === 7; })());
// D1 (pre-merge review, CONFIRMED on the real dogfood ledger: 558 governance rows,
// zero carrying observed.tokens, yet the guardrail returned pass "0 → 0"). An
// UNMEASURED row must never become an authoritative-looking zero: that makes
// "nothing was measured" indistinguishable from "measured, and it cost nothing",
// and a HARD guardrail then reports green from no evidence (constitution §8).
// An earlier revision of this suite pinned the opposite ("contributes 0, never
// NaN") — it blessed the defect, so it is replaced rather than kept.
assert('[b] D1 rows present but NONE measured ⇒ unavailable, never a measured zero',
  (() => {
    const r = series([{ lever: 'dev-start', sessionId: 'self' }, { lever: 'dev-start', sessionId: 'a' }]);
    return r.available === false && /none carries an observed token measurement/.test(r.reason);
  })());
assert('[b] D1 an unmeasured row does not contribute 0 to its session total',
  (() => { const r = series([{ lever: 'dev-start', sessionId: 'self' }, row('dev-start', 'a', 4)]); return r.available === false && r.sessionTokens === null && r.totalTokens === 4; })());
assert('[b] D1 this session unmeasured while prior IS measured ⇒ unavailable, not a phantom fall',
  (() => {
    const r = series([row('dev-start', 'a', 500), { lever: 'dev-start', sessionId: 'self' }]);
    return r.available === false && /both sides measured/.test(r.reason);
  })());
assert('[b] D1 a negative or non-finite observed.tokens is unusable, not zero',
  (() => {
    const r = series([{ lever: 'dev-start', sessionId: 'self', observed: { tokens: -5 } }, { lever: 'dev-start', sessionId: 'a', observed: { tokens: NaN } }]);
    return r.available === false && /none carries an observed token measurement/.test(r.reason);
  })());
assert('[b] totalTokens counts governance spend across ALL sessions',
  series([row('dev-start', 'a', 30), row('dev-start', 'self', 12)]).totalTokens === 42);
assert('[b] rows with no session id still count toward totalTokens but not a session',
  (() => { const r = series([{ lever: 'dev-start', observed: { tokens: 9 } }, row('dev-start', 'a', 1), row('dev-start', 'self', 2)]); return r.totalTokens === 12 && r.sessionTokens === 2; })());

// ── [c] the HARD guardrail (ADR-0148 §13) ────────────────────────────────────
const avail = (sessionTokens, priorSessionTokens) => ({ available: true, sessionTokens, priorSessionTokens, totalTokens: sessionTokens + priorSessionTokens });
assert('[c] a RISING series fails and blocks promotion',
  (() => { const g = evaluateGovernanceTokenGuardrail(avail(120, 100)); return g.status === 'fail' && g.risen === true && g.delta === 20 && g.blocksPromotion === true; })());
assert('[c] a FLAT series passes (must not rise — equal is not a rise)',
  (() => { const g = evaluateGovernanceTokenGuardrail(avail(100, 100)); return g.status === 'pass' && g.risen === false && g.blocksPromotion === false; })());
assert('[c] a FALLING series passes with a negative delta',
  (() => { const g = evaluateGovernanceTokenGuardrail(avail(80, 100)); return g.status === 'pass' && g.delta === -20; })());
for (const unavailable of [null, undefined, { available: false, reason: 'nothing measured' }]) {
  const g = evaluateGovernanceTokenGuardrail(unavailable);
  assert(`[c] an unavailable measurement is "skipped", never "pass" (${JSON.stringify(unavailable)})`,
    g.status === 'skipped' && g.status !== 'pass' && g.risen === null && g.delta === null);
  assert(`[c] a skipped guardrail does not block promotion by itself (${JSON.stringify(unavailable)})`,
    g.blocksPromotion === false);
}

// D2 (pre-merge review, CONFIRMED): every corrupt reading fell through to `pass`,
// because `Number(null)` is 0 and `NaN > 0` is false. The sibling
// `token-guardrail.mjs` hardens exactly this; this module had inherited the shape
// without the guard. An unusable measurement must be `skipped`, never a verdict.
for (const [session, prior] of [
  [NaN, 100], [Infinity, Infinity], [-500, 100], [{}, 1], ['900', '500'],
  [null, 500], [900, null], [undefined, 10], [10, undefined], ['abc', 5],
]) {
  const g = evaluateGovernanceTokenGuardrail({ available: true, sessionTokens: session, priorSessionTokens: prior, totalTokens: 1 });
  assert(`[c] D2 an unusable measurement is skipped, never a verdict (${JSON.stringify(session)} / ${JSON.stringify(prior)})`,
    g.status === 'skipped' && g.delta === null && g.risen === null && g.blocksPromotion === false);
}
assert('[c] D2 a numeric-looking STRING does not coerce into a comparison',
  evaluateGovernanceTokenGuardrail({ available: true, sessionTokens: '900', priorSessionTokens: '500', totalTokens: 1 }).status === 'skipped');
assert('[c] D2 a legitimate zero-to-zero reading still passes (0 is measurable)',
  evaluateGovernanceTokenGuardrail(avail(0, 0)).status === 'pass');

// ── [d] concluded-context count — state authority, never placement ───────────
/**
 * Build a synthetic corpus. `states` maps a workflow dir name to the parsed
 * `workflow-state.json` it should return (or `undefined` for "no state file").
 * The root dir name deliberately includes `done` so a placement-trusting
 * implementation would over-count and fail these assertions.
 */
const corpus = (states, dir = '/corpus/done') => countConcludedContexts(ROOT, {
  roots: [dir],
  exists: (path) => {
    const norm = String(path).replace(/\\/g, '/');
    if (norm === dir) return true;
    const name = norm.slice(dir.length + 1).replace(/\/workflow-state\.json$/, '');
    return Object.prototype.hasOwnProperty.call(states, name) && states[name] !== undefined;
  },
  listDirs: () => Object.keys(states),
  readState: (path) => states[String(path).replace(/\\/g, '/').slice(dir.length + 1).replace(/\/workflow-state\.json$/, '')],
});

assert('[d] no workflow states ⇒ unavailable, not a zero that reads as measured',
  (() => { const c = corpus({}); return c.available === false && /no workflow states/.test(c.reason); })());
assert('[d] unresolvable corpus roots fail open',
  countConcludedContexts(ROOT, { roots: [] }).available === false);
assert('[d] a `done` state counts',
  (() => { const c = corpus({ 'WF-1': { overallStatus: 'done' } }); return c.available === true && c.concluded === 1 && c.scanned === 1; })());
assert('[d] the BIZ-0004 drift shape — filed under done/ but state says not-started — does NOT count',
  (() => { const c = corpus({ 'WF-1': { overallStatus: 'not-started' } }); return c.available === true && c.concluded === 0 && c.scanned === 1; })());
assert('[d] state authority decides: 2 of 3 done under a done/ root counts 2, not 3',
  (() => {
    const c = corpus({ 'WF-1': { overallStatus: 'done' }, 'WF-2': { overallStatus: 'not-started' }, 'WF-3': { overallStatus: 'done' } });
    return c.concluded === 2 && c.scanned === 3;
  })());
assert('[d] a dir with no workflow-state.json is not scanned and not counted',
  (() => { const c = corpus({ 'WF-1': { overallStatus: 'done' }, 'WF-nostate': undefined }); return c.concluded === 1 && c.scanned === 1; })());
assert('[d] an unreadable/corrupt state is NOT a conclusion and never throws',
  (() => {
    const c = countConcludedContexts(ROOT, {
      roots: ['/corpus/done'],
      exists: () => true,
      listDirs: () => ['WF-bad'],
      readState: () => { throw new Error('corrupt json'); },
    });
    return c.available === true && c.concluded === 0 && c.scanned === 1;
  })());
// D3 (pre-merge review, CONFIRMED): a repeated corpus root counted the same pack
// twice and inflated the numerator, which flatters the north-star. Latent on the
// seam today (`workflowCorpusRoots` emits distinct paths) — pinned so it stays that
// way if the seam ever changes.
assert('[d] D3 duplicate corpus roots do not double-count a pack',
  (() => {
    const c = countConcludedContexts(ROOT, {
      roots: ['/corpus/done', '/corpus/done'], exists: () => true,
      listDirs: () => ['WF-1'], readState: () => ({ overallStatus: 'done' }),
    });
    return c.concluded === 1 && c.scanned === 1;
  })());
assert('[d] a listDirs failure fails open rather than throwing',
  (() => {
    const c = countConcludedContexts(ROOT, {
      roots: ['/corpus/done'], exists: () => true,
      listDirs: () => { throw new Error('EACCES'); }, readState: () => ({ overallStatus: 'done' }),
    });
    return c.available === false && c.concluded === 0;
  })());

// ── [e] north-star ───────────────────────────────────────────────────────────
const ctx = (concluded, available = true) => ({ available, concluded, scanned: concluded, reason: available ? null : 'no workflow states found in the corpus' });
assert('[e] baseline and target are ALWAYS null (measured, never asserted)',
  (() => { const n = northStarReading(avail(10, 10), ctx(4)); return n.baseline === null && n.target === null; })());
assert('[e] a missing numerator ⇒ unavailable with a reason',
  (() => { const n = northStarReading(avail(10, 10), ctx(0, false)); return n.available === false && n.concludedPerThousandTokens === null; })());
assert('[e] a zero denominator ⇒ unavailable, never a flattering ratio',
  (() => { const n = northStarReading({ available: false, totalTokens: 0, reason: 'nothing measured yet' }, ctx(9)); return n.available === false && n.governanceTokens === null && n.concludedPerThousandTokens === null; })());
assert('[e] the ratio is concluded contexts per 1k governance tokens',
  (() => { const n = northStarReading({ available: true, totalTokens: 2000, sessionTokens: 1, priorSessionTokens: 1 }, ctx(4)); return n.available === true && n.concludedPerThousandTokens === 2 && n.governanceTokens === 2000; })());
assert('[e] the metric name is stated, not inferred by the caller',
  northStarReading(avail(1, 1), ctx(1)).metric === 'concluded work contexts per 1k governance tokens');

// ── presentation — honest when absent ────────────────────────────────────────
const skippedText = presentGovernanceNorthStar(
  northStarReading({ available: false, totalTokens: 0, reason: 'nothing measured yet' }, ctx(0, false)),
  evaluateGovernanceTokenGuardrail(null),
);
assert('[e] the rendered skipped reading says "skipped" and shows baseline/target null',
  /skipped/.test(skippedText) && /baseline null/.test(skippedText));
assert('[c] the rendered failing reading announces the promotion block',
  /promotion is blocked/.test(presentGovernanceNorthStar(northStarReading(avail(120, 100), ctx(1)), evaluateGovernanceTokenGuardrail(avail(120, 100)))));

// ── [f] no-llm-to-decide, asserted statically ────────────────────────────────
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'governance-north-star.mjs'), 'utf-8');
assert('[f] the module imports no content/LLM engine — every decision is a comparison',
  !/content-fill\.mjs|content-grounding\.mjs|anthropic|openai/i.test(source));
assert('[f] the module performs no network call',
  !/\bfetch\(|node:https?\b|require\('https?'\)/.test(source));

process.stdout.write(failures.length === 0 ? '\nPASSED\n' : `\nFAILED (${failures.length})\n`);
process.exit(failures.length === 0 ? 0 : 1);
