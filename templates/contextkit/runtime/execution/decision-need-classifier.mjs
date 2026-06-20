/**
 * decision-need-classifier.mjs — deterministic B2-T1 decision-need classifier
 * (BIZ-0001 / WF-0037 Wave B2, ADR-0102).
 *
 * Implements §2 (need/materiality), §3 (routine coverage), and §7 (hard rules
 * HR-1..HR-7) of B2-design-decision-table.md. Triple derivation (§1) is in the
 * companion `decision-triple.mjs` (split for the 280-line rule, one consumer).
 *
 * FROZEN INTERFACE CONTRACT:
 *   export function classifyDecisionNeed({ signals, decisionRegistry, platformRoot,
 *                                          registry?, policy?, triple?, objective? })
 *     → { needVerdict, materialityScore, triple, routineCovered, coverageMode,
 *         linkTarget, reasons, flags }
 *
 * Zero I/O beyond policy loading. Pure given (signals, registry, policy). No LLM,
 * no embeddings, no Math.random. Fail-open to recommended/NEEDS_DECISION always.
 *
 * COHESION NOTE (300 lines — 280 yellow zone, < 308 hard RED): §2, §3, and §7
 * are a single gate pipeline (score → routine-check → hard rules → verdict).
 * Splitting would separate the pipeline from its inputs and create stub modules
 * with no independent consumer. The §1 triple-derivation (a prior pipeline stage)
 * was already extracted to decision-triple.mjs. No further split has a real seam.
 *
 * @module decision-need-classifier
 */
import { materialityScore as computeMateriality, DEFAULT_DECISION_POLICY, loadDecisionPolicy } from './materiality-score.mjs';
import { derivePrimaryContext, deriveDecisionKind, deriveDecisionScope } from './decision-triple.mjs';
import { DECISION_KINDS, DECISION_SCOPES, DECISION_COVERAGE_MODES } from '../work/decision-enums.mjs';

// ─── Registry normalizer ──────────────────────────────────────────────────────

/**
 * Normalises a registry value to a flat array of decision rows.
 * Accepts: plain array, `{ decisions: [] }`, `{ entries: [] }`, null.
 *
 * @param {unknown} reg - registry in any accepted form.
 * @returns {object[]}
 */
function normalizeRegistry(reg) {
  if (Array.isArray(reg)) return reg;
  if (reg && typeof reg === 'object') {
    if (Array.isArray(reg.decisions)) return reg.decisions;
    if (Array.isArray(reg.entries))   return reg.entries;
  }
  return [];
}

// ─── §3: Routine-coverage detection ──────────────────────────────────────────

/**
 * Checks RC1..RC4 (§3). Returns `covered:false` by default (material path is
 * the safe default — constitution §8 "refuse-to-false-negative").
 *
 * @param {{ primaryContext: object, decisionKind: string }} triple
 * @param {object[]} rows - flat registry rows.
 * @param {string} objectiveLower - lowercased objective.
 * @param {number} matScore - computed materiality score.
 * @param {object} policy - decision-intelligence policy.
 * @returns {{ covered: boolean, adrid: string|null, reason: string }}
 */
function detectRoutineCoverage(triple, rows, objectiveLower, matScore, policy) {
  const ceiling = policy.routineCeilingDefault ?? 3;

  // RC1: accepted ROUTINE_OPERATION_GOVERNANCE ADR for this context
  const standingAdr = rows.find((row) =>
    row.decisionKind === 'ROUTINE_OPERATION_GOVERNANCE'
    && row.status === 'accepted'
    && row.primaryContext?.type === triple.primaryContext?.type
    && (triple.primaryContext?.id === null
        || row.primaryContext?.id === triple.primaryContext?.id
        || triple.primaryContext?.type === 'platform'),
  );
  if (!standingAdr) {
    return { covered: false, adrid: null, reason: 'RC1 fail: no accepted ROUTINE_OPERATION_GOVERNANCE ADR for this context' };
  }

  // RC2: at least one declared routine class matches the objective
  const routineClasses = Array.isArray(standingAdr.routineClasses) ? standingAdr.routineClasses : [];
  const classHit = routineClasses.find((cls) => {
    const sigs = Array.isArray(cls.signals) ? cls.signals : [];
    // signals can be { s, w } objects or plain strings
    return sigs.some((s) => {
      const needle = typeof s === 'object' ? String(s.s ?? '') : String(s);
      return needle && objectiveLower.includes(needle.toLowerCase());
    });
  });
  if (!classHit) {
    return { covered: false, adrid: standingAdr.id, reason: `RC2 fail: no declared routine class in ${standingAdr.id} matched the objective` };
  }

  // RC3: score below the ADR's declared ceiling (or policy default)
  const adrCeiling = Number.isFinite(standingAdr.routineCeiling) ? standingAdr.routineCeiling : ceiling;
  if (matScore >= adrCeiling) {
    return { covered: false, adrid: standingAdr.id, reason: `RC3 fail: materialityScore ${matScore} >= routineCeiling ${adrCeiling}` };
  }

  // RC4 is enforced by the caller (HR-4/HR-5 refuse the routine path externally)
  const className = typeof classHit === 'string' ? classHit : (classHit.name ?? JSON.stringify(classHit));
  return {
    covered: true,
    adrid: standingAdr.id,
    reason: `ROUTINE_COVERED: matched class '${className}' in ${standingAdr.id} (score ${matScore} < ceiling ${adrCeiling})`,
  };
}

