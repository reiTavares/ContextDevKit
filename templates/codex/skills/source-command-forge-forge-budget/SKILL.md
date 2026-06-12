---
name: "source-command-forge-forge-budget"
description: "Aggregate monthly target + hard-cap across every forged Agent Package — the consolidated cost view. Read-only. (agent-forge squad)"
---

# source-command-forge-forge-budget

Use this skill when the user asks to run the migrated source command `forge-budget`.

## Command Template

# 🛠️ Mode: agent-forge — budget

Run `node contextkit/squads/agent-forge/cli/forge-ops.mjs budget $ARGUMENTS`.

Sums `spec.cost.monthly_budget_usd` across every package and surfaces the
per-agent breakdown. The hard cap = target × 1.5 per the governance default.

## Surface to the dev
- If the aggregate hard cap exceeds the project's monthly LLM budget, this is
  the time to surface it — recommend lowering `cost.target_usd_per_call` on the
  agents driving the budget or moving sub-tasks to `cheap_path`.
