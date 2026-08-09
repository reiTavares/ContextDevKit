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

The workflow aggregate derives lifecycle only from `workflow-state.json`.
Active packages live under `workflows/`; after JSON-first completion, the whole
validated package is atomically placed under the corresponding `done/` root as
a human navigation projection. Reports, Markdown, and directory placement do
not duplicate or infer state. Compatibility with 3.x exists only in the
explicit migration boundary.
