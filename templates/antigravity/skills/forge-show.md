# Skill: forge-show

> Display the manifest, provenance, and last eval timestamp for one forged Agent Package. Read-only. (agent-forge squad)
> Argument: <agent>[@<version>] [--json]
# 🛠️ Mode: agent-forge — show package

Run `node contextkit/squads/agent-forge/cli/forge-ops.mjs show <user-specified argument>`.

Requires the optional `yaml` dep (ADR-0013) to parse `manifest.yaml`. If absent,
suggest `npm i yaml`.

## What to surface
- The routed `primary` and `fallback` (with the cross-provider check).
- `eval_passed_at` — if `NEVER`, refuse to recommend deployment until `/forge-eval` passes.
- `blueprint_hash` — must match across forge runs to prove provenance.
