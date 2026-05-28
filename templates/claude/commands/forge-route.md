---
description: Re-execute the model-router against the current capability-matrix + decision-rules for one Agent Package and DIFF vs the live manifest. Read-only — no manifest is touched. (agent-forge squad)
argument-hint: <agent>[@<version>] [--json]
---

# 🛠️ Mode: agent-forge — re-route

Run `node vibekit/squads/agent-forge/cli/forge-eval-cli.mjs route $ARGUMENTS`.

Surfaces "would the router pick the same primary now?" — useful after
`/forge-refresh-matrix` or after a new ADR adds a model.

## When the diff shows a change
- Propose `/new-adr` to record the proposed model swap + the reason.
- Then re-forge the agent with `/forge-new` (semver bump per the manifest
  CHANGELOG: model swap within same family = patch, family change = minor).
- Do NOT hand-edit `manifest.yaml` — the next forge will overwrite it.