// ─── §7 HR-7 advisory helpers ─────────────────────────────────────────────────

/**
 * Checks for dedup violation (HR-7) and pending proposal advisory.
 *
 * @param {object[]} rows - flat registry rows.
 * @param {object} triple
 * @param {object} flags - mutated in-place.
 * @param {string[]} reasons - mutated in-place.
 */
function applyAdvisoryFlags(rows, triple, flags, reasons) {
  const { primaryContext, decisionKind, decisionScope } = triple;
  const exactMatches = rows.filter((r) =>
    (r.status === 'accepted' || r.status === 'legacy')
    && r.decisionKind === decisionKind
    && r.primaryContext?.type === primaryContext?.type
    && r.primaryContext?.id === primaryContext?.id
    && r.decisionScope === decisionScope,
  );
  if (exactMatches.length > 1) {
    flags.dedupViolationSuspected = true;
    reasons.push(`HR-7: ${exactMatches.length} candidates share exact triple — dedup violation suspected`);
  }
  const pending = rows.find((r) =>
    r.status === 'proposed'
    && r.decisionKind === decisionKind
    && r.primaryContext?.type === primaryContext?.type,
  );
  if (pending) {
    flags.proposalPending = pending.id;
    reasons.push(`advisory: proposed ADR ${pending.id} pending for this kind/context`);
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/** Fail-open defaults returned on any input error or exception. */
const FAIL_OPEN = Object.freeze({
  needVerdict: 'recommended',
  materialityScore: 0,
  triple: Object.freeze({ primaryContext: { type: 'platform', id: 'platform' }, decisionKind: 'ARCHITECTURE', decisionScope: 'workflow' }),
  routineCovered: false,
  coverageMode: 'NEEDS_DECISION',
  linkTarget: null,
  reasons: ['classifyDecisionNeed: fail-open — input error or exception'],
  flags: Object.freeze({}),
});

/**
 * Classifies a unit of work's decision need (§2 + §7 hard rules).
 * Frozen interface contract — B2-T2 and tests depend on this exact shape.
 *
 * Accepted params (all optional except `signals`):
 * - `signals`         — full intake signals (required); may include pre-derived
 *                       `decisionKind`, `decisionScope`, `objectiveLower`, `policy`.
 * - `decisionRegistry`/ `registry` — flat row array OR `{decisions:[]}` wrapper.
 * - `triple`          — pre-computed triple override (skips §1 derivation).
 * - `policy`          — direct policy override (skips file load).
 * - `objective`       — raw text override (falls back to `signals.objective`).
 * - `platformRoot`    — used for file-based policy loading when no `policy` param.
 *
 * @param {object} params
 * @returns {{ needVerdict: string, materialityScore: number, triple: object,
 *             routineCovered: boolean, coverageMode: string, linkTarget: string|null,
 *             reasons: string[], flags: object }}
 */
export function classifyDecisionNeed(params) {
  try {
    if (!params || typeof params !== 'object') return { ...FAIL_OPEN };
    const { signals, platformRoot } = params;
    if (!signals || typeof signals !== 'object' || Array.isArray(signals)) return { ...FAIL_OPEN };

    // Policy: direct param > platformRoot load > default
    const policy = params.policy
      ?? (platformRoot ? loadDecisionPolicy(platformRoot) : null)
      ?? signals.policy
      ?? DEFAULT_DECISION_POLICY;

    // Registry: normalise from either param name
    const rows = normalizeRegistry(params.decisionRegistry ?? params.registry ?? []);

    const work = signals.work ?? {};
    const tier = { tier: signals.tier ?? 'trivial', domain: signals.domain ?? 'general' };
    const businessMatch = work.businessMatch ?? signals.businessMatch ?? null;
    // Objective: params override > signals.objective
    const objective = String(params.objective ?? signals.objective ?? '');
    const objectiveLower = signals.objectiveLower ?? objective.toLowerCase();
    const reasons = [];
    const flags = {};
    let linkTarget = null;

    // §1: triple — use pre-computed override if provided, else derive
    let triple;
    if (params.triple && typeof params.triple === 'object') {
      triple = params.triple;
      reasons.push('triple: pre-computed override (skipping §1 derivation)');
    } else if (signals.decisionKind && signals.decisionScope) {
      // signals already has derived kind/scope (extended form from intake)
      triple = {
        primaryContext: signals.primaryContext ?? { type: 'platform', id: 'platform' },
        decisionKind: signals.decisionKind,
        decisionScope: signals.decisionScope,
      };
      reasons.push('triple: resolved from pre-derived signals.decisionKind/decisionScope');
    } else {
      const ctxResult = derivePrimaryContext(work, businessMatch);
      const { primaryContext, provisional } = ctxResult;
      if (provisional) flags.provisionalContext = true;
      reasons.push(ctxResult.reason);

      const kindResult = deriveDecisionKind(work, tier, businessMatch, objectiveLower, policy);
      const decisionKind = DECISION_KINDS.includes(kindResult.kind) ? kindResult.kind : 'ARCHITECTURE';
      reasons.push(kindResult.reason);

      const scopeResult = deriveDecisionScope(work, tier, decisionKind, primaryContext, objectiveLower, policy);
      const decisionScope = DECISION_SCOPES.includes(scopeResult.scope) ? scopeResult.scope : 'workflow';
      reasons.push(scopeResult.reason);

      triple = { primaryContext, decisionKind, decisionScope };
    }

    const { decisionKind, decisionScope } = triple;

    // HR-1: explicit ADR ref wins (§7, highest precedence)
    const adrRefMatch = objective.match(/\bADR-(\d{4})\b/);
    if (adrRefMatch) {
      const refId = `ADR-${adrRefMatch[1]}`;
      const refRow = rows.find((r) => r.id === refId);
      if (refRow?.status === 'accepted' || refRow?.status === 'legacy') {
        const mode = refRow.status === 'legacy' ? 'LEGACY_GRANDFATHERED' : 'COVERED_BY_ACCEPTED';
        linkTarget = refId;
        reasons.push(`HR-1: explicit ADR ref ${refId} resolves to eligible row → force LINK (${mode})`);
        return { needVerdict: 'required', materialityScore: 0, triple, routineCovered: false, coverageMode: mode, linkTarget, reasons, flags };
      }
      if (refRow?.status === 'superseded') {
        reasons.push(`HR-1: explicit ADR ref ${refId} is superseded → SUPERSEDED_NOT_GOVERNING`);
        return { needVerdict: 'required', materialityScore: 0, triple, routineCovered: false, coverageMode: 'SUPERSEDED_NOT_GOVERNING', linkTarget: null, reasons, flags };
      }
      reasons.push(`HR-1: ADR ref ${refId} not found in registry — ignored, continue scoring`);
    }

    // §2.2: materiality score
    const extSignals = { ...signals, decisionKind, decisionScope, objectiveLower, policy };
    const matResult = computeMateriality(extSignals);
    const matScore = matResult.score;
    const { needSignals } = matResult;
    const activeSignals = Object.entries(needSignals).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none';
    reasons.push(`materialityScore=${matScore} (band: ${matResult.band}); active signals: ${activeSignals}`);

    // HR-4 / HR-5: force material, refuse routine path
    const forceMaterial = needSignals.regulatedDomain || needSignals.irreversible;
    if (forceMaterial) {
      const why = [needSignals.regulatedDomain && 'HR-4 regulated domain', needSignals.irreversible && 'HR-5 irreversible token'].filter(Boolean).join(', ');
      reasons.push(`${why}: need verdict floored at required; routine path refused (RC4)`);
    }

    // §3: routine coverage (only when NOT force-material and kind qualifies)
    let routineCovered = false;
    let routineAdrId = null;
    if (!forceMaterial && decisionKind === 'ROUTINE_OPERATION_GOVERNANCE') {
      const rc = detectRoutineCoverage(triple, rows, objectiveLower, matScore, policy);
      routineCovered = rc.covered;
      routineAdrId = rc.adrid;
      reasons.push(rc.reason);
    }

    // §2.4 verdict resolution order
    const bandRequired = policy.materialityBands?.required ?? 6;
    const bandRecommended = policy.materialityBands?.recommended ?? 3;
    let needVerdict;
    let coverageMode;
    if (routineCovered) {
      needVerdict = 'none';
      coverageMode = 'ROUTINE_COVERED';
      reasons.push(`verdict: none — routine covered by ${routineAdrId}`);
    } else if (forceMaterial || matScore >= bandRequired) {
      needVerdict = 'required';
      coverageMode = 'NEEDS_DECISION';
      if (!forceMaterial) reasons.push(`verdict: required (score ${matScore} >= ${bandRequired})`);
    } else if (matScore >= bandRecommended) {
      needVerdict = 'recommended';
      coverageMode = 'NEEDS_DECISION';
      reasons.push(`verdict: recommended (score ${matScore} in recommended band)`);
    } else {
      // HR-6: never drop below recommended when materialKind is true
      needVerdict = needSignals.materialKind ? 'recommended' : 'none';
      coverageMode = 'NEEDS_DECISION';
      reasons.push(`verdict: ${needVerdict} (score ${matScore} in none band${needSignals.materialKind ? '; HR-6 floor at recommended' : ''})`);
    }

    // HR-7 + proposal-pending advisory
    applyAdvisoryFlags(rows, triple, flags, reasons);

    if (!DECISION_COVERAGE_MODES.includes(coverageMode)) coverageMode = 'NEEDS_DECISION';

    return { needVerdict, materialityScore: matScore, triple, routineCovered, coverageMode, linkTarget, reasons, flags };
  } catch {
    // Fail-open: never throw, never break the intake flow (immutable rule 2).
    return { ...FAIL_OPEN, reasons: ['classifyDecisionNeed: caught exception — fail-open'] };
  }
}
