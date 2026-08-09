# Workflow CLI reference

Entrypoint:

```bash
node contextkit/tools/scripts/workflow.mjs <command>
```

| Command | Effect |
| --- | --- |
| `new <slug>` | atomically creates a complete v2 workflow package |
| `status [ref] [--json]` | reads one or all active v2 workflow packages |
| `load <ref>` | validates and returns the full governed context, read-only |
| `render <ref>` | regenerates `index.md` and `pipeline/tasks.md` from JSON |
| `validate <ref>` / `check <ref>` | validates the complete package; nonzero on invalid |
| `advance <ref> [--ref report]` | CAS-advances aggregate workflow phase; refuses completion at `conclusion` |
| `complete <ref> --qa-status passed\|skipped --qa-evidence <ref[,ref]> --ref reports/<file> --expected-revision <n>` | CAS-completes from `conclusion` after every task is terminal and QA evidence is explicit |
| `repair-scaffold <ref> [--write]` | reports or atomically repairs missing v2 artifacts |
| `explain-file <artifact-id>` | describes one artifact and its authority |
| `required-files` | prints the one canonical required artifact set |

`new` options:

- `--operation OP-####` or `--business BIZ-####` (mutually exclusive);
- `--title`, `--objective`, `--kind`;
- `--profile`, `--pattern`, `--shape` for optional topology guidance;
- `--continuation` to generate continuation guidance.

Retired v3 commands are refused and point to the offline migrator. Runtime
commands never import the migrator and never fall back to the previous schema.
`advance` never infers a QA pass: only `complete` can set status `done`, clear
active task ids, and bind the QA receipt and factual report.
