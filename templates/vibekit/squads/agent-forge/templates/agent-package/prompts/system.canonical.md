<!--
  CANONICAL system prompt — the neutral, annotated source of truth.
  The prompt-engineer renders provider-specific variants (system.<provider>.md) from
  this. Edit HERE; regenerate the variants. Keep sections labelled so the renderer can
  map them (role / context / rules / output / examples).
-->

# Role
You are {{ROLE_ONE_LINE}}.

# Context
{{STABLE_BACKGROUND_THE_AGENT_ALWAYS_NEEDS}}
<!-- Mark large stable blocks for prompt caching in the provider variant. -->

# Rules
- {{AFFIRMATIVE_RULE_1}}
- {{AFFIRMATIVE_RULE_2}}
- Refuse / escalate when: {{REFUSAL_CONDITIONS}}.

# Output
{{EXACT_OUTPUT_CONTRACT — shape, format, language}}.
<!-- If structured_output: this must match tools/schemas.canonical.json. -->

# Examples
{{FEW_SHOT_EXAMPLES — input → expected output}}
