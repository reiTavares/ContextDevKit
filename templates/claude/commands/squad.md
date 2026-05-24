---
description: Show/route/grow the agent squads (devteam + qa-team) — the roster, when to use each, and how to add agents/squads.
argument-hint: [show | route <task> | brief <agent> | new-squad <name>]
---

# 👥 Squads

The sub-agents are organized into **squads** (see `vibekit/squads/README.md`):
**devteam** (constructive — build + review) and **qa-team** (adversarial — verify
behaviour). Agents live in `.claude/agents/` and install at **Level 4**.

Act on **$ARGUMENTS**:

## show (default)
Run `node vibekit/tools/scripts/squad.mjs list` (agents + which already have a
tier-2 briefing) and read `vibekit/squads/README.md`; summarize the squads, their
members, and when to use each. If `.claude/agents/` isn't present, note the project
is below Level 4 — suggest `/vibe-level 4` to enable the squads.

## route <task>
Pick the right squad/agent for the task and delegate (use the Agent tool to
invoke the sub-agent). Building/designing/reviewing → **devteam** (`architect` →
`code-reviewer`); testing/verifying → **qa-team** (via `qa-orchestrator`). For a
full feature, prefer `/ship` (orchestrates the whole squad with checkpoints).

## brief <agent>
Scaffold the **tier-2 rich briefing**, then fill it:
```
node vibekit/tools/scripts/squad.mjs brief <agent>
```
It auto-detects the agent's squad and creates `vibekit/squads/<squad>/<agent>.md`
from `_BRIEFING.md.tpl` (idempotent). Then **fill it** with real, specific content
for this project — anti-patterns, end-to-end recipes, edge cases — the deep
reference behind the lean `.claude/agents/<agent>.md`.

## new-squad <name>
Add a new squad (e.g. `design-team`, `product-team`, `ops-team`): create a
section in `vibekit/squads/README.md` with its mandate + roster, and scaffold its
agents from `.claude/agents/_TEMPLATE.md` (sharp `description`s). Keep the
sovereignty rule clear (who decides on conflict).

Remember the conflict rule: `code-reviewer` owns style/constitution;
`qa-orchestrator` owns behaviour/sign-off; devteam decides until you harden the
gates (`/vibe-level`).
