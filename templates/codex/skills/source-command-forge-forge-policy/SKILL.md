---
name: "source-command-forge-forge-policy"
description: "Print the resolved cost / compliance / quality policies + fallback chain for one forged Agent Package. Read-only. (agent-forge squad)"
---

# source-command-forge-forge-policy

Use this skill when the user asks to run the migrated source command `forge-policy`.

## Command Template

# 🛠️ Mode: agent-forge — policy

Run `node contextkit/squads/agent-forge/cli/forge-ops.mjs policy $ARGUMENTS`.

Requires the optional `yaml` dep (ADR-0013). Reads the 4 governance YAMLs and
prints the live values (not the templates).

## Use this when
- The dev asks "what's this agent's monthly cap?" → look at `cost.budgets`.
- A residency review needs the `denied_providers` list → `compliance.data_residency`.
- Confirming the eval gate thresholds before a release → `quality.eval_gates.pre_release`.
