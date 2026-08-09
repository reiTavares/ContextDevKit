# Work and governance domain model

ContextDevKit 4 keeps authorities small and explicit:

| Aggregate/value | Authority |
| --- | --- |
| interaction intent | transient dispatcher context |
| business context | `memory/business/BIZ-*` |
| operation context | `memory/operations/OP-*` |
| workflow definition | `workflow.json` |
| workflow execution state | `workflow-state.json` |
| tasks and task status | scoped `pipeline/tasks.json` |
| human task view | derived `pipeline/tasks.md` |
| workspace claims | `.claude/.workspace/` |

The task aggregate protects legal status transitions, dependency references,
evidence for `done`, CAS revision, and atomic status/event pairing. Events are
optional audit detail; they are not status authority.

The workflow aggregate never moves directories because of status. Reports and
Markdown store references or projections, not duplicate state. Compatibility
with 3.x exists only in the explicit migration boundary.
