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
- **spec**: fill technical HOW, impact, interfaces, tests, sequence.
- **adr**: create/accept the architecture decision when needed.
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

## Compatibility

Legacy breadcrumb files at `contextkit/memory/workflows/<slug>.md` remain
readable by `status` and `advance`. New workflows use the folder layout.
