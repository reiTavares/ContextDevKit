# Glossary

| Term | Meaning | Authority |
| --- | --- | --- |
| harness | host-agnostic engineering layer around coding agents that preserves project intelligence, memory, work state, governance, evidence, and continuity | architecture/runtime contract |
| interaction | one user turn classified as conversation, exploration, mutation, or unclassified | transient dispatcher context |
| mutation | explicit requested state change or a real write attempt | current owner instruction/tool event |
| Intake Envelope | transient normalized view of interaction, existing-work, work-nature, execution-shape, complexity, decision, match, reasons, and evidence signals | derived runtime value; never a persisted authority |
| existing work | normalized resolution of whether mutation belongs to explicit, inferred, ambiguous, new, or no prior work | transient intake signal |
| work nature | durable ownership classification: `business`, `operation`, `none`, or `unclassified` | deterministic work classifier |
| business | durable strategic capability, product, initiative, or decision with long-lived value/outcome context | `memory/business/BIZ-*` |
| operation | durable maintenance, incident, recovery, refactor, or improvement context for existing capability | `memory/operations/OP-*` |
| none | normal work-nature result when no durable Business or Operation context is justified | deterministic work classifier |
| execution shape | coordination topology chosen independently of work nature: `direct`, `batch`, or `workflow` | deterministic work classifier / active work contract |
| direct | small cohesive work, typically one to three tasks | scoped task store or active agent execution |
| batch | several related tasks, typically four to twelve, without strong ordering | batch `tasks.json` |
| workflow | multi-step work with dependencies, waves, cutover, rollback, multi-session ordering, or explicit Workflow intent | `workflow.json` |
| workflow state | aggregate phase/status and compact execution metadata | `workflow-state.json` |
| task | scoped unit of work with priority, dependencies, acceptance, reports, and evidence | `pipeline/tasks.json` |
| task projection | human-readable rendering of canonical tasks | `pipeline/tasks.md` |
| engineering loop | project-level cycle of implementation, evaluation, findings, correction, fresh evaluation, and evidence-backed completion | task/workflow state + reports/evidence |
| evaluator | QA, DDD, architecture, debt, review, security, performance, or other analysis that produces engineering evidence | evaluator-specific implementation |
| quality floor | configured deterministic condition intended to protect a completion/write boundary | governance gate registry + project config |
| gate | policy evaluation resolved to `off`, `shadow`, `canary`, or `guarded` | gate registry and gate-mode resolver |
| guarded | mode that may deny only at documented moments with a complete deterministic/applicable/evidenced predicate | canonical governance runtime |
| canary | mode that evaluates and reports findings without denying execution | canonical governance runtime |
| shadow | mode that observes without changing the outcome | canonical governance runtime |
| guarded quality floors | QA at completion, applicable DDD Class A invariants, and new high/critical technical debt introduced by the current diff | canonical governance runtime |
| Architecture Debt | structural architecture analysis that is canary by default and may produce evidence without becoming a fourth guarded domain | architecture-debt evaluator/gate |
| Technical Debt | debt evaluation whose guarded predicate applies only to new high/critical debt introduced by the current diff | technical-debt gate |
| owner sovereignty | project-governance rule that current explicit owner intent remains the project decision boundary; guarded findings can be configured or explicitly overridden while evidence remains truthful | `humanAuthority: owner-wins` + override metadata |
| human override | explicit scoped owner decision with actor, reason, policy provenance, revision, time window, and outcome | governed override metadata |
| recommendation | graph, agent, model, economy, simulation, council, specialist, or workflow-depth advice | never execution authority |
| code-reviewer | specialist for material diff review; strongly useful but not a required-agent receipt outside explicit pipeline steps | agent registry/projection |
| claim | explicit local path/task association used to warn parallel sessions | `.claude/.workspace/` |
| report | factual record of changes, tests, decisions, blockers, findings, and next steps | workflow/batch `reports/` |
| fresh evidence | evidence produced for the current implementation/QA cycle rather than reused from a prior rejected cycle | canonical task evidence references/events |
| migration bundle | out-of-runtime backup, manifest, mapping, and rollback evidence for v3 data | explicit v3-to-v4 migrator output |

`backlog`, `working`, `blocked`, `testing`, `done`, and `cancelled` are task status values, not directory names.
