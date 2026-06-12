---
name: "source-command-pipeline-workflow-assist"
description: "Workflow Navigator — shows the current phase, deliverables, and next commands for an ADR-0057 workflow. Read-only; never mutates state."
---

# source-command-pipeline-workflow-assist

Use this skill when the user asks to run the migrated source command `workflow-assist`.

## Command Template

`/workflow-assist` is a **read-only** navigator that tells you exactly what the
current workflow phase requires, what deliverables to produce, and which commands
to run next. It never mutates workflow state — mutations stay in `/workflow`.

## When to use

- **Before working on a workflow** — run this to get oriented in ≤1 call.
- **At the start of each session** — to confirm the current phase and avoid
  skipping steps.
- **When handing off** — the `--pack` mode bundles phase guidance + context for
  a fresh agent or subagent.

## Commands

Phase guidance:

```bash
node contextkit/tools/scripts/workflow-assist.mjs <slug>
```

Machine-readable:

```bash
node contextkit/tools/scripts/workflow-assist.mjs <slug> --json
```

Phase guidance + context bundle:

```bash
node contextkit/tools/scripts/workflow-assist.mjs <slug> --pack
```

List all active workflows:

```bash
node contextkit/tools/scripts/workflow-assist.mjs --list
```

## Integration

The navigator reuses `readWorkflow()` / `listWorkflows()` from
`workflow-pack.mjs` — it never reinvents parsing. The `--pack` mode dynamically
imports boot-context-readers for the bounded bundle. If the readers are absent
(e.g. a minimal install), the bundle is skipped gracefully.

## Alias

Available as `node ctx.mjs assist <slug>` or `node cdx.mjs assist <slug>`.
