/**
 * arch-debt-law.mjs — the TWELVE DIMENSIONS stated as LAW, delivered to the agent
 * BEFORE it writes code (OP-0012, ADR-0122 §9 + ADR-0143).
 *
 * WHY THIS EXISTS. The Architecture & Technical-Debt gate is a VERIFIER: it runs
 * after the diff exists and says yes or no. A verifier alone makes the process
 * slow and adversarial — the agent writes, the gate refuses, the agent reworks.
 * The cheap fix is upstream: state the standard BEFORE the first write, so the
 * diff arrives conformant and the gate only has to confirm it. This module is
 * that statement, single-sourced so the pre-write hook and the boot context can
 * never drift apart from each other or from the gate they describe.
 *
 * HONESTY CONTRACT. This text must describe what the gate ACTUALLY enforces, not
 * an aspiration. Three tiers, and the difference is stated out loud:
 *   - BLOCKS         — a deterministic violation on a changed line fails CI now.
 *   - BLOCKS IF WIRED— armed, but needs the project to declare its authorities
 *                      (layers/ownership) or its change facts (migrations,
 *                      critical behaviors). Silent until then.
 *   - SELF-APPLIED   — no machine detector exists. These four are law the AGENT
 *                      must uphold by judgment; nothing will catch a violation.
 * Marking a self-applied dimension as "enforced" would be exactly the theatre
 * ADR-0072 §8 forbids: a false sense that the gate has your back.
 *
 * PURE DATA + a renderer. Zero runtime dependencies, no `node:*` imports — safe
 * on the hot path (immutable rule 1).
 */

/**
 * The twelve dimensions, in review order: the structural ones that cost the most
 * to get wrong come first (rubric Tier 1 before Tier 2).
 *
 * @type {ReadonlyArray<{dimension:string, tier:string, law:string}>}
 */
export const TWELVE_DIMENSIONS = Object.freeze([
  {
    dimension: 'ARCHITECTURE_CONFORMANCE',
    tier: 'BLOCKS IF WIRED',
    law: 'Dependencies point inward. No new import cycle; no edge across a forbidden '
      + 'layer boundary; exactly ONE write-authority per piece of state.',
  },
  {
    dimension: 'SECURITY_PRIVACY',
    tier: 'BLOCKS',
    law: 'No injection sink, no fail-open default, no secret/PII in source, and never '
      + 'remove an authorization check. Validate at the trust boundary.',
  },
  {
    dimension: 'DATA_CONTRACTS',
    tier: 'BLOCKS IF WIRED',
    law: 'A published contract (exported API, domain event, schema) is preserved or '
      + 'versioned — never silently broken. Translate foreign shapes at the seam.',
  },
  {
    dimension: 'RELIABILITY',
    tier: 'BLOCKS IF WIRED',
    law: 'An irreversible migration ships with a declared rollback. Retryable work is '
      + 'idempotent; a critical async path is observable.',
  },
  {
    dimension: 'TESTABILITY',
    tier: 'BLOCKS IF WIRED',
    law: 'A changed critical behavior ships with a test that would fail without the '
      + 'change. Side effects (IO, clock, randomness) stay injectable.',
  },
  {
    dimension: 'MODULARITY',
    tier: 'OBSERVED',
    law: 'One module, one responsibility, a deliberate public surface. Watch fan-out '
      + '(doing too much) and fan-in on things that change often.',
  },
  {
    dimension: 'COMPLEXITY',
    tier: 'ADVISORY',
    law: 'Judge complexity, not length. File size NEVER blocks and is NEVER debt — it '
      + 'only invites a look. Split on a real responsibility seam or not at all.',
  },
  {
    dimension: 'COGNITIVE_COHERENCE',
    tier: 'OBSERVED',
    law: 'A reader holds the unit in their head: intention-revealing names, one level '
      + 'of abstraction per body, comments that explain WHY.',
  },
  {
    dimension: 'OBSERVABILITY',
    tier: 'SELF-APPLIED',
    law: 'A failure must be diagnosable: log the technical detail with a correlation '
      + 'id, surface a clean message. Never swallow an exception silently.',
  },
  {
    dimension: 'PERFORMANCE',
    tier: 'SELF-APPLIED',
    law: 'Measure before optimizing. No cache, index, or memo without a named hot '
      + 'path — unmeasured optimization buys complexity for nothing.',
  },
  {
    dimension: 'OPERATIONS_DELIVERY',
    tier: 'SELF-APPLIED',
    law: 'Prefer the smallest reversible step: a change that can be undone with one '
      + 'revert beats the sweeping version that cannot.',
  },
  {
    dimension: 'DEPENDENCIES',
    tier: 'SELF-APPLIED',
    law: 'A new dependency is a DECISION: pin the version, prefer maintained and '
      + 'well-known packages, and keep the hot path at zero runtime deps.',
  },
]);

