---
name: "source-command-pipeline-swarm"
description: "Coordinate conditionally required parallel work over explicit, disjoint task scopes."
---

# source-command-pipeline-swarm

Use this skill when the user asks to run the migrated source command `swarm`.

## Command Template

# `/swarm` — bounded parallel execution

Use a swarm when the owner explicitly requests parallel agents or when the
selected workflow/skill requires concurrent independent workstreams. Outside
those triggers it remains optional. The requirement comes from the current work
contract, never from a routing receipt or an agent-count floor.

## Contract

1. Read tasks from one explicitly named workflow or batch `tasks.json`.
2. Select only ready tasks whose dependencies are satisfied.
3. Partition work by concrete ownership paths and avoid overlapping writers.
4. Respect the host's real concurrency limit; there is no semantic cap inferred
   from task type, roles, routing, or user profile.
5. Resolve current routing guidance before dispatch when available, but keep its
   model and specialist result advisory. Missing recommendations or legacy
   `decision`, `model`, `effort`, and `ruleId` fields do not cancel a swarm that
   is required by the current work contract.
6. Each worker returns the diff scope, tests, deviations, and remaining risks.
7. The coordinator integrates deliberately, reruns the relevant tests, and uses
   the canonical task writer for all status transitions.

## Commands

- `/swarm plan --tasks <scope>` — preview ready work and conflicts; read-only.
- `/swarm run --tasks <scope>` — execute the accepted plan on reversible
  branches/worktrees.
- `/swarm status --tasks <scope>` — report current task and worker state.

An explicit run request covers the reversible local work described by the plan.
Pushes, default-branch changes, secrets, production mutations, and other
destructive external actions still use the host's real confirmation boundary.

Never invent a global backlog, auto-create tasks, infer permission from a score,
or persist per-agent counters merely because parallel execution was considered.
