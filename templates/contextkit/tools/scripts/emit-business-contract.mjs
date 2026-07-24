/**
 * Business-context adapter for the governance-contract emit hook (WF-0088).
 *
 * Bridges a persisted Business entity to the generic `emitGovernanceContract` IO
 * edge: it CONSUMES the ceremony the business already recorded (`intake.ceremony`
 * → the WF-0083 resolver) and the governing decision the business already names —
 * it re-runs neither the classifier nor the resolver's decision. Both wiring sites
 * (create + lifecycle transition) call this with a single fail-open line.
 *
 * SHADOW stage (rollout-plan §2): the contract is written, never read by any gate.
 * This module resolves and serializes; it enforces nothing.
 *
 * Fail-open: every path returns a skipped result rather than throwing — a broken
 * emit must never break a real create/transition (immutable rule 2).
 *
 * Zero runtime dependencies — node:* + sibling producers only.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readFrontMatter } from '../../runtime/work/front-matter.mjs';
import { stripBom } from '../../runtime/work/enums.mjs';
import { resolveBusinessCeremony } from './work-business-create-contract.mjs';
import { emitGovernanceContract, refreshGovernanceContract } from './emit-governance-contract.mjs';
import { GOVERNING_DECISION_STATUSES } from '../../runtime/work/schema-governance-contract.mjs';

/**
 * Resolve the governing decision `{ ref, status }` for a business, fail-open.
 * The ref is the business's own `decisions.primary`; the status is read from the
 * ADR's front matter. A missing/unreadable ADR degrades to `proposed` (the safe,
 * least-privileged default) so the emit still validates.
 *
 * @param {string} decisionsBusinessDir absolute path to decisions/business
 * @param {object} business parsed business entity
 * @returns {{ref:string|null, status:string|null}} the uncovered form
 *   `{ ref: null, status: null }` when the business names no governing decision
 *   yet (created before its ADR exists — a legitimate first-class state).
 */
export function resolveGoverningDecision(decisionsBusinessDir, business) {
  const ref = business?.decisions?.primary
    || (Array.isArray(business?.decisions?.governing) ? business.decisions.governing[0] : null);
  if (typeof ref !== 'string' || ref.trim() === '') return { ref: null, status: null };
  let status = 'proposed';
  try {
    const match = readdirSync(decisionsBusinessDir).find((name) => name === `${ref}.md` || name.startsWith(`${ref}-`));
    if (match) {
      const front = readFrontMatter(stripBom(readFileSync(join(decisionsBusinessDir, match), 'utf-8')));
      const parsedStatus = front?.data?.status;
      if (GOVERNING_DECISION_STATUSES.includes(parsedStatus)) status = parsedStatus;
    }
  } catch {
    // unreadable ADR → keep the safe default
  }
  return { ref, status };
}

/**
 * Emit the governance contract for a Business context. Fail-open — returns a
 * skipped result on any missing input or error, never throws.
 *
 * @param {object} args `{ root, business, contextDir, decisionsBusinessDir, emittedBy, now }`
 * @returns {{emitted:boolean, reason:string, errors?:string[]}}
 */
export function emitBusinessGovernanceContract(args) {
  try {
    // Destructure inside the try so a null/garbage arg returns skipped, never throws
    // (honors the module's fail-open contract even though both call sites pass objects).
    const { business, contextDir, decisionsBusinessDir, emittedBy, now, ceremony: explicitCeremony } = args || {};
    if (!contextDir || !business?.id || !existsSync(contextDir)) {
      return { emitted: false, reason: 'insufficient-inputs' };
    }
    const governingDecision = resolveGoverningDecision(decisionsBusinessDir, business);

    // Create knows the ceremony (explicit); a transition reads the persisted intake.
    const ceremony = explicitCeremony ?? business?.intake?.ceremony;
    if (ceremony === 'decision' || ceremony === 'workflow') {
      const resolved = resolveBusinessCeremony(ceremony);
      return emitGovernanceContract({
        contextDir,
        contextRef: { type: 'business', id: business.id },
        nature: 'business',
        executionMode: resolved.executionMode,
        tier: resolved.tier,
        kind: resolved.classifierFunctionalKind,
        shape: resolved.shape,
        governingDecision,
        emittedBy,
        now,
      });
    }

    // Ceremony not derivable (a canonically-created business.json carries no intake
    // block): a status transition never alters the ceremony shape, so refresh only
    // the governing-decision status on the existing contract. If no contract exists
    // yet, this is a skipped no-op (never a hard failure).
    return refreshGovernanceContract({ contextDir, governingDecision, emittedBy, now });
  } catch {
    return { emitted: false, reason: 'error' };
  }
}
