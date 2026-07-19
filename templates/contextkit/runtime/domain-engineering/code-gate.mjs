/**
 * code-gate.mjs — the PreToolUse domain-engineering code gate (ADR-0128 §16, §5,
 * §11; WF-0067). Turns the shadow §15 implementation block into a real,
 * deterministic write-time verdict WITHOUT recomputing CMIS/DAS/profile (WF-0063
 * owns those) and WITHOUT building a second gate — it is the thin domain layer the
 * PreToolUse hook consumes alongside the capability execution-gate.
 *
 * Two-axis verdict (ADR-0129 §5): applicability {APPLICABLE, NOT_APPLICABLE,
 * UNKNOWN} is separate from enforcement {ALLOW, WARN, ASK, BLOCK, DEGRADED}. A
 * rule BLOCKs only when applicability=APPLICABLE AND the missing requirement is a
 * deterministic Class-A invariant AND the mode permits it. A predictive
 * uncertainty (Class B) never auto-blocks — at most it ASKs one question
 * (ceiling guarded, ADR-0129).
 *
 * Fail-open (immutable rule 2 / constitution §8): a degraded block, or any
 * internal inability to evaluate, yields DEGRADED + ALLOW with a recorded reason
 * code — never a false pass, never an arbitrary block.
 *
 * PURE: all inputs injected; no filesystem, clock or randomness. Zero runtime
 * dependencies beyond the sibling pure `config.mjs`.
 *
 * @module domain-engineering/code-gate
 */
import { modeForLevel } from './config.mjs';

/** Verdict schema version — bump on any breaking shape change (§16). */
export const CODE_GATE_VERSION = '1.0.0';

/**
 * Resolves the effective enforcement mode for the domain code gate. Default-OFF:
 * a capability that is not `enabled` is always `shadow` (record-only, zero
 * authority), regardless of level. When enabled, the level→mode ladder applies
 * (L<4 shadow · L4 advisory · L5/6 guarded · L7 strict).
 *
 * @param {number} level ContextDevKit level (1-7).
 * @param {object} [effectiveConfig] resolved domainEngineering config.
 * @returns {'shadow'|'advisory'|'guarded'|'strict'}
 */
export function resolveDomainMode(level, effectiveConfig) {
  if (!effectiveConfig || effectiveConfig.enabled !== true) return 'shadow';
  const ladderMode = modeForLevel(level, effectiveConfig);
  // Apply the staged-rollout ceiling (§29): a configured rolloutStage may only
  // LOWER the ladder-derived mode, never raise it — so a project (or WF-0068) can
  // hold the capability at an earlier stage while it calibrates. An absent/invalid
  // stage means "no cap". This is a floor on authority, never a grant.
  const cap = effectiveConfig?.enforcement?.rolloutStage;
  return capMode(ladderMode, cap);
}

/** Ordered enforcement stages (shadow lowest authority → strict highest). */
const STAGE_ORDER = ['shadow', 'advisory', 'guarded', 'strict'];

/**
 * Caps a mode by a rollout-stage ceiling. Returns the LOWER of the two authority
 * levels; an unknown/absent ceiling leaves the mode unchanged (no cap). The cap
 * can only reduce authority, never raise it (default-refuse posture, §29).
 *
 * @param {string} mode the ladder-derived mode.
 * @param {string|null|undefined} cap the configured rolloutStage ceiling.
 * @returns {string} the effective mode.
 */
export function capMode(mode, cap) {
  const modeIdx = STAGE_ORDER.indexOf(mode);
  const capIdx = STAGE_ORDER.indexOf(cap);
  if (capIdx < 0) return mode; // no valid cap → unchanged.
  if (modeIdx < 0) return STAGE_ORDER[capIdx]; // unknown mode → the cap itself (conservative).
  return modeIdx <= capIdx ? mode : STAGE_ORDER[capIdx];
}

/**
 * The authoritative code-mutation-intent signal at the write moment (§5). A real
 * write to a non-excluded source path forces CMIS=100 — this closes textual false
 * negatives (a low textual score never lets a real code write slip past the gate).
 * Otherwise the block's textual CMIS passes through unchanged.
 *
 * @param {object} block the §15 implementation block (buildImplementationBlock).
 * @param {{ writeAttempt?: boolean, pathClass?: string, hardExcluded?: boolean }} ctx
 * @returns {{ score: number, verdict: string, authoritative: boolean }}
 */
