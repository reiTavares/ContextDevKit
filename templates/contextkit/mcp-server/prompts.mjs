/**
 * MCP-006 prompt definitions.
 *
 * Prompts are parameterised message templates the MCP client can materialise.
 * They do NOT call tools internally — they return a structured prompt the host
 * (Claude Code or another MCP client) injects into its context.
 *
 * [MCP-006, ADR-0073]
 */

// ─── Prompt catalog ──────────────────────────────────────────────────────────

/**
 * Static list of prompts exposed by this server. Consumed by the
 * prompts/list handler in server.mjs.
 */
export const PROMPT_LIST = [
  {
    name: 'plan-feature',
    description: 'Produce a PRD/SPEC plan for a new feature using ContextDevKit workflow conventions.',
    arguments: [
      { name: 'feature_name', description: 'Short name or slug for the feature', required: true },
      { name: 'objective', description: 'What problem this feature solves', required: true },
      { name: 'constraints', description: 'Known constraints (stack, time, scope)', required: false },
    ],
  },
  {
    name: 'review-architecture',
    description: 'Prepare an architecture review checklist against the ContextDevKit coding constitution.',
    arguments: [
      { name: 'scope', description: 'Module or subsystem to review', required: true },
      { name: 'focus', description: 'Specific concern (coupling/state/errors/naming/…)', required: false },
    ],
  },
  {
    name: 'prepare-qa',
    description: 'Generate a QA plan template for a feature or bug fix.',
    arguments: [
      { name: 'target', description: 'Feature name, ticket id, or component path', required: true },
      { name: 'risk_level', description: 'low / medium / high', required: false },
    ],
  },
  {
    name: 'resume-task',
    description: 'Reconstruct context for resuming an in-flight task from session logs and pipeline state.',
    arguments: [
      { name: 'task_id', description: 'Pipeline card id or workflow slug', required: true },
    ],
  },
  {
    name: 'analyze-impact',
    description: 'Map the blast radius of a proposed change before implementation (L5 pre-flight).',
    arguments: [
      { name: 'change_description', description: 'What you plan to change', required: true },
      { name: 'paths', description: 'Comma-separated file or module paths involved', required: false },
    ],
  },
];

// ─── Prompt builders ─────────────────────────────────────────────────────────

/**
 * Builds the messages array for a prompt invocation.
 *
 * @param {string} name - prompt name
 * @param {Record<string, string>} args - user-supplied argument values
 * @returns {{ messages: Array<{role: string, content: {type: string, text: string}}> }}
 */
export function getPrompt(name, args = {}) {
  const builder = BUILDERS[name];
  if (!builder) throw new Error(`Unknown prompt: ${name}`);
  const text = builder(args);
  return {
    messages: [
      {
        role: 'user',
        content: { type: 'text', text },
      },
    ],
  };
}

// ─── Individual builders ─────────────────────────────────────────────────────

function buildPlanFeature({ feature_name = '', objective = '', constraints = '' }) {
  return `You are a Staff/Principal Engineer operating under the ContextDevKit coding constitution.

Plan the feature **${feature_name}** using the standard workflow lifecycle (intake → prd → spec → adr → pipeline).

**Objective:** ${objective}
${constraints ? `**Constraints:** ${constraints}` : ''}

Produce:
1. **PRD** — Problem, Goals, Users/Jobs, Non-goals, Success metrics, Open questions
2. **SPEC executive summary** — Proposed design, interfaces/contracts, data flow, impact analysis
3. **ADR recommendation** — is a new ADR needed? If yes, state the decision, rationale, and alternatives.
4. **Pipeline cards** — 3–6 specific, sized tickets (id · title · priority · acceptance criteria)

Stay within the immutable rules: zero runtime deps on the hot path; hooks exit 0; every addition ships a test; Conventional Commits.`;
}

function buildReviewArchitecture({ scope = '', focus = '' }) {
  return `You are a Staff/Principal Engineer auditing **${scope}** against the ContextDevKit coding constitution.

${focus ? `Focus area: **${focus}**\n` : ''}
Run the following checklist (top-down, Tier 1 before Tier 2):

**TIER 1 — Architecture**
- S1 Dependency direction: do domain modules import infra?
- S2 Boundaries: is the public surface intentional?
- S3 Coupling/cycles: circular imports? god modules? excessive fan-out?
- S4 State: single source of truth per piece of state?

**TIER 2 — Module hygiene**
- H1 Size: any file > 240 lines (yellow) or > 308 lines (BLOCKER)?
- H2 SRP: functions needing "And"/"Or" in their name?
- H3 Separation: business logic leaking into transport/view layers?
- H4 Errors: swallowed exceptions? raw stack traces to users?
- H5 Naming: banned generic names (data, temp, obj, val, result, arr)?
- H6 Docs: non-trivial public functions without JSDoc @param/@returns?
- H7 Tests: happy-path-only? missing coverage of the failure modes the code handles?

For each finding, report: **severity (BLOCKER/HIGH/MEDIUM/LOW)** · rule · file:line · one-sentence fix.`;
}

function buildPrepareQA({ target = '', risk_level = 'medium' }) {
  return `Prepare a QA plan for **${target}** (risk: ${risk_level}).

Structure:
1. **Happy-path test cases** — the core success scenarios
2. **Edge cases and failure modes** — invalid inputs, missing deps, concurrent access
3. **Regression checks** — what existing behavior must NOT break
4. **Acceptance criteria** — the verifiable conditions that define "done"
5. **Manual smoke-test checklist** — for a human reviewer

Align with the kit's QA conventions: /test-plan → /scaffold-tests → /qa-signoff.
Each test case: **id · scenario · steps · expected outcome · pass/fail**.`;
}

function buildResumeTask({ task_id = '' }) {
  return `Reconstruct the context needed to resume task **${task_id}**.

Steps:
1. Look up the pipeline card for **${task_id}** (stage, title, priority, dependencies).
2. Find the most recent session log that mentions this task or its workflow.
3. Check the active workspace claims — is another session holding this task?
4. Summarise the last known state, what was completed, and what remains.
5. Propose the immediate next action with a verifiable success criterion.

Output format:
- **Current state**: <what is done>
- **Remaining**: <what is left>
- **Blockers**: <if any>
- **Next action**: <specific, checkable step>`;
}

function buildAnalyzeImpact({ change_description = '', paths = '' }) {
  return `Perform a blast-radius analysis (L5 pre-flight) for the following change.

**Change:** ${change_description}
${paths ? `**Paths involved:** ${paths}` : ''}

Analyse:
1. **Direct impacts** — files/modules that must change
2. **Indirect impacts** — consumers of changed interfaces (fan-in), imports of changed modules
3. **Ripple risk** — tests that will break; hooks/scripts affected; installed kit artifacts affected
4. **ADR implications** — does this change require a new ADR or supersede an existing one?
5. **Recommendation** — proceed / proceed with caution / stop and design first

Use the project map (if available) for the dependency graph. Be explicit about uncertainty — report "skipped" for checks that cannot run, never assume pass.`;
}

const BUILDERS = {
  'plan-feature': buildPlanFeature,
  'review-architecture': buildReviewArchitecture,
  'prepare-qa': buildPrepareQA,
  'resume-task': buildResumeTask,
  'analyze-impact': buildAnalyzeImpact,
};
