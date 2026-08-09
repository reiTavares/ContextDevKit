---
name: "source-command-forge-forge-show"
description: "Display the manifest, provenance, and last eval timestamp for one forged Agent Package. Read-only. (agent-forge squad)"
---

# source-command-forge-forge-show

Use this skill when the user asks to run the migrated source command `forge-show`.

## Command Template

# 🛠️ Mode: agent-forge — show package

Run `node contextkit/squads/agent-forge/cli/forge-ops.mjs show $ARGUMENTS`.

Requires the optional `yaml` dep (ADR-0013) to parse `manifest.yaml`. If absent,
suggest `npm i yaml`.

## What to surface
- The routed `primary` and `fallback` (with the cross-provider check).
- `eval_passed_at` — if `NEVER`, refuse to recommend deployment until `/forge-eval` passes.
- `blueprint_hash` — must match across forge runs to prove provenance.
