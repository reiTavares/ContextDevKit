# Run a Workflow v2 package

Use a workflow for real dependencies, waves, multi-session execution, cutover,
rollback, or required ordering. Small cohesive mutations can stay direct.

```text
node contextkit/tools/scripts/workflow.mjs new api-cutover \
  --title "API cutover" --objective "replace v1 safely"
node contextkit/tools/scripts/workflow.mjs status api-cutover
node contextkit/tools/scripts/workflow.mjs load api-cutover
```

The package is created atomically with `workflow.json`,
`workflow-state.json`, PRD, SPEC, decisions, context manifest,
`pipeline/tasks.json`, `pipeline/tasks.md`, and `reports/`.

Add tasks through the explicit scope, author the planning documents, and advance
one canonical phase at a time:

```text
node contextkit/tools/scripts/pipeline.mjs add --tasks <workflow-dir> \
  --title "prepare compatibility adapter" --priority P1
node contextkit/tools/scripts/workflow.mjs validate api-cutover
node contextkit/tools/scripts/workflow.mjs advance api-cutover --ref reports/design.md
```

After every task is `done` or `cancelled`, advance to `conclusion` and complete
with an explicit QA receipt and current state revision:

```text
node contextkit/tools/scripts/workflow.mjs complete api-cutover \
  --qa-status passed --qa-evidence runs/last-run.json \
  --ref reports/qa-signoff.md --expected-revision 8
```

The completion command refuses missing QA evidence, an absent report, a stale
revision, blockers, unfinished tasks, or any phase other than `conclusion`.

Workflow status never changes its directory. Use `repair-scaffold --write` only
after inspecting its dry-run. Removed v3 plan/hash/finalization commands are
available only to the explicit migration tool.
