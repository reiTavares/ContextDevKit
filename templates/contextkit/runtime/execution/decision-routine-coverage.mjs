/**
 * decision-routine-coverage.mjs — §3 routine-coverage detection for the B2-T1
 * decision-need classifier (BIZ-0001 / WF-0037, ADR-0102).
 *
 * Extracted from `decision-need-classifier.mjs` as a distinct responsibility
 * seam (mirrors the §1 `decision-triple.mjs` extraction): the RC1..RC4 gate that
 * decides whether a standing ROUTINE_OPERATION_GOVERNANCE ADR already covers a
 * unit of work is conceptually separate from the materiality/verdict pipeline
 * that consumes its boolean. One consumer today (the classifier); the seam keeps
 * the classifier under the 280-line yellow zone.
 *
 * Pure: no I/O, no LLM, no Math.random. Defaults to `covered:false` (the material
 * path is the safe default — constitution §8 "refuse-to-false-negative").
 *
 * @module decision-routine-coverage
 */

/**
 * Checks RC1..RC4 (§3 of B2-design-decision-table.md). Returns `covered:false`
 * by default (the material path is the safe default).
 *
 * @param {{ primaryContext: object, decisionKind: string }} triple
 * @param {object[]} rows - flat registry rows.
 * @param {string} objectiveLower - lowercased objective.
 * @param {number} matScore - computed materiality score.
 * @param {object} policy - decision-intelligence policy.
 * @returns {{ covered: boolean, adrid: string|null, reason: string }}
 */
export function detectRoutineCoverage(triple, rows, objectiveLower, matScore, policy) {
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
