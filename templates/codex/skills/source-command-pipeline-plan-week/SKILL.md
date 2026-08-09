---
name: "source-command-pipeline-plan-week"
description: "Rank canonical backlog tasks by explicit priority and dependency readiness."
---

# source-command-pipeline-plan-week

Use this skill when the user asks to run the migrated source command `plan-week`.

## Command Template

# Plan the week

Read the v4 JSON task authority and produce an explained, read-only top-N list.
The owner-defined `priority` is the ordering band; tasks with unfinished
`dependsOn` references are shown separately as blocked.

```text
node contextkit/tools/scripts/plan-next.mjs [--top N] [--all] [--json]
```

For a compact scope view, use
`node contextkit/tools/scripts/pipeline.mjs board --digest --tasks <scope>`.

Use the result as a planning aid:

1. Lead with the highest-priority actionable task.
2. Name unfinished dependency ids for blocked work.
3. Offer `/dev-start "<task-id>" --tasks <scope>` as the next mutation; do not
   execute it from this read-only command.

The command never reads Markdown lanes, infers a writable global store, or
changes task status.
