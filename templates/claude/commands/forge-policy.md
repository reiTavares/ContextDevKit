---
description: Print the resolved cost / compliance / quality policies + fallback chain for one forged Agent Package. Read-only. (agent-forge squad)
argument-hint: <agent>[@<version>] [--json]
---

# 🛠️ Mode: agent-forge — policy

Run `node vibekit/squads/agent-forge/cli/forge-ops.mjs policy $ARGUMENTS`.

Requires the optional `yaml` dep (ADR-0013). Reads the 4 governance YAMLs and
prints the live values (not the templates).

## Use this when
- The dev asks "what's this agent's monthly cap?" → look at `cost.budgets`.
- A residency review needs the `denied_providers` list → `compliance.data_residency`.
- Confirming the eval gate thresholds before a release → `quality.eval_gates.pre_release`.
