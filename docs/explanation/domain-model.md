# Work and governance domain model

ContextDevKit 4 keeps authorities small and explicit.

The central design rule is that **classification values, durable ownership, execution state, and human-facing projections are different things**. Conflating them creates the same kind of ambiguity ContextDevKit is meant to remove.

## Interaction and Intake Envelope

Interaction intent is transient dispatcher state, not project memory.

The interaction classifier produces one of:

```text
conversation | exploration | mutation | unclassified
```

Only `mutation` proceeds into durable work classification.

After mutation is confirmed, the runtime can assemble a transient **Intake Envelope** from existing signals:

```text
interaction
existingWork
nature
executionMode
tier
domain
valueIntent
decisionNeed
decisionMatch
businessMatch
reasons
evidence
```

The Intake Envelope is a value/view, not a new persisted aggregate. It exists to give the active agent one coherent interpretation of the request without inventing another state authority.

## Durable aggregates and authorities

| Aggregate/value | Authority |
| --- | --- |
| interaction intent | transient dispatcher context |
| Intake Envelope | transient composition of intake signals |
| business context | `memory/business/BIZ-*` |
| operation context | `memory/operations/OP-*` |
| workflow definition | `workflow.json` |
| workflow execution state | `workflow-state.json` |
| tasks and task status | scoped `pipeline/tasks.json` |
| human task view | derived `pipeline/tasks.md` |
| pipeline/run state | `memory/runs/<run-id>/state.json` |
| owner recommendations | `memory/preferences/owner-preferences.json` |
| workspace claims | `.claude/.workspace/` |

## Business, Operation, and none

Work nature is an ownership classification, not a pipeline stage.

- **Business** represents durable strategic value or a long-lived decision/capability.
- **Operation** represents durable operational, maintenance, recovery, or improvement context around existing capability.
- **none** means the work does not justify durable Business or Operation ownership.
- **unclassified** means competing evidence requires clarification.

`none` is intentionally normal. The system must not invent an Operation merely to provide a folder for ordinary work.

A Business relationship suggested for an Operation is not the same as a confirmed ownership relationship. Deterministic matching can propose; project/human governance confirms.

## Execution shape is separate

Execution shape describes coordination topology:

```text
direct | batch | workflow
```

A Business may own direct, batch, or Workflow work. An Operation may do the same. Neutral work may also be direct, batch, or Workflow.

This separation prevents semantic words such as "architecture", "Business", or "migration" from automatically expanding ceremony.

## Task aggregate

The task aggregate protects:

- legal status transitions;
- dependency references;
- acceptance criteria;
- evidence references for completion;
- report references;
- CAS revision;
- atomic status/event pairing.

Events are audit detail inside the canonical task document. They are not an alternate status authority.

A QA rejection from `testing` or `done` starts a fresh backlog cycle. Current-cycle evidence is cleared where required while historical events remain available. This is how the task model supports evidence-driven engineering loops without pretending previous evidence proves a new implementation.

## Workflow aggregate

The Workflow aggregate derives lifecycle only from `workflow-state.json`.

Active packages live under `workflows/`. After JSON-first completion, a complete validated package may be placed under the corresponding `done/` root for human navigation. Placement does not become lifecycle authority.

A completed Workflow can reopen when later feedback rejects a task it owns. The aggregate returns to an active state before the new task cycle proceeds.

Reports, Markdown, and directory placement never duplicate or infer state.

## Reports and authored context

Workflow reports contain factual execution evidence, findings, unresolved blockers, and completion information.

Authored files such as PRD, SPEC, decisions, and ADRs carry engineering intent and rationale. They are required context for the agent when the Workflow contract says they exist, but they do not compete with JSON lifecycle authorities.

## Preferences and personalization

`owner-preferences.json` stores recommendation-only structured preferences.

`personalization.md` stores explicit project-specific owner guidance.

Neither is an authorization token. Current owner instruction remains the decision boundary inside the project, subject to real system/platform safety controls.

## Compatibility boundary

Compatibility with 3.x exists only inside the explicit offline migrator.

Normal runtime never infers task status from legacy lanes, Workflow v1 plans, or retired sidecars.

## Core invariant

> **One kind of state has one writable authority; everything else is context, evidence, recommendation, or projection.**
