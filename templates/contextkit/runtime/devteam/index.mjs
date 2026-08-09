/**
 * index.mjs — public surface of the Devteam Agents & Skills capability
 * (ADR-0128 §9-§12/§18, WF-0064). This is the single entry point downstream
 * workflows (WF-0065 lifecycle, WF-0067 enforcement) import — it defines the
 * contract and keeps the internals private (best-practices S2).
 *
 * The capability is deterministic, host-neutral, and advisory. It returns
 * recommendations only; it does not dispatch, persist counters, or grant power.
 *
 * @module devteam
 */
export { loadDevteamPolicyBundle, loadDevteamPolicyTable, DEVTEAM_POLICY_TABLES } from './policy-load.mjs';
export { resolveRecommendedAgents } from './recommended-agents.mjs';
export { resolveRecommendedSkills, BASELINE_SKILLS } from './recommended-skills.mjs';
export { playbookSteps, stepsForProfile, validatePlaybookOrder, PLAYBOOK_STEP_ORDER } from './playbook.mjs';
