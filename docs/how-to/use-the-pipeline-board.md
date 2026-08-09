# Use the canonical task board

Choose one workflow or batch scope. All commands require it explicitly:

```text
node contextkit/tools/scripts/pipeline.mjs list --tasks <scope>
node contextkit/tools/scripts/pipeline.mjs board --tasks <scope> --digest
node contextkit/tools/scripts/pipeline.mjs add --tasks <scope> \
  --title "implement retry policy" --priority P1 \
  --depends-on T-001 --acceptance "timeout test passes"
node contextkit/tools/scripts/pipeline.mjs start T-002 --tasks <scope>
node contextkit/tools/scripts/pipeline.mjs move T-002 testing --tasks <scope>
node contextkit/tools/scripts/pipeline.mjs qa-approve T-002 --tasks <scope> \
  --evidence "npm test exit 0"
node contextkit/tools/scripts/pipeline.mjs auto-transition T-002 done --tasks <scope> \
  --evidence "npm test exit 0"
node contextkit/tools/scripts/pipeline.mjs qa-reject T-002 "human adjustment" --tasks <scope>
```

Canonical statuses are `backlog`, `working`, `blocked`, `testing`, `done`, and
`cancelled`. The command updates `tasks.json` with CAS and atomic replacement,
then regenerates `tasks.md`. `sync` repairs only that projection:

```text
node contextkit/tools/scripts/pipeline.mjs sync --tasks <scope>
```

Never move Markdown files between folders or edit status checkboxes by hand.
An exit-0 automated suite bound to a testing task moves it directly to `done`;
it does not wait indefinitely for a separate human test. Human feedback on a
`testing` or `done` task returns it to `backlog`, clears stale current evidence,
and starts a new implementation/test cycle. If the Workflow was already
complete, its JSON aggregate and full package reopen before the task changes.
