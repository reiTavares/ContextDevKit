---
description: Create, load, validate, render, and advance a canonical Workflow v2 package.
argument-hint: "new <slug> [--operation OP-####|--business BIZ-####] | status [ref] | load <ref> | validate <ref> | advance <ref> [--ref evidence]"
allowed-tools: Bash(node:*)
---

`/workflow` manages the ContextDevKit 4 workflow package. It never reads a
legacy plan, Markdown frontmatter, physical status lane, or `done/` directory.

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

The root is `memory/workflows/` for owner `none`, or the `workflows/` child of
the owning Business/Operation. A completed workflow stays at the same path.
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
```

Creation is atomic and emits the complete package. `repair-scaffold` is dry-run
unless `--write` is explicit and accepts only a package already containing a
valid `workflow.json`. Importing 3.x is reserved for the explicit offline
`migrate-v3-to-v4` tool.
