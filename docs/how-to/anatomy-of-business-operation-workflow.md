# Anatomy of a Business, Operation & Workflow

Goal: understand ContextDevKit's governance memory in one read — what a
**Business**, an **Operation**, and a **Workflow** are, how they relate, where
they live on disk, and which files each one carries. Use this when you open a
project's `contextkit/memory/` and need to orient fast.

> pt-BR: veja [anatomia-de-business-operation-workflow.md](anatomy-of-business-operation-workflow.pt-br.md).

## The three units

| Unit | Id | What it is |
| --- | --- | --- |
| **Business** | `BIZ-####` | A durable strategic capability or value the project protects. Long-lived; owns *why* work happens. **`BIZ-0001` is the Root Business** that governs intake in every project. |
| **Operation** | `OP-####` | A batch of related work under a Business (or unlinked, for pure maintenance). Owns *what* is being done and groups its workflows. |
| **Workflow** | `WF-####` | One spec-pack unit of delivery — a single feature/change driven from intake to conclusion. Owns *how* one increment ships. |

They nest by ownership: a **Business** owns **Operations**, an **Operation** (or
a Business directly) owns **Workflows**. An owned workflow's folder **lives under
its parent** — never in a central pool.

## Where they live on disk

All governance memory is under `contextkit/memory/`:

```text
contextkit/memory/
├── business/
│   └── BIZ-0001-business-driven-development/
│       ├── business.json          # machine record (id, status, links)
│       ├── business-case.md        # the value/why
│       ├── growth.md · investment-decision.md
│       ├── architecture/           # business-level design notes
│       ├── workflows/              # workflows owned directly by the Business
│       └── done/                   # concluded workflows, archived
├── operations/
│   └── OP-0008-.../
│       ├── operation.json          # machine record
│       ├── reason.md               # why this Operation exists + findings + scope
│       ├── tasks.md
│       └── workflows/              # ← owned workflows NEST here
│           └── WF-0070-memory-accessibility-and-governance-digest/
│               ├── index.md
│               ├── prd.md          # product requirements
│               ├── spec.md         # technical spec
│               ├── decisions.md    # design decisions log
│               ├── memory.md       # durable handoffs/learnings
│               ├── tasks.md
│               └── reports/        # per-task evidence
├── decisions/                      # ADRs — the "why" of architectural choices
│   ├── ADR-0000-...md              # ADR-####-<slug>.md (canonical format)
│   ├── business/ · operations/ · legacy/
│   └── _templates/
├── sessions/                       # one file per work session (the "what happened")
├── deliberations/                  # /debate artifacts feeding ADRs
├── GLOSSARY.md                     # UI ↔ code naming
├── SESSIONS.md · WORKSPACE.md · DELIBERATIONS.md   # regenerated indices
```

**Worked example (this repo):** `OP-0008` groups the language-accessibility work;
its workflow `WF-0070` lives at
`operations/OP-0008-language-aware-intent-classification-and-memory-accessibility/workflows/WF-0070-memory-accessibility-and-governance-digest/`,
and is governed by `decisions/operations/ADR-0132-*.md`.

## Files each unit must have

- **Business** — `business.json` (machine record) + `business-case.md` (the value).
  `growth.md` / `investment-decision.md` are the standard supporting documents.
- **Operation** — `operation.json` + `reason.md` (why it exists, findings, scope)
  + `tasks.md`. A `workflows/` dir holds its owned workflows.
- **Workflow (spec-pack)** — `index.md`, `prd.md`, `spec.md`, `decisions.md`,
  `memory.md`, `tasks.md`, and a `reports/` dir for evidence. (Some packs use
  `reason.md` alongside/instead of `decisions.md`.)
- **ADR** — `decisions/ADR-####-<slug>.md`. Business/operation ADRs live in the
  `business/` and `operations/` subfolders; historical ones in `legacy/`.

## Naming conventions

- Businesses: `BIZ-####`; Operations: `OP-####`; Workflows: `WF-####`.
- Owned-workflow directories carry the **`WF-` prefix** (`WF-0070-<slug>`), and
  nest under their parent's `workflows/` dir.
- ADR files: `ADR-####-<slug>.md`.
- Numbers are allocated from **one global sequence** across BIZ/OP/WF/ADR — never
  re-used or per-directory.

## A workflow's phase flow

A workflow advances through phases, each gated by its deliverable:

```text
intake → prd → spec → adr → roadmap → pipeline → ship → testing → conclusion
```

Check status any time with `/workflow status <slug>` (or
`node contextkit/tools/scripts/workflow.mjs status <slug>`), and advance with
`/workflow advance <slug>`.

## Memory is versioned in your clone

A **non-dogfood install versions its governance memory** by default — the durable
record (business/operations/workflows/sessions/decisions) is committed so a
teammate's clone carries the project's memory, while disposable runtime state
(pipeline state, caches, regenerated indices) stays ignored. You can regenerate a
query-first projection of all of the above with:

```bash
node contextkit/tools/scripts/governance-digest.mjs --write
```
