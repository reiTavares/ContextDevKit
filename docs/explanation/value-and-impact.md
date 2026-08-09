# Value and impact

<!-- GENRE: Explanation (understanding-oriented) -->

ContextDevKit turns project context into durable, inspectable engineering state without making ceremony the permission system.

Its value is not only that it remembers files or runs checks. It gives AI-assisted development a project-level engineering substrate that can survive sessions, models, and execution hosts.

## From vibe coding to senior engineering

ContextDevKit is designed to add value at different levels of engineering maturity.

| User | Primary value |
| --- | --- |
| **Vibe coder** | Receives engineering guardrails, tests, review, evidence, and persistent memory that may not have been requested explicitly |
| **Developer** | Gains structured context, task state, reports, reusable execution shapes, and continuity |
| **Senior engineer** | Gains leverage from project intelligence, specialist delegation, quality analysis, and durable decisions without losing authority |
| **Tech Lead** | Gains shared memory, ADRs, ownership, quality policy, and cross-session consistency |
| **AI-native team** | Can change models or coding hosts without losing the project's engineering intelligence |

The principle is proportionality:

> **Use enough engineering for the risk and complexity of the change — no more, no less.**

## What it protects

- Decisions and their rationale survive across sessions.
- Business and Operation context preserve durable strategic or operational ownership only when it is actually useful.
- Workflows and tasks have one JSON authority, stable paths, revisions, dependencies, and evidence references.
- Reports preserve factual execution evidence and unresolved findings.
- Host hooks share one small governance registry and one bounded dispatcher per event.
- Generated documentation and host projections can be rebuilt and checked for drift.
- Explicit migration preserves user data while removing executable compatibility from normal runtime paths.

## Quiet until mutation

Conversation and exploration perform no project writes.

A real mutation attempt activates work intake, existing-work resolution, and the applicable governance. If the request is ambiguous, ContextDevKit asks one short clarification instead of creating a guessed task, Business, Operation, or Workflow.

This matters because the cost of governance is not only CPU time. It is cognitive friction for the user and agent.

## Business-Driven Development without workflow inflation

ContextDevKit separates durable ownership from execution topology.

`Business`, `Operation`, and `none` answer whether the work needs a durable strategic or operational context.

`direct`, `batch`, and `workflow` answer how much coordination the work actually requires.

A Business does not force a Workflow. An Operation does not force a Workflow. `none` is the normal answer for ordinary engineering work.

This lets long-lived outcomes retain memory without turning every bug or feature into a programme.

## Evidence-driven engineering loops

ContextDevKit supports the project-level cycle:

```text
implement
  ↓
evaluate
  ↓
findings
  ↓
correct
  ↓
re-evaluate
  ↓
fresh evidence
  ↓
done
```

QA rejection can reopen a task into a fresh backlog cycle and clear stale current-cycle evidence. A completed Workflow can reopen when later feedback invalidates the prior completion.

This makes completion more durable than a model saying "done" in one conversation.

## Proportional governance

Most engineering signals are canary or shadow observations.

Only QA sign-off, applicable deterministic DDD Class A invariants, and new high/critical technical debt introduced by the current diff are guarded by default.

Architecture Debt remains canary: it improves reasoning and can produce evidence without becoming a hidden fourth quality gate.

Resolver errors and missing optional evidence continue with explicit diagnostics rather than deadlocking the user's work.

## Owner sovereignty

Guardrails should protect users who do not know which engineering checks to request while remaining configurable for engineers who do.

The governance runtime therefore uses `humanAuthority: owner-wins` within the project policy boundary.

A senior engineer can change configured modes or apply a scoped override while preserving a truthful record that evidence was accepted rather than passed.

ContextDevKit does not replace platform permission boundaries or human accountability.

## Project intelligence as durable leverage

Project Map, graph data, ADRs, specs, reports, preferences, and workflow context reduce the need for each new agent/session to rediscover the project from scratch.

Graph-first is an optimization rather than a restriction: stale or incomplete graph data falls back immediately to ordinary search.

The result is a project that becomes easier for AI agents to work on over time instead of losing context every time the conversation changes.

## Agent and model economics

Specialists, swarms, compact context packs, `run-compact`, task compilation, and model recommendations are tools for improving quality, elapsed time, or token cost.

They do not authorize, deny, or reorder work merely by existing.

A material diff can justify a `code-reviewer` pass. A domain-heavy change can justify domain modeling. A critical path can justify deeper QA. The active agent should select depth from evidence and owner intent.

## Trade-offs

The kit adds schemas, explicit revisions, migration work, and release evidence.

Those costs are justified when a project spans consequential decisions, multiple sessions, parallel contributors, or long-lived AI-assisted development.

Small direct changes remain direct and do not need durable Workflow ceremony by default.

## Core value proposition

> **ContextDevKit gives beginners engineering guardrails and gives experts leverage without making either group subordinate to the methodology.**

See [Business-Driven Development](business-driven-development.md), [Evidence-Driven Loop Engineering](loop-engineering.md), [Governance and enforcement](governance-and-enforcement.md), and [Domain model](domain-model.md).
