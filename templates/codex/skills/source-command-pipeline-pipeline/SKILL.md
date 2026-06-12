---
name: "source-command-pipeline-pipeline"
description: "The DevPipeline manager - production board for bugs, increments, chores and roadmap tasks (backlog -> testing -> conclusion)."
---

# source-command-pipeline-pipeline

Use this skill when the user asks to run the migrated source command `pipeline`.

## Command Template

# DevPipeline

The execution control panel, distinct from the product roadmap. The roadmap
(`contextkit/memory/roadmap.md`) is the product/business plan. The DevPipeline is
how work actually flows: bugs, increments, chores, and roadmap items broken into
tasks, each with priority + SLA, moving through `backlog -> working -> testing ->
conclusion`. Tasks are files under `contextkit/pipeline/<stage>/`;
`devpipeline.md` is the generated dashboard.

Act as the manager of this board based on **$ARGUMENTS**:

- **show** (default): start token-light:
  `node contextkit/tools/scripts/pipeline.mjs board --digest`. Open the full
  `contextkit/pipeline/devpipeline.md` only when the digest is not enough.
- **add**: create a task:
  ```bash
  node contextkit/tools/scripts/pipeline.mjs add --type <bug|feature|increment|chore> \
       --priority <P0-P3> --title "..." [--sla YYYY-MM-DD] [--roadmap P2.3] \
       [--workflow <slug>] [--spec contextkit/memory/workflows/<slug>/spec.md]
  ```
  First right-size the ceremony with
  `node contextkit/tools/scripts/complexity-rubric.mjs classify "<objective>"`
  and pass `--complexity` only when the automatic classification needs an
  explicit override.
  Then open the new file in `contextkit/pipeline/backlog/` and fill the context
  and acceptance criteria. For non-trivial workflow work (ADR-0057), pass
  `--workflow` and `--spec`; the card will include spec references,
  implementation report, diff summary, and verification sections.
- **move**: `node contextkit/tools/scripts/pipeline.mjs move <id> <backlog|working|testing|conclusion>`.
  Moving a card to `testing` stamps `implemented: YYYY-MM-DD`. Moving to
  `conclusion` stamps `concluded: YYYY-MM-DD`; QA closure should still prefer
  `qa-approve` through `/pipetest`.
- **from-roadmap**: read `contextkit/memory/roadmap.md`, pick the next milestone,
  and break it into concrete backlog tasks with `--roadmap <P-ID>`.

Always run `sync` after changes so `devpipeline.md` reflects reality. Treat
P0/SLA items as the priority. The workflow spec pack references this board; it
does not replace it.
