/**
 * `work intake` handler — thin I/O adapter for the `intake` CLI verb (BIZ-0001 /
 * WF-0036, Wave 3, OP-0005 / ADR-0125).
 *
 * Routes to:
 *   `runtime/execution/task-intake.mjs`   → `intake(request, env)` for signals
 *   `runtime/execution/work-classifier.mjs` → `classifyWork` (already composed inside intake)
 *   `runtime/execution/business-matcher.mjs` → `matchBusiness` for business match
 *
 * Posture (constitution §8): DRY-RUN BY DEFAULT. `--check` performs readiness
 * evaluation only (no objective required). `--apply` is a no-op for intake
 * (intake is read-only by design; the receipt documents signals). The function
 * never writes files unless explicitly asked to save the proposal (`--apply`),
 * in which case it delegates to the intake-proposal-store (A2 seam).
 *
 * Zero runtime dependencies — `node:*` + sibling/runtime modules only.
 *
 * @module work-intake
 */
import { makeReceipt } from './work-io.mjs';
import { intake } from '../../runtime/execution/task-intake.mjs';
import { matchBusiness } from '../../runtime/execution/business-matcher.mjs';
import { loadWorkPolicy } from '../../runtime/execution/work-classifier.mjs';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the objective string from flags or positionals.
 *
 * @param {string[]} positionals - parsed positional args (after the command).
 * @param {Record<string, string|boolean>} flags - parsed CLI flags.
 * @returns {string|null} the objective string, or null when absent.
 */
function resolveObjective(positionals, flags) {
  const fromFlag = typeof flags.objective === 'string' ? flags.objective.trim() : '';
  if (fromFlag) return fromFlag;
  const fromPos = positionals.join(' ').trim();
  return fromPos || null;
}

// ---------------------------------------------------------------------------
// Public handler
// ---------------------------------------------------------------------------

/**
 * Handles `work intake` — classifies an objective into methodology signals and
 * emits a receipt describing nature, tier, ceremony requirement, business match,
 * decision need, and any clarification question.
 *
 * In `--check` mode (no objective required) it validates that the policy file and
 * runtime classifier are reachable and reports readiness.
 *
 * In apply mode (`--apply`) there is currently no write side-effect: intake is a
 * pure-read command whose receipt IS the output. The `applied` flag reflects that.
 *
 * @param {{ positionals: string[], flags: Record<string,string|boolean>, apply: boolean, root: string }} ctx
 * @returns {ReturnType<typeof makeReceipt>}
 * @throws {Error} when `--check` is absent and no objective is supplied.
 */
export function handleIntake({ positionals, flags, apply, root }) {
  const checkOnly = flags.check === true;

  if (checkOnly) {
    // Readiness-only path: verify classifier loads without error.
    let policyOk = false;
    let reason = '';
    try {
      const policy = loadWorkPolicy(root);
      policyOk = !!(policy && policy.nature && policy.valueIntent);
      reason = policyOk ? 'work-classification policy loaded' : 'policy loaded but missing sections';
    } catch (err) {
      reason = `policy load failed: ${err && err.message ? err.message : String(err)}`;
    }
    return makeReceipt({
      command: 'intake',
      applied: false,
      writes: [],
      detail: { check: true, ready: policyOk, reason },
    });
  }

  const objective = resolveObjective(positionals, flags);
  if (!objective) throw new Error('work intake: an objective is required (positional or --objective)');

  // Run task-intake (A2 + B2 enriched), then enrich with matchBusiness.
  const { signals, reasons } = intake({ objective }, { root });

  // Business match — enrichment from A2 business-matcher.
  let businessMatch = null;
  try {
    if (signals.work) {
      businessMatch = matchBusiness(signals.work, { root });
    }
  } catch {
    // Fail-open: matcher may not find any businesses yet.
  }

  return makeReceipt({
    command: 'intake',
    applied: apply,
    writes: [],
    detail: {
      objective,
      nature: signals.work ? signals.work.nature : null,
      tier: signals.tier,
      executionMode: signals.work ? signals.work.executionMode : null,
      decisionNeed: signals.decisionNeed ? signals.decisionNeed.needVerdict : null,
      businessMatch: businessMatch
        ? { suggested: businessMatch.suggested, status: businessMatch.status }
        : null,
      needsClarification: signals.work ? (signals.work.needsClarification || false) : false,
      clarifyQuestion: signals.work ? (signals.work.clarifyQuestion || null) : null,
      reasons,
    },
  });
}