/**
 * The self-review questions that decide a STRUCTURAL change (ADR-0122 §28). Line
 * count may open the question; only these answer it.
 * @type {ReadonlyArray<string>}
 */
export const STRUCTURAL_SELF_REVIEW = Object.freeze([
  'Responsibility — what is this unit\'s ONE job? How many independent reasons-to-change does it have?',
  'Boundaries — which architecture/domain boundary does it cross? Is there a second authority for state it owns?',
  'Coupling — does my abstraction REDUCE coupling, or only add a hop of bouncing?',
  'Operability — can the result be tested, observed, and rolled back at least as easily?',
  'Debt direction — does this change increase, preserve, reduce, or pay down debt?',
]);

/** Tiers whose law the machine will actually refuse a diff over. */
const ENFORCED_TIERS = Object.freeze(new Set(['BLOCKS', 'BLOCKS IF WIRED']));

/**
 * Render the law as the pre-write brief the agent reads BEFORE editing.
 *
 * @param {Object} [options]
 * @param {string} [options.posture]  the resolved enforcement posture.
 * @param {string} [options.platformDir]  platform dir name for the command hint.
 * @returns {string} the brief (markdown, host-neutral).
 */
export function renderPrecodeLaw(options = {}) {
  const posture = typeof options.posture === 'string' ? options.posture : 'guarded';
  const platformDir = typeof options.platformDir === 'string' ? options.platformDir : 'contextkit';
  const enforcing = posture !== 'advisory';

  const row = (entry) => `- **${entry.dimension}** · _${entry.tier}_ — ${entry.law}`;
  const blocking = TWELVE_DIMENSIONS.filter((d) => ENFORCED_TIERS.has(d.tier));
  const rest = TWELVE_DIMENSIONS.filter((d) => !ENFORCED_TIERS.has(d.tier));

  return [
    '<arch-debt-law>',
    `🏛️  **The twelve dimensions are LAW for this write** (posture: \`${posture}\`).`,
    '',
    enforcing
      ? 'These are not suggestions collected at review time. The gate ENFORCES the'
        + ' tiers below, so the standard is cheapest to meet in the diff you are about'
        + ' to write — not after a refusal.'
      : 'Posture is `advisory`: nothing below will block, but the standard is unchanged.',
    '',
    '**Enforced — a violation on a line you touch fails CI:**',
    ...blocking.map(row),
    '',
    '**Not machine-enforced — you uphold these by judgment:**',
    ...rest.map(row),
    '',
    '⚠️  The four `SELF-APPLIED` dimensions have NO detector. Nothing will catch a',
    '   violation there, which is exactly why they need your attention rather than',
    '   less of it.',
    '',
    '**File size is not debt.** It never blocks and never decides a split. Before any',
    'split OR merge, answer these:',
    ...STRUCTURAL_SELF_REVIEW.map((question) => `  ${question}`),
    '',
    `Verify before you finish:  \`node ${platformDir}/tools/scripts/architecture-debt-gate.mjs --ci\``,
    '</arch-debt-law>',
  ].join('\n');
}

/**
 * A one-line summary for the session boot banner (the full brief is delivered at
 * the first write, where it is actionable rather than background noise).
 *
 * @param {Object} [options]
 * @param {string} [options.posture]  the resolved enforcement posture.
 * @returns {string} a single line.
 */
export function renderLawSummary(options = {}) {
  const posture = typeof options.posture === 'string' ? options.posture : 'guarded';
  const enforced = TWELVE_DIMENSIONS.filter((d) => ENFORCED_TIERS.has(d.tier)).length;
  return `🏛️  Arch-debt law: ${TWELVE_DIMENSIONS.length} dimensions, ${enforced} enforced `
    + `(posture \`${posture}\`) · file size is advisory, never a blocker.`;
}
