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
```

Canonical statuses are `backlog`, `working`, `blocked`, `testing`, `done`, and
`cancelled`. The command updates `tasks.json` with CAS and atomic replacement,
then regenerates `tasks.md`. `sync` repairs only that projection:

```text
node contextkit/tools/scripts/pipeline.mjs sync --tasks <scope>
```

Never move Markdown files between folders or edit status checkboxes by hand.
