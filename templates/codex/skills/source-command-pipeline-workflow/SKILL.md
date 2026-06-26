---
name: "source-command-pipeline-workflow"
description: "Workflow spec pack - PRD/PDR + SPEC -> ADR -> roadmap -> pipeline -> ship -> testing -> conclusion. (ADR-0057)"
---

# source-command-pipeline-workflow

Use this skill when the user asks to run the migrated source command `workflow`.

## Command Template

`/workflow` is the spec-pack layer over the primitives the kit already ships.
It does not replace `/roadmap`, `/new-adr`, `/pipeline`, `/ship`, `/pipetest`,
or `/log-session`; it keeps the PRD/PDR, SPEC, links, memory, and reports for a
large workflow in one folder.

Canonical folder:

```text
contextkit/memory/workflows/<slug>/
  index.md
  prd.md
  spec.md
  decisions.md
  tasks.md
  memory.md
  reports/YYYY-MM-DD.md
```

## When to use

- Large features and architectural work: PRD/PDR + SPEC are required before ADR
  and pipeline work.
- Simple bugs/chores may stay on the lightweight DevPipeline path.
- The workflow folder references ADRs, roadmap items, and pipeline cards; it
  never duplicates their full contents.

## Lifecycle

`intake -> prd -> spec -> adr -> roadmap -> pipeline -> ship -> testing -> conclusion`

- **intake**: read `context-pack`, relevant ADRs/sessions, project map, roadmap,
  and pipeline digest.
- **prd**: fill product WHAT/WHY, goals, users, non-goals, metrics.
- **spec**: fill technical HOW, impact, interfaces, tests, sequence. **Deliberation
  gate** [ADR-0070]: for a `feature`/`architecture` kind, convene the specialist
  council before locking the SPEC. Resolve `feature-deliberation`
  (`resolveAutonomy('feature-deliberation', config)`) — at **grade ≥ 3** with
  `deliberations.active` this is `debate` mode: run `/debate "<the core feature
  decision>"`, record it under `decisions.md`, and let its synthesis shape the SPEC
  and the ADR. At grade ≤ 2 it is a suggestion. Skip for `bug`/`chore`/`spike`.
- **adr**: create/accept the architecture decision when needed (the deliberation
  above pre-fills it).
- **roadmap**: add or link the P-ID only for new product capability.
- **pipeline**: create DevPipeline cards with `--workflow` and `--spec`.
- **ship**: implement scoped cards.
- **testing**: move implemented cards to testing with evidence.
- **conclusion**: close through `/pipetest` or human sign-off; report the result.

## Commands

Start:

```bash
node contextkit/tools/scripts/workflow.mjs new <slug> --kind feature
```

Advance:

```bash
node contextkit/tools/scripts/workflow.mjs advance <slug> --ref ADR-0057
```

Status:

```bash
node contextkit/tools/scripts/workflow.mjs status [slug] [--json]
```

Daily report:

```bash
node contextkit/tools/scripts/workflow.mjs report <slug> --task 123
```

Reports include branch, commit, `git diff --stat`, `git diff --numstat`, and
touched files. They intentionally do not embed full patches; git is the patch
source of truth.

## Numbering — UNIVERSAL (inviolable law)

> A workflow's number is **unique across the whole hierarchy** as ONE sequence —
> `memory/workflows/`, every `business/<BIZ>/workflows/`, every
> `operations/<OP>/workflows/`, and every `done/` archive. **It is NOT
> per-context.** If a Business already holds workflow `20`, the next workflow —
> even the first in a brand-new Operation — is `21`, never `01`.
> (BIZ-0001 / WF-0036 A4 "global numbering scanning every root"; ADR-0119.)

`workflow.mjs new` allocates the id via the universal allocator
(`registry/ids.mjs` → `nextWorkflowNumber` / `allocateWorkflowId`), which scans
every root plus the worktree fleet. **Never** hand-pick a number or use a
per-directory count — that re-introduces the cross-context collisions ADR-0119
fixed.

## Compatibility

Legacy breadcrumb files at `contextkit/memory/workflows/<slug>.md` remain
readable by `status` and `advance`. New workflows use the folder layout.
