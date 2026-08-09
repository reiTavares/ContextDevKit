# Skill: swarm

> Coordinate optional parallel work over explicit, disjoint task scopes.
# `/swarm` — bounded parallel execution

Use a swarm only when the owner requests parallel agents or when independent
workstreams materially reduce elapsed time. It is an execution helper, not an
authority or admission gate.

## Contract

1. Read tasks from one explicitly named workflow or batch `tasks.json`.
2. Select only ready tasks whose dependencies are satisfied.
3. Partition work by concrete ownership paths and avoid overlapping writers.
4. Respect the host's real concurrency limit; there is no semantic cap inferred
   from task type, roles, routing, or user profile.
5. Model and specialist suggestions are advisory. Missing recommendations or
   unavailable agents do not deny the work.
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
