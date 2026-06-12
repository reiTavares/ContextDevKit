---
name: "source-command-forge-forge-audit"
description: "Tally the audit log for a forged Agent Package — call counts by outcome, fallback rate, cost summary. Read-only. (agent-forge squad)"
---

# source-command-forge-forge-audit

Use this skill when the user asks to run the migrated source command `forge-audit`.

## Command Template

# 🛠️ Mode: agent-forge — audit

Run `node contextkit/squads/agent-forge/cli/forge-ops.mjs audit $ARGUMENTS`.

Reads `audit/<agent>.jsonl` (the runtime adapter writes it per
`governance/compliance.policy.yaml.audit.destination`) and reports totals.

## Interpret
- Many `refused` → review the prompt; the agent is over-refusing.
- High `fallbacks` → the primary provider is unstable; consider `/forge-route` to re-evaluate.
- Cost drift vs `forge-budget` → flag and recommend `/forge-policy` review.
