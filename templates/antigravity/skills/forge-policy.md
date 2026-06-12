# Skill: forge-policy

> Print the resolved cost / compliance / quality policies + fallback chain for one forged Agent Package. Read-only. (agent-forge squad)
> Argument: <agent>[@<version>] [--json]
# 🛠️ Mode: agent-forge — policy

Run `node contextkit/squads/agent-forge/cli/forge-ops.mjs policy <user-specified argument>`.

Requires the optional `yaml` dep (ADR-0013). Reads the 4 governance YAMLs and
prints the live values (not the templates).

## Use this when
- The dev asks "what's this agent's monthly cap?" → look at `cost.budgets`.
- A residency review needs the `denied_providers` list → `compliance.data_residency`.
- Confirming the eval gate thresholds before a release → `quality.eval_gates.pre_release`.
