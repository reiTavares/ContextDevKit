---
description: Forge a new portable Agent Package — interviews the dev (architect), routes to a provider (router), renders per-provider files (prompt-engineer + tool-designer), and packages the APF v1 under agent-packages/<name>@<semver>/. (agent-forge squad)
argument-hint: <agent-name>
---

# 🛠️ Mode: agent-forge — new package

You just entered the `agent-forge` flow. The objective: forge a portable Agent
Package for **$ARGUMENTS** (or for the name the developer gives during the interview).

## Posture for this session

1. **Engage the squad in order** — do NOT skip stages:
   - `forge-orchestrator` runs the pipeline.
   - `agent-architect` interviews → `agent_name` + `role_one_line` + the rest of `INTERVIEW_QUESTIONS`.
   - `model-router` selects provider/model + rationale.
   - `prompt-engineer` + `tool-designer` render the per-provider files.
   - `packager` assembles + stamps provenance.

2. **Refuse to skip the interview.** Defaults are safe, not informed.

3. **Verify before writing** — show the dev:
   - The Agent Blueprint (YAML).
   - The Provider Selection rationale (verbatim from the router).
   - The package target path: `agent-packages/<agent-name>@0.1.0/`.

4. **Run the CLI when the dev approves**: `node vibekit/squads/agent-forge/cli/forge-new.mjs --blueprint <path>`. The CLI requires the optional `yaml` dep (ADR-0013) — if absent, suggest `npm i yaml`.

5. **At the end**: confirm the APF passes its self-check (manifest parses; provider adapters import; canonical → variant round-trips). Eval gates land in Fase 3.

## Why this mode exists

`/forge-new` is the front door to agent-forge. It enforces the pipeline order,
blocks "just use defaults" shortcuts, and guarantees every Agent Package ships
with provenance + rationale.

## Out of scope here

- The Fase 3 eval gate (golden + red-team) + governance pillar enforcement + kill-switch wiring.
- The Fases 2+ providers (Gemini / DeepSeek / Ollama / vLLM).
- The Fase 4 maintenance commands (`/forge-refresh-matrix`, `/forge-route`, `/forge-budget`, `/forge-policy`, …).
