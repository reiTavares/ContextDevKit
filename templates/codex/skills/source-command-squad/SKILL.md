---
name: "source-command-squad"
description: "Show/route/grow/audit the agent squads — the roster, playbooks, active routing, and onboarding config."
---

# source-command-squad

Use this skill when the user asks to run the migrated source command `squad`.

## Command Template

# 👥 Squads

The sub-agents are organized into **squads** (see `contextkit/squads/README.md`):
**devteam** (constructive — build + review), **qa-team** (adversarial — verify behaviour),
**security-team** (AppSec & infrastructure), **compliance-team** (privacy & laws),
**ops-team** (CI/CD workflows), **design-team** (UI/UX design), **growth-team** (acquisition & retention),
and **agent-forge** (custom capability packaging).

Act on **$ARGUMENTS**:

## show (default)
Run `node contextkit/tools/scripts/squad.mjs list` (agents + briefings) and read `contextkit/squads/README.md`.

## route <task-or-path>
Analyze active git modifications or keyword intent and dynamically map to the correct squad, agent, and playbook:
```
node contextkit/tools/scripts/squad.mjs route <task-or-path>
```
It queries the squads-registry to identify the target postures and suggests custom agent scaffolding from `agent-forge` if third-party libraries (e.g. Stripe, Redis) lack dedicated agent coverage.

## brief <agent>
Scaffold the **tier-2 rich briefing**, then fill it:
```
node contextkit/tools/scripts/squad.mjs brief <agent>
```

## new-squad <name>
Add a new squad (e.g. `support-team`, `data-team`) and update the manifest roster.

## generate-playbooks
Scaffold the 8 default squad playbooks under `contextkit/workflows/playbooks/squads/` based on stack detection:
```
node contextkit/tools/scripts/squad.mjs generate-playbooks
```
These are synced/preserved across engine updates (ADR-0054).
