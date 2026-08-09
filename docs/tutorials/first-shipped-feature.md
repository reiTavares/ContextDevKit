# Tutorial: your first shipped feature

<!-- GENRE: Tutorial (learning-oriented) -->

This tutorial creates one durable workflow, adds canonical tasks, implements a
small feature, and closes it with test evidence.

## 1. Create the workflow package

```shell
node contextkit/tools/scripts/workflow.mjs new first-feature
```

The command creates one atomic package containing `workflow.json`,
`workflow-state.json`, `pipeline/tasks.json`, `context-manifest.json`, the PRD,
SPEC, decision links, continuation notes, and reports directory.

Complete the PRD and SPEC with the outcome, acceptance criteria, boundaries,
rollback, and test approach. Add an ADR only if the feature contains a material
decision.

## 2. Add tasks to the workflow authority

```shell
node contextkit/tools/scripts/pipeline.mjs add \
  --tasks contextkit/memory/workflows/WF-0001-first-feature \
  --title "Implement the feature" \
  --priority P1 \
  --acceptance "focused regression passes"
```

Add dependencies only when ordering is real. `tasks.json` is authoritative;
`tasks.md` is a repairable projection.

## 3. Implement and transition

Use the task id returned by `add`:

```shell
node contextkit/tools/scripts/pipeline.mjs start T-001 --tasks <workflow-path>
```

Make the smallest production change, write the focused regression with it, and
record evidence on the same task. Every transition is a CAS-protected atomic
status-and-event update.

## 4. Verify and complete

Run the focused suite, the relevant integration suite, and QA sign-off. Then use
the canonical transition command to approve completion. The workflow directory
never moves when status changes.

Inspect the result with:

```shell
node contextkit/tools/scripts/workflow.mjs status WF-0001
node contextkit/tools/scripts/pipeline.mjs board --tasks <workflow-path>
```

You now have one stable workflow path, one task authority, explicit evidence,
and no hidden global queue.
