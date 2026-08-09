---
name: "source-command-pipeline-workflow"
description: "Create, load, validate, render, and advance a canonical Workflow v2 package."
---

# source-command-pipeline-workflow

Use this skill when the user asks to run the migrated source command `workflow`.

## Command Template

`/workflow` manages the ContextDevKit 4 workflow package. It never reads a
legacy plan, Markdown frontmatter, or physical task-status lane. It may locate
a complete package under the bounded `done/` projection, but lifecycle state is
always read from JSON and never inferred from that path.

Canonical authorities:

```text
<workflow-root>/WF-####-<slug>/
  workflow.json            # stable definition, owner, topology, artifact refs
  workflow-state.json      # aggregate lifecycle, phase, revision, QA refs
  context-manifest.json    # required context-loading contract
  prd.md
  spec.md
  decisions.md
  index.md                 # generated projection
  reports/
  pipeline/
    tasks.json             # only task/status/event authority
    tasks.md               # generated projection
```

The active root is `memory/workflows/` for owner `none`, or the `workflows/`
child of the owning Business/Operation. Creation also guarantees the matching
`done/` root. Completion commits JSON first and then moves the complete package
to that human-facing archive; explicit QA rejection reopens JSON first and
returns the package to its active root.
The three JSON authorities are `workflow.json`, `workflow-state.json`, and
`pipeline/tasks.json`; none may duplicate another's state.

Before changing source for a workflow, load `context-manifest.json` and every
required artifact. This must include the PRD, SPEC, decisions/ADR references,
task store, workflow state, and relevant reports. Loading is read-only.

Commands:

```bash
node contextkit/tools/scripts/workflow.mjs new <slug> [--operation OP-####|--business BIZ-####]
node contextkit/tools/scripts/workflow.mjs status [ref] [--json]
node contextkit/tools/scripts/workflow.mjs load <ref>
node contextkit/tools/scripts/workflow.mjs validate <ref>
node contextkit/tools/scripts/workflow.mjs render <ref>
node contextkit/tools/scripts/workflow.mjs advance <ref> [--ref <evidence>]
node contextkit/tools/scripts/workflow.mjs repair-scaffold <ref> [--write]
node contextkit/tools/scripts/workflow.mjs done-move <ref> [--apply]
```

Creation is atomic and emits the complete package. `repair-scaffold` is dry-run
unless `--write` is explicit and accepts only a package already containing a
valid `workflow.json`. Importing 3.x is reserved for the explicit offline
`migrate-v3-to-v4` tool.
