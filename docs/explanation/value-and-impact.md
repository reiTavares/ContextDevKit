# Value and impact

<!-- GENRE: Explanation (understanding-oriented) -->

ContextDevKit turns project context into durable, inspectable engineering state
without making ceremony the permission system.

## What it protects

- Decisions and their rationale survive across sessions.
- Workflows and tasks have one JSON authority, stable paths, revisions, events,
  dependencies, and evidence references.
- Host hooks share one small governance registry and one dispatcher per event.
- Generated documentation and host projections can be rebuilt and checked for
  drift.
- Explicit migration preserves user data while removing executable compatibility
  from normal runtime paths.

## Proportional governance

Conversation and exploration perform no project writes. A real mutation attempt
activates work intake once, reuses an existing context when evidence is strong,
and chooses direct, batch, or workflow execution from actual topology.

Most signals are shadow or canary observations. Only QA sign-off, deterministic
DDD invariants, and new high/critical technical debt may be guarded. Resolver
errors and missing optional evidence continue in canary; real host confirmations
still protect destructive external actions.

## Agent and model economics

Specialists, swarms, context packs, compact output, and model recommendations are
tools. They can reduce elapsed time and token cost, but they do not authorize,
deny, or reorder work. Unknown cost/quota data is reported as skipped rather than
fabricated as a saving.

## Trade-offs

The kit adds schemas, explicit revisions, migration work, and release evidence.
Those costs are justified when a project spans consequential decisions, multiple
sessions, or parallel contributors. Small direct changes remain direct and do not
need a durable workflow by default.

The owner retains the final choice. ContextDevKit supplies memory, deterministic
state transitions, bounded checks, and honest diagnostics; it does not replace
platform permission boundaries or human accountability.

See [Governance and enforcement](governance-and-enforcement.md),
[Domain model](domain-model.md), and [Data posture](../reference/data-posture.md).
