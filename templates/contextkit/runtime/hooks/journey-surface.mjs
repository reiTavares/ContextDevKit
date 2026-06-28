/**
 * Journey surfacing (BIZ-0001 / ADR-0127 Phase 2, first cut) — renders ONE advisory
 * line per execution telling the agent the current journey stage + the exact next
 * command. Consumed by the execution-contract advisory pass (and re-usable at boot).
 *
 * Honest-by-design: it derives only the checkpoints it can determine from the
 * classifier signals (no fragile active-entity guessing). Everything else is
 * `null` → the verifier marks it `pending` and the line says "next step", never a
 * false "done". Advisory only; fail-open (immutable rule 2). Zero deps.
 *
 * @module journey-surface
 */
import { loadJourney, selectBranch, verifyJourney } from '../work/journey-verifier.mjs';
import { gatherRegistryEvidence } from '../work/journey-evidence-registry.mjs';

/**
 * Resolves the work-context id the journey applies to, from classifier signals.
 * Prefers an explicit entity id, then a matched Business. Null when none resolves.
 *
 * @param {object} signals - intake signals.
 * @returns {string|null}
 */
function resolveEntityId(signals = {}) {
  const work = signals.work || {};
  if (typeof work.id === 'string' && /^(BIZ|OP)-\d{4}$/.test(work.id)) return work.id;
  const match = signals.businessMatch || work.businessMatch;
  if (match && typeof match.suggested === 'string' && /^(BIZ|OP)-\d{4}$/.test(match.suggested)) return match.suggested;
  return null;
}

/**
 * Maps classifier signals to the checkpoint→verdict map the verifier consumes.
 * Pure. Only the cheaply+honestly determinable checkpoints get a boolean; the
 * rest stay undefined (→ verifier treats as `pending`).
 *
 * @param {object} signals - intake signals ({ work, tier, decisionNeed }).
 * @returns {Record<string, boolean>} sparse checkpoint verdict map.
 */
export function evidenceFromSignals(signals = {}) {
  const work = signals.work || {};
  const evidence = { intakeRecorded: true }; // we are literally in the intake surface

  // A governing-decision reference present on the entity is a positive (not proof of
  // acceptance, but enough for an advisory ✓); absence stays unknown (pending).
  const refs = work.decisionRefs;
  const hasRefs = (
    (refs && typeof refs === 'object' && !Array.isArray(refs) && (refs.primary || (Array.isArray(refs.governing) && refs.governing.length))) ||
    (Array.isArray(refs) && refs.length > 0) ||
    (work.decisions && typeof work.decisions === 'object' && typeof work.decisions.primary === 'string')
  );
  if (hasRefs) evidence.governingAdrAccepted = true;

  // Trivial work may write without reaching a ship phase.
  if (signals.tier === 'trivial') evidence.atShipPhaseOrTrivial = true;

  return evidence;
}

/** Compact per-stage glyph: ✓ satisfied · ⚠ blocked · • pending. */
function glyph(state) {
  return state === 'satisfied' ? '✓' : state === 'blocked' ? '⚠' : '•';
}

/** Renders the host-resolved next command from a stage command descriptor. */
function commandText(command) {
  if (!command || typeof command !== 'object') return null;
  if (command.work) return `node contextkit/tools/scripts/work.mjs ${command.work}${command.args ? ` ${command.args}` : ''}`;
  if (command.slash) return `/${command.slash}${command.args ? ` ${command.args}` : ''}`;
  if (command.tool) return `node contextkit/tools/scripts/${command.tool}${command.args ? ` ${command.args}` : ''}`;
  if (command.shell) return command.shell;
  return null;
}

/**
 * Renders the journey advisory block for the current request, or '' when no
 * branch can be resolved (the intake banner already covers that case).
 *
 * @param {string} root - project root.
 * @param {object} signals - intake signals.
 * @returns {string} a short advisory block (newline-terminated) or ''.
 */
export function renderJourneyAdvisory(root, signals = {}) {
  try {
    const branch = selectBranch(signals.work || {});
    if (!branch) return '';
    const journey = loadJourney(root);
    if (!journey) return '';
    // Registry evidence (real on-disk verdicts) overrides the signal-derived guess.
    const entityId = resolveEntityId(signals);
    const evidence = { ...evidenceFromSignals(signals), ...gatherRegistryEvidence(root, entityId) };
    const result = verifyJourney(journey, branch, evidence);
    if (!result) return '';

    const path = result.stages.map((s) => `${glyph(s.state)}${s.id}`).join(' ');
    const lines = [`‹CONTEXTKIT-JOURNEY branch=${branch}›`, `  path: ${path}`];
    if (result.currentStageId) {
      const cmd = commandText(result.nextCommand);
      lines.push(`  next: ${result.currentStageId}${cmd ? ` → ${cmd}` : ''}`);
      if (result.nextGuidance) lines.push(`  ${result.nextGuidance}`);
    } else {
      lines.push('  next: journey complete for this branch.');
    }
    if (result.blocked.length) {
      lines.push(`  ⚠ blocked: ${result.blocked.map((s) => `${s.id}(${s.unmet.join(',')})`).join('; ')}`);
    }
    lines.push('  (advisory — ADR-0127 first cut; blocking checkpoints arrive in the second cut)');
    return lines.join('\n') + '\n';
  } catch {
    return ''; // fail-open — journey surfacing never breaks the hook
  }
}
