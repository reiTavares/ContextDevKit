/**
 * completion.mjs — the Completion Gate done-rule (ADR-0128 §20; WF-0067). Decides
 * whether a task may be declared done, deriving the obligations SOLELY from the
 * resolved Implementation Profile — never a fixed list. A no-code profile has zero
 * obligations (the mandatory dogfood regression: a doc-only task needs no code QA,
 * no specialists, no packet, no code tests, and must not block completion).
 *
 * Consumes the existing evidence surfaces, never re-derives them:
 *   - WF-0065 `summarizeSpawnEvidence` → the planned-vs-completed agent facts
 *     (a name in a prompt never counts; only a recorded completion satisfies).
 *   - WF-0066 `buildImplementationReceipt` → the planned-vs-actual diff (a
 *     critical deviation invalidates the receipt).
 *
 * PURE: all inputs injected; no I/O, no clock. Fail-open — an internal inability
 * to evaluate yields `warn` with a reason, never a false "done" and never an
 * arbitrary block. Zero runtime dependencies.
 *
 * @module domain-engineering/completion
 */

/** Verdict schema version — bump on any breaking shape change (§20). */
export const COMPLETION_VERSION = '1.0.0';

/** Receipt deviation kinds that invalidate completion (a mere path drift does not). */
const CRITICAL_DEVIATION_KINDS = Object.freeze(
  new Set(['agent-missing', 'skill-missing', 'forbidden-path-touched', 'preserved-contract-changed']),
);

/**
 * Evaluate whether a task satisfies its profile-derived completion obligations.
 * PURE.
 *
 * @param {object} input
 * @param {object} input.block the §15 implementation block (profile + requirements).
 * @param {'shadow'|'advisory'|'guarded'|'strict'} [input.mode] resolved domain mode.
 * @param {boolean} [input.acceptanceMet] the task's acceptance criteria are checked off.
 * @param {object} [input.spawnEvidence] `summarizeSpawnEvidence(...)` output
 *   (`{ satisfied, plannedNotDispatched, dispatchedNotCompleted }`).
 * @param {object} [input.receipt] `buildImplementationReceipt(...)` output
 *   (`{ deviations, reasonCodes }`); null ⇒ the packet was never reconciled.
 * @param {boolean} [input.testsGreen] the profile-required tests passed.
 * @param {boolean} [input.architectureGatesSatisfied] arch-debt gate passed for the change.
 * @param {string|null} [input.evidenceRef] a link to the real completion evidence.
 * @returns {{ decision: 'allow'|'warn'|'deny', done: boolean, missing: string[],
 *   corrective: string[], reasonCodes: string[] }}
 */
export function evaluateDomainCompletion(input = {}) {
  const {
    block, mode = 'shadow', acceptanceMet = false, spawnEvidence, receipt,
    testsGreen, architectureGatesSatisfied, evidenceRef,
  } = input && typeof input === 'object' ? input : {};

  const profile = (block && typeof block.profile === 'string') ? block.profile : 'no-code';
  const obligations = obligationsForProfile(profile, block);

  // no-code (or NOT_APPLICABLE) → zero obligations → done immediately (§20 regression).
  if (obligations.length === 0) {
    return done('allow', ['COMPLETION_NO_OBLIGATIONS']);
  }

  const missing = [];
  const corrective = [];
  const reasonCodes = [];

  if (obligations.includes('acceptance') && acceptanceMet !== true) {
    missing.push('acceptance');
    reasonCodes.push('COMPLETION_ACCEPTANCE_UNMET');
    corrective.push('Check off the task acceptance criteria before declaring it done.');
  }
  if (obligations.includes('agents') && !spawnSatisfied(spawnEvidence)) {
    missing.push('required-agents');
    reasonCodes.push('COMPLETION_AGENTS_INCOMPLETE');
    corrective.push('Dispatch the profile-required agent(s) and let them record completion (a name in a prompt does not count).');
  }
  if (obligations.includes('receipt') && !receiptValid(receipt)) {
    missing.push('implementation-receipt');
    reasonCodes.push(receipt ? 'COMPLETION_RECEIPT_DEVIATION' : 'COMPLETION_RECEIPT_ABSENT');
    corrective.push('Produce a valid Implementation Receipt (planned-vs-actual) with no critical deviation.');
  }
  if (obligations.includes('tests') && testsGreen !== true) {
    missing.push('required-tests');
    reasonCodes.push('COMPLETION_TESTS_NOT_GREEN');
    corrective.push('Run the profile-required test suite to green before completion.');
  }
  if (obligations.includes('architecture') && architectureGatesSatisfied !== true) {
    missing.push('architecture-gates');
    reasonCodes.push('COMPLETION_ARCH_GATES_UNSATISFIED');
    corrective.push('Satisfy the architecture fitness gates (arch-debt) for the change.');
  }
  if (obligations.includes('evidence') && !isNonEmptyString(evidenceRef)) {
    missing.push('evidence-ref');
    reasonCodes.push('COMPLETION_EVIDENCE_REF_ABSENT');
    corrective.push('Attach an evidence reference (receipt / report) to the completed task.');
  }

  if (missing.length === 0) return done('allow', ['COMPLETION_SATISFIED']);
  return {
    decision: decideEnforcement(mode),
    done: false,
    missing,
    corrective,
    reasonCodes,
  };
}

/**
 * Derive the obligation set from the resolved profile (§20). The obligation
 * matrix is monotone: each richer profile adds obligations. `no-code` → none.
 *
 * @param {string} profile 'no-code'|'simple'|'modular'|'domain-driven'|'distributed-domain'.
 * @param {object} [block] the §15 block — `squadRequired`/`requiredAgents` refine `agents`.
 * @returns {string[]} the obligation keys.
 */
export function obligationsForProfile(profile, block) {
  if (profile === 'no-code') return [];
  const base = ['acceptance', 'receipt', 'evidence'];
  // The squad (agents) is an obligation whenever the profile requires code AND the
  // block actually declares required agents — proportional fan-out (§"Core ruling").
  const agents = (block && block.squadRequired === true
    && Array.isArray(block.requiredAgents) && block.requiredAgents.length > 0) ? ['agents'] : [];
  switch (profile) {
    case 'simple':
      return [...base, ...agents, 'tests'];
    case 'modular':
      return [...base, ...agents, 'tests'];
    case 'domain-driven':
    case 'distributed-domain':
      return [...base, ...agents, 'tests', 'architecture'];
    default:
      // Unknown profile with code intent → conservative baseline (never a silent pass).
      return [...base, ...agents];
  }
}

/** True when every planned agent recorded a completion (WF-0065 evidence ruling). */
function spawnSatisfied(spawnEvidence) {
  return Boolean(spawnEvidence && spawnEvidence.satisfied === true);
}

/** True when a receipt exists AND carries no critical (completion-invalidating) deviation. */
function receiptValid(receipt) {
  if (!receipt || typeof receipt !== 'object') return false;
  const deviations = Array.isArray(receipt.deviations) ? receipt.deviations : [];
  return !deviations.some((d) => d && CRITICAL_DEVIATION_KINDS.has(d.kind));
}

/** shadow/advisory never deny at this layer; guarded/strict deny on a missing obligation. */
function decideEnforcement(mode) {
  return mode === 'guarded' || mode === 'strict' ? 'deny' : 'warn';
}

/** Shape a satisfied verdict. */
function done(decision, reasonCodes) {
  return { decision, done: decision === 'allow', missing: [], corrective: [], reasonCodes };
}

/** True for a non-empty string. */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}