export function authoritativeCmis(block, { writeAttempt, pathClass, hardExcluded } = {}) {
  const textual = block && typeof block.codeMutationIntentScore === 'number' ? block.codeMutationIntentScore : 0;
  if (writeAttempt === true && pathClass === 'source-code' && hardExcluded !== true) {
    return { score: 100, verdict: 'CODE', authoritative: true };
  }
  return { score: textual, verdict: (block && block.codeMutationVerdict) || 'UNCERTAIN', authoritative: false };
}

/**
 * Evaluate the PreToolUse code gate. PURE — every input is injected by the hook.
 * Returns the two-axis verdict; the hook maps BLOCK→deny, WARN/ASK→advisory,
 * ALLOW/DEGRADED→pass, and stays silent in shadow.
 *
 * @param {object} input
 * @param {object} input.block the §15 implementation block (may be degraded).
 * @param {string} input.pathClass classifyPath().pathClass.
 * @param {boolean} [input.hardExcluded] classifyPath().hardExcluded.
 * @param {'shadow'|'advisory'|'guarded'|'strict'} [input.mode] resolveDomainMode().
 * @param {'low'|'medium'|'high'} [input.riskBand] guarded blocks medium/high only.
 * @param {boolean} [input.writeAttempt] true on a real Edit/Write/NotebookEdit.
 * @param {boolean} [input.packetPresent] an Implementation Packet exists on disk.
 * @param {boolean} [input.simulateImpactPresent] a §11 simulate-impact receipt exists.
 * @param {boolean} [input.ownerPresent] an active owner is bound to the write.
 * @param {boolean} [input.degradedInput] policy/block load degraded ⇒ DEGRADED.
 * @returns {{ applicability: string, enforcement: string, reasonCodes: string[],
 *   missing: string[], corrective: string[], degraded: boolean }}
 */
export function evaluateCodeGate(input = {}) {
  const {
    block, pathClass, hardExcluded = false, mode = 'shadow', riskBand = 'low',
    writeAttempt = false, packetPresent = false, simulateImpactPresent = false,
    ownerPresent = false, degradedInput = false,
    requiredAgentsDispatched = true,
  } = input && typeof input === 'object' ? input : {};

  // Degraded input → fail-open receipt (never a false pass, never a block).
  if (degradedInput === true || (block && block.degraded === true)) {
    return verdict('UNKNOWN', 'DEGRADED', ['CODE_GATE_DEGRADED'], [], [], true);
  }

  const cmis = authoritativeCmis(block, { writeAttempt, pathClass, hardExcluded });
  const app = resolveApplicability({ block, pathClass, hardExcluded, cmis });

  if (app.applicability === 'NOT_APPLICABLE') {
    return verdict('NOT_APPLICABLE', 'ALLOW', [app.reason], [], [], false);
  }
  if (app.applicability === 'UNKNOWN') {
    // Insufficient/conflicting signals — one question, never an auto-block (§5, ADR-0129).
    return verdict('UNKNOWN', 'ASK', ['CODE_GATE_CLASSIFICATION_UNCERTAIN'], [],
      ['Confirm whether this is a code target; re-run intake if the classification is wrong.'], false);
  }

  // APPLICABLE code target — check the deterministic Class-A requirements (§16).
  const check = checkRequirements({ block, packetPresent, simulateImpactPresent, ownerPresent, requiredAgentsDispatched });
  if (check.missing.length === 0) {
    return verdict('APPLICABLE', 'ALLOW', ['CODE_GATE_SATISFIED'], [], [], false);
  }
  return verdict('APPLICABLE', decideEnforcement(mode, riskBand), check.reasonCodes, check.missing, check.corrective, false);
}

/**
 * Resolve the applicability axis. Hard exclusions, documentation, configuration
 * and the no-code profile are never blockable code targets (the mandatory dogfood
 * regression: a doc write is never interfered with). An unknown path on a write
 * attempt is UNKNOWN → ASK. Only a `source-code` path (or the authoritative write
 * trigger) is APPLICABLE.
 */
