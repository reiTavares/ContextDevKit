---
description: Tally the audit log for a forged Agent Package — call counts by outcome, fallback rate, cost summary. Read-only. (agent-forge squad)
argument-hint: <agent>[@<version>] [--json]
---

# 🛠️ Mode: agent-forge — audit

Run `node vibekit/squads/agent-forge/cli/forge-ops.mjs audit $ARGUMENTS`.

Reads `audit/<agent>.jsonl` (the runtime adapter writes it per
`governance/compliance.policy.yaml.audit.destination`) and reports totals.

## Interpret
- Many `refused` → review the prompt; the agent is over-refusing.
- High `fallbacks` → the primary provider is unstable; consider `/forge-route` to re-evaluate.
- Cost drift vs `forge-budget` → flag and recommend `/forge-policy` review.
