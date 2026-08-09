# Skill: pipeline

> Manage tasks in one canonical ContextDevKit 4 JSON scope.
> Argument: <list|board|add|move|start|stop|validate|sync|qa-reject|qa-approve|auto-transition> --tasks <scope>
# DevPipeline

Manage the task scope named in **<user-specified argument>**. The scope must resolve to a
workflow or batch directory, or directly to its `pipeline/tasks.json`.

`pipeline/tasks.json` is the only task and status authority. `tasks.md` is a
generated projection; never edit or parse it to decide state. There is no
global lane directory and no filesystem move on a status transition.

Use the smallest command that satisfies the request:

```bash
node contextkit/tools/scripts/pipeline.mjs list --tasks <scope> [--json]
node contextkit/tools/scripts/pipeline.mjs board --tasks <scope> [--digest]
node contextkit/tools/scripts/pipeline.mjs add --tasks <scope> --title "..." \
  [--id T-001] [--priority P0-P4] [--depends-on T-000] \
  [--acceptance "criterion one,criterion two"] [--touch-hints "src/a.mjs"] \
  [--evidence-refs "gh#42"] [--report-refs "reports/triage.md"]
node contextkit/tools/scripts/pipeline.mjs move <id> <status> --tasks <scope>
node contextkit/tools/scripts/pipeline.mjs start <id> --tasks <scope>
node contextkit/tools/scripts/pipeline.mjs stop <id> --tasks <scope>
node contextkit/tools/scripts/pipeline.mjs qa-reject <id> "feedback" --tasks <scope>
node contextkit/tools/scripts/pipeline.mjs qa-approve <id> --evidence <ref> --tasks <scope>
node contextkit/tools/scripts/pipeline.mjs auto-transition <id> done --evidence <automated-test-ref> --tasks <scope>
node contextkit/tools/scripts/pipeline.mjs validate --tasks <scope>
node contextkit/tools/scripts/pipeline.mjs sync --tasks <scope>
```

Canonical statuses are `backlog`, `working`, `blocked`, `testing`, `done`, and
`cancelled`. The CLI validates legal edges and uses the document revision for
compare-and-swap. `qa-approve` is the normal `testing -> done` path and requires
real evidence. A successful automated suite uses the evidence-bound
`auto-transition testing -> done` edge immediately; it does not wait for a
second human test. `qa-reject` accepts `testing` or `done`, requires feedback,
clears stale current-cycle evidence, and returns the task to `backlog`. If its
Workflow was complete, that aggregate/package reopens first. A simple scoped
owner override may resolve a guarded QA verdict; it needs no autonomy grade,
council, agent receipt, or quorum.

`sync` repairs only the Markdown projection from JSON. A projection failure is
reported honestly after the canonical JSON commit and never rolls task state
back to a lane.

For conversation or read-only exploration, do not call this command and do not
create a task. If the user's intent is unclear, ask one short question first.
