<!--
  GENERATED in Fase 1 by `prompt-engineer` from system.canonical.md. Do not hand-edit.
  Anthropic (Claude): system prompt is a SEPARATE param (not in messages[]). Use XML
  sections; mark stable blocks with cache_control. Structured output via a single-tool
  schema (no native JSON mode).
-->
<role>{{ROLE_ONE_LINE}}</role>

<context cache="ephemeral">
{{STABLE_BACKGROUND}}
</context>

<rules>
- {{AFFIRMATIVE_RULE_1}}
</rules>

<output>{{OUTPUT_CONTRACT}}</output>

<examples>{{FEW_SHOT}}</examples>