function resolveApplicability({ block, pathClass, hardExcluded, cmis }) {
  // Hard exclusions (generated/vendor/build) and non-code file types are never
  // blockable code targets — the mandatory dogfood regression (a doc write is
  // never interfered with).
  if (hardExcluded === true) return { applicability: 'NOT_APPLICABLE', reason: 'CODE_GATE_PATH_EXCLUDED' };
  if (pathClass === 'documentation' || pathClass === 'configuration') {
    return { applicability: 'NOT_APPLICABLE', reason: 'CODE_GATE_PATH_NON_CODE' };
  }
  // A real write to a source-code path is APPLICABLE — the authoritative CMIS=100
  // (§5) OVERRIDES a textual no-code classification. This ORDER is load-bearing:
  // it must precede the no-code short-circuit below, or a textual false negative
  // would wrongly mark a genuine source write NOT_APPLICABLE (the exact gap §5
  // closes). `cmis.authoritative` already implies `pathClass === 'source-code'`.
  if (pathClass === 'source-code' || cmis.authoritative === true) {
    return { applicability: 'APPLICABLE', reason: 'CODE_GATE_CODE_TARGET' };
  }
  // No real code write + a no-code profile → genuinely not applicable.
  if (block && block.profile === 'no-code') return { applicability: 'NOT_APPLICABLE', reason: 'CODE_GATE_PROFILE_NO_CODE' };
  if (pathClass === 'unknown' || pathClass === undefined || pathClass === null) {
    return { applicability: 'UNKNOWN', reason: 'CODE_GATE_PATH_UNKNOWN' };
  }
  // Any other classified non-source path (test/migration/infra/contract/docs) is
  // out of the packet-obligation scope — never blocked by this gate.
  return { applicability: 'NOT_APPLICABLE', reason: 'CODE_GATE_PATH_NON_CODE' };
}

/**
 * Collect the missing deterministic Class-A requirements for an applicable code
 * target, each paired with the EXACT corrective command (§16 "always names the
 * corrective command"). The Implementation Packet is mandatory for any non-no-code
 * profile; the simulate-impact receipt only when the profile declared it.
 */
function checkRequirements({ block, packetPresent, simulateImpactPresent, ownerPresent, requiredAgentsDispatched = true }) {
  const missing = [];
  const corrective = [];
  const reasonCodes = [];
  if (ownerPresent !== true) {
    missing.push('owner');
    reasonCodes.push('CODE_GATE_OWNER_ABSENT');
    corrective.push('Bind an active owner before writing code: /dev-start (or /claim <path>).');
  }
  if (packetPresent !== true) {
    missing.push('implementation-packet');
    reasonCodes.push('CODE_GATE_PACKET_ABSENT');
    corrective.push('Compile the Implementation Packet before the first code write: /work operation (or the domain Task Compiler recipe).');
  }
  if (block && block.simulateImpactRequired === true && simulateImpactPresent !== true) {
    missing.push('simulate-impact');
    reasonCodes.push('CODE_GATE_SIMULATE_IMPACT_ABSENT');
    corrective.push('Run /simulate-impact to produce the required blast-radius receipt (the profile requires it).');
  }
  // ADR-0142 (WF-0075) — the pre-write DISPATCH requirement. Teeth apply ONLY when the
  // profile is domain-driven/distributed-domain (requiredAgentsProfile) — NOT on every
  // squadRequired block, since envelope-block sets squadRequired true for simple/modular
  // too. Completion still owns the COMPLETED requirement (requiring completed pre-write
  // is circular). Default-true so an absent flag never false-blocks (fail-open).
  if (requiredAgentsProfile(block) && requiredAgentsDispatched !== true) {
    missing.push('required-agents');
    reasonCodes.push('CODE_GATE_AGENTS_NOT_DISPATCHED');
    const agents = block && Array.isArray(block.requiredAgents) && block.requiredAgents.length
      ? block.requiredAgents.join(', ')
      : 'the profile-required specialist(s)';
    corrective.push(`Dispatch ${agents} before writing domain code (a name in a prompt does not count — only a real spawn).`);
  }
  return { missing, corrective, reasonCodes };
}

/**
 * The profile-tier scope predicate for the pre-write dispatch requirement (ADR-0142).
 * The dispatch teeth apply ONLY to a genuinely domain-shaped profile — never to
 * simple/modular/no-code, which also carry `squadRequired: true` from envelope-block.
 * @param {object} block the §15 implementation block.
 * @returns {boolean} true when the block demands a dispatched squad before a code write.
 */
function requiredAgentsProfile(block) {
  if (!block || block.squadRequired !== true) return false;
  return block.profile === 'domain-driven' || block.profile === 'distributed-domain';
}

/**
 * Translate (mode, riskBand) into the enforcement axis for a missing requirement.
 * shadow records only (ALLOW); advisory never blocks (WARN); guarded blocks only
 * a medium/high-risk write (trivial passes with a receipt); strict blocks any.
 */
function decideEnforcement(mode, riskBand) {
  switch (mode) {
    case 'shadow': return 'ALLOW';
    case 'advisory': return 'WARN';
    case 'guarded': return riskBand === 'medium' || riskBand === 'high' ? 'BLOCK' : 'WARN';
    case 'strict': return 'BLOCK';
    default: return 'WARN';
  }
}

/** Shape one verdict object. */
function verdict(applicability, enforcement, reasonCodes, missing, corrective, degraded) {
  return { applicability, enforcement, reasonCodes, missing, corrective, degraded };
}
