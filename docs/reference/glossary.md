# Glossary

| Term | Meaning | Authority |
| --- | --- | --- |
| interaction | one user turn classified as conversation, exploration, mutation, or unclassified | transient dispatcher context |
| mutation | explicit requested state change or a real write attempt | current owner instruction/tool event |
| workflow | multi-step work with dependencies, waves, cutover, rollback, or multi-session ordering | `workflow.json` |
| workflow state | aggregate phase/status and compact execution metadata | `workflow-state.json` |
| task | scoped unit of work with priority, dependencies, acceptance, and evidence | `pipeline/tasks.json` |
| task projection | human-readable rendering of canonical tasks | `pipeline/tasks.md` |
| batch | four to twelve related tasks without strong ordering | batch `tasks.json` |
| operation | durable maintenance/incident/refactor context for an existing capability | `memory/operations/OP-*` |
| business | durable strategic capability/decision with outcome and investment context | `memory/business/BIZ-*` |
| gate | deterministic check resolved to off, shadow, canary, or guarded | gate registry and gate-mode resolver |
| guarded gate | one of QA at done, applicable DDD Class A, or new high/critical deterministic debt | canonical governance runtime |
| human override | explicit owner decision with actor, reason, timestamp, scope, and risk acknowledgement | governed transition metadata |
| recommendation | graph, agent, model, economy, simulation, council, or specialist advice | never execution authority |
| claim | explicit local path/task association used to warn parallel sessions | `.claude/.workspace/` |
| report | factual record of changes, tests, decisions, blockers, and next steps | workflow/batch `reports/` |
| migration bundle | out-of-runtime backup, manifest, mapping, and rollback evidence for v3 data | explicit v3-to-v4 migrator output |

`backlog`, `working`, `blocked`, `testing`, `done`, and `cancelled` are task
status values, not directory names.
