# Business-Driven Development

ContextDevKit treats software engineering as work performed in service of durable outcomes — without forcing every code change into a business hierarchy.

Business-Driven Development answers three different questions independently:

1. **Does this interaction represent real project work?**
2. **If it does, who or what durably owns the reason for that work?**
3. **What execution shape is actually necessary to deliver it?**

Keeping those questions separate prevents both under-governance and process inflation.

## Interaction comes before methodology

No Business, Operation, task, or Workflow should exist merely because a conversation happened.

ContextDevKit first classifies the interaction as:

```text
conversation
exploration
mutation
unclassified
```

Conversation and read-only exploration stop before durable work classification.

Only a confirmed mutation proceeds.

When mutation intent cannot be established, ContextDevKit asks one short clarification instead of guessing.

A real write attempt is authoritative and monotonically promotes the interaction to mutation for that revision.

This makes Business-Driven Development mutation-driven rather than conversation-driven.

## Existing work comes before new work

A confirmed mutation should not automatically become a new task or Workflow.

Before creating durable work, ContextDevKit can normalize whether the request belongs to:

```text
explicit     a work item directly identified by the request
inferred     a likely existing item
ambiguous    several plausible items
new          evidence supports creating new work
none         no durable existing context is established
```

An inferred or ambiguous item is not silently selected.

A completed item is not silently reopened.

This protects the project from a common AI-assisted development failure mode: repeatedly creating new plans for work the project already knows about.

## Work nature: Business, Operation, or none

Once mutation is confirmed, work nature describes durable ownership.

### Business

A Business is a durable strategic capability, product, initiative, or decision.

It exists when the project benefits from preserving a long-lived strategic context around outcome, value, ownership, KPI, investment, horizon, related work, and governing decisions.

Examples include a new product, a new market, a strategic platform capability, or a multi-month initiative.

Business owns a durable **why**.

### Operation

An Operation is a durable operational context around work inside an existing capability.

Typical examples include incident recovery, reliability improvement, maintenance programmes, dependency modernization, or a group of related refactors with an operational reason.

Operation owns a durable **operational reason**.

### none

`none` is a normal and desirable classification.

Examples include a focused feature, localized bug, documentation change, small refactor, or technical change that does not need durable Business or Operation memory.

ContextDevKit does not create an Operation merely to give ordinary work somewhere to live.

Without `none`, governance becomes storage inflation.

## Business and Operation remain separate

An Operation may protect or contribute to a Business outcome, but the concepts do not collapse into a single mandatory hierarchy.

When an Operation appears related to an existing Business, ContextDevKit may calculate a deterministic Business match from evidence such as:

- explicit Business id;
- Business status;
- work kind;
- value intent;
- capability affinity;
- textual overlap.

A weak match remains unlinked.

A strong match may be **suggested**.

The matcher never marks that relationship as **confirmed**. Confirmation belongs to the human/project governance boundary.

This preserves useful inference without allowing a classifier to invent strategic ownership.

## Execution shape is a different axis

Work nature answers:

> Why does this work need durable context, if any?

Execution shape answers:

> How much coordination does delivery actually require?

The two are independent.

```text
Business ────────┐
Operation ───────┼──→ direct
none ────────────┤   batch
                 └── workflow
```

### direct

For a small set of cohesive work, usually one to three tasks.

### batch

For several related tasks, usually four to twelve, that do not require strong ordering.

### workflow

For real execution topology:

- multiple waves;
- dependent task groups;
- required ordering;
- multi-session work;
- coordinated integration;
- cutover/rollback;
- explicitly requested workflow execution.

Words such as `architecture`, `Business`, `ADR`, `LGPD`, or `migration` are not sufficient on their own to force a Workflow.

Topology, not vocabulary, determines execution shape.

## The Intake Envelope

The transient **Intake Envelope** combines the evidence the active agent needs before choosing how to execute confirmed mutation work.

Conceptually:

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

The Intake Envelope is not another persisted artifact or receipt. It is a normalized view over runtime signals that already exist.

Its value is that different hosts and different models can start from the same factual interpretation of project work instead of independently guessing the work shape.

## Why this improves AI-assisted development

Without this separation, an AI agent tends toward one of two mistakes.

### Too little structure

```text
request
  ↓
edit files
  ↓
declare done
```

Long-lived reasoning disappears after the session.

### Too much structure

```text
request
  ↓
create Operation
  ↓
create Workflow
  ↓
create several documents
  ↓
classify specialists
  ↓
perform ceremony
  ↓
eventually edit files
```

The methodology becomes the work.

Business-Driven Development instead aims for:

```text
request
  ↓
is this mutation?
  ↓
does durable ownership matter?
  ↓
what is the smallest useful execution shape?
  ↓
load relevant project intelligence
  ↓
execute
  ↓
preserve only the memory worth preserving
```

## Relationship with Domain-Driven Design

Business-Driven Development and Domain-Driven Design solve different problems.

Business-Driven Development asks:

> What durable outcome or operating context owns this work?

Domain-Driven Design asks:

> What model, language, boundaries, and invariants correctly represent the domain?

A project can need one without needing the other.

A Business classification does not automatically imply full DDD. DDD depth should be proportional to actual domain complexity.

When a declared Class A invariant is applicable, its deterministic protection may participate in the guarded quality floor. The `domain-modeler` itself remains a specialist recommendation, not a write prerequisite.

## Core rule

> **Durable context should exist when forgetting it would harm the project.**

Everything else should stay as small as the work permits.
