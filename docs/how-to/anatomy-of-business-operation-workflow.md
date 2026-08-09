# Anatomy of a Business, Operation & Workflow

Goal: understand ContextDevKit's durable governance memory in one read — what a **Business**, an **Operation**, and a **Workflow** are, how they relate, where they live, and which files are authoritative.

> pt-BR: see [anatomy-of-business-operation-workflow.pt-br.md](anatomy-of-business-operation-workflow.pt-br.md).

## The three durable units

| Unit | Id | What it is |
| --- | --- | --- |
| **Business** | `BIZ-####` | A durable strategic capability, product, initiative, or decision. Owns a long-lived **why**. |
| **Operation** | `OP-####` | A durable operational, maintenance, recovery, incident, or improvement context. Owns a long-lived operational **reason**. |
| **Workflow** | `WF-####` | A coordinated delivery aggregate used when work has real dependencies, waves, ordering, multi-session execution, or cutover/rollback. |

Not every change needs any of these.

A normal focused feature, bug fix, docs edit, or technical change can have work nature `none` and remain direct/batch work without creating a Business or Operation.

## Business and Operation are separate contexts

Business and Operation live in separate roots.

An Operation may contribute to or protect a Business, but that relationship is a link, not a requirement that every Operation be physically nested under Business.

A deterministic Business matcher may **suggest** a Business relationship for an Operation. The matcher never confirms strategic ownership by itself.

## Ownership is separate from execution shape

A Business or Operation can own direct/batch work or one or more Workflows.

Workflow is selected from execution topology, not because the owner is Business/Operation.

Use Workflow for real dependencies, waves, mandatory ordering, multi-session execution, coordinated integration, or cutover/rollback.

## Where they live

All durable project memory is under `contextkit/memory/` (or the active generation root selected by the v4 authority marker):

```text
contextkit/memory/
├── business/
│   └── BIZ-####-slug/
│       ├── business.json
│       ├── business-case.md
│       ├── growth.md
│       ├── investment-decision.md
│       ├── workflows/
│       └── done/
├── operations/
│   └── OP-####-slug/
│       ├── operation.json
│       ├── reason.md
│       ├── batch/
│       │   ├── tasks.json
│       │   └── tasks.md
│       ├── workflows/
│       └── done/
├── workflows/
│   ├── WF-####-slug/          # neutral active Workflow
│   └── done/                  # neutral completed Workflow placement
├── decisions/
├── sessions/
├── preferences/
└── runs/
```

The exact active root may be external after a v3→v4 migration; consumers use the canonical path resolver rather than hard-coding an in-place memory path.

## Business files

A Business keeps durable strategic context. Typical files include:

- `business.json` — machine-readable Business record;
- `business-case.md` — value/outcome rationale;
- `growth.md` — growth/value context when applicable;
- `investment-decision.md` — investment/decision context when applicable;
- `workflows/` / `done/` — Workflows owned directly by that Business.

Business is not a mandatory parent for all work.

## Operation files

An Operation keeps durable operational context:

- `operation.json` — machine-readable Operation record;
- `reason.md` — why the Operation exists, scope, findings, and operational context;
- `batch/tasks.json` — canonical direct/batch task authority where that Operation owns non-Workflow tasks;
- `batch/tasks.md` — generated human projection;
- `workflows/` / `done/` — active/completed Workflows owned by the Operation;
- `reports/` where the relevant operation/batch contract provides them.

## Workflow v2 package

A Workflow is a complete governed package:

```text
WF-####-slug/
├── workflow.json
├── workflow-state.json
├── context-manifest.json
├── prd.md
├── spec.md
├── decisions.md
├── index.md                    # generated
├── CONTINUATION-PROMPT.md      # optional generated guidance
├── pipeline/
│   ├── tasks.json
│   └── tasks.md                # generated
└── reports/
```

### Authorities

- `workflow.json` owns Workflow definition/topology.
- `workflow-state.json` owns Workflow lifecycle.
- `pipeline/tasks.json` owns task definition/status/events/evidence.
- `tasks.md` and `index.md` are projections.
- reports are factual evidence/context, not lifecycle authorities.

## Completed placement

After JSON-first completion, a validated Workflow package may be atomically placed under its owner's `done/` root (or neutral `memory/workflows/done/`) for human navigation.

Directory placement is **not** status authority.

A Workflow can be reopened when later QA feedback invalidates a completed task. JSON lifecycle state changes first, then the package returns to the active location.

## Fresh QA cycles

A task can move from `testing` or `done` back to `backlog` through `qa-reject`.

```text
testing / done
      ↓
  qa-reject
      ↓
    backlog
      ↓
    working
      ↓
    testing
      ↓
 fresh evidence
      ↓
     done
```

Current-cycle evidence is cleared when the cycle restarts. Historical events remain for audit.

## ADRs and decisions

ADRs preserve material architectural/project decisions under `memory/decisions/`.

Business/Operation/Workflow context can reference relevant ADRs, but an ADR does not itself force a Workflow or Business/Operation classification.

## Memory is project intelligence

The purpose of these structures is not to maximize the number of artifacts.

They exist so information worth remembering survives a session, model, or host change.

> **Durable context should exist when forgetting it would harm the project.**

See [Business-Driven Development](../explanation/business-driven-development.md), [Evidence-Driven Loop Engineering](../explanation/loop-engineering.md), and [Work and governance domain model](../explanation/domain-model.md).
