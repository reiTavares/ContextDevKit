/**
 * Advisory skill recommendations from the declared trigger table.
 *
 * A trigger ROW matches when ALL of its declared conditions hold (AND); a skill
 * is recommended when ANY of its rows matches (OR). All thresholds live in
 * skill-triggers.json, never in this engine. Callers decide whether to use a
 * recommendation; no skill is auto-applied.
 *
 * Pure — no I/O; the caller injects the policy table. A degraded/missing table
 * yields a small fallback suggestion for code work plus an explicit diagnostic.
 * Selection is neither proof nor a completion prerequisite.
 *
 * @module devteam/recommended-skills
 */

/** Advisory fallback when the trigger table is unavailable. */
export const BASELINE_SKILLS = Object.freeze(['senior-implementation']);

/**
 * Resolves the deterministic skill set for one classified request.
 *
 * @param {object} cmis CMIS result (`{ score, verdict }`) from WF-0063.
 * @param {object} das DAS result (`{ score }`) from WF-0063.
 * @param {object} profile resolved profile result (`{ profile }`) from WF-0063.
 * @param {object} [ctx] declared context: `{ flags: {name: boolean}, risk,
 *   blastRadius, complexity }` — absent flags are simply false.
 * @param {object} [triggersTable] skill-triggers.json table (injected).
 * @returns {{ skills: string[], selections: Array<{skill: string, reasonCode: string}>,
 *   reasonCodes: string[], degraded: boolean }}
 */
export function resolveRecommendedSkills(cmis, das, profile, ctx, triggersTable) {
  const inputs = normalizeInputs(cmis, das, profile, ctx);
  if (inputs.profileName === 'no-code') {
    return { skills: [], selections: [], reasonCodes: ['SKILLS_NO_CODE'], degraded: false };
  }
  const table = triggersTable && typeof triggersTable === 'object' ? triggersTable.skills : null;
  if (!table || typeof table !== 'object') {
    return {
      skills: [...BASELINE_SKILLS],
      selections: BASELINE_SKILLS.map((skill) => ({ skill, reasonCode: 'SKILLS_FALLBACK_BASELINE' })),
      reasonCodes: ['SKILLS_FALLBACK_BASELINE'],
      degraded: true,
    };
  }

  const selections = [];
  for (const [skillId, entry] of Object.entries(table)) {
    const rows = Array.isArray(entry?.triggers) ? entry.triggers : [];
    const matched = rows.find((row) => rowMatches(row, inputs));
    if (matched) selections.push({ skill: skillId, reasonCode: matched.reasonCode ?? 'SKILL_TRIGGER_MATCHED' });
  }
  return {
    skills: selections.map((s) => s.skill),
    selections,
    reasonCodes: [...new Set(selections.map((s) => s.reasonCode))],
    degraded: false,
  };
}

/**
 * Evaluates one trigger row (AND of its declared conditions) against the
 * normalized inputs. Unknown fields are ignored (append-only table evolution).
 *
 * @param {object} row trigger row from skill-triggers.json.
 * @param {object} inputs from normalizeInputs().
 * @returns {boolean}
 */
function rowMatches(row, inputs) {
  if (!row || typeof row !== 'object') return false;
  if (Number.isFinite(row.cmisMin) && !(inputs.cmisScore >= row.cmisMin)) return false;
  if (Number.isFinite(row.cmisMax) && !(inputs.cmisScore <= row.cmisMax)) return false;
  if (Number.isFinite(row.dasMin) && !(inputs.dasScore >= row.dasMin)) return false;
  if (Number.isFinite(row.dasMax) && !(inputs.dasScore <= row.dasMax)) return false;
  if (Array.isArray(row.profileIn) && !row.profileIn.includes(inputs.profileName)) return false;
  if (Array.isArray(row.riskIn) && !row.riskIn.includes(inputs.risk)) return false;
  if (Array.isArray(row.blastRadiusIn) && !row.blastRadiusIn.includes(inputs.blastRadius)) return false;
  if (Array.isArray(row.complexityNotIn) && row.complexityNotIn.includes(inputs.complexity)) return false;
  if (Array.isArray(row.flagsAll) && !row.flagsAll.every((f) => inputs.flags[f] === true)) return false;
  return true;
}

/**
 * Normalizes the scorer results + declared context into flat, defensive inputs.
 * Missing values become neutral (score 0, empty flags) — a trigger never fires
 * on absent evidence.
 */
function normalizeInputs(cmis, das, profile, ctx) {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  return {
    cmisScore: Number.isFinite(Number(cmis?.score)) ? Number(cmis.score) : 0,
    dasScore: Number.isFinite(Number(das?.score)) ? Number(das.score) : 0,
    profileName: typeof profile?.profile === 'string' ? profile.profile : typeof profile === 'string' ? profile : null,
    risk: typeof c.risk === 'string' ? c.risk : null,
    blastRadius: typeof c.blastRadius === 'string' ? c.blastRadius : null,
    complexity: typeof c.complexity === 'string' ? c.complexity : null,
    flags: c.flags && typeof c.flags === 'object' ? c.flags : {},
  };
}
