# Workflow file catalog

Every ContextDevKit 4 workflow has the same authority contract. Profiles and
shapes do not redefine required storage.

| Artifact id | Path | Authorship | Authority |
| --- | --- | --- | --- |
| `workflow` | `workflow.json` | canonical | workflow definition and topology |
| `workflow-state` | `workflow-state.json` | canonical | aggregate workflow lifecycle |
| `tasks-json` | `pipeline/tasks.json` | canonical | tasks and task status |
| `context-manifest` | `context-manifest.json` | canonical | context-loading contract |
| `prd` | `prd.md` | human | product intent |
| `spec` | `spec.md` | human | implementation contract |
| `decisions` | `decisions.md` | human | decision references |
| `reports` | `reports/` | mixed factual | evidence referenced by state/tasks |
| `index` | `index.md` | generated | projection only |
| `tasks` | `pipeline/tasks.md` | generated | projection only |
| `continuation` | `CONTINUATION-PROMPT.md` | generated optional | host-neutral guidance |

Required context loading excludes generated Markdown because it loads the
canonical JSON inputs instead. `reports/` and continuation guidance are
optional context references but `reports/` is a required package directory.

Use:

```bash
node contextkit/tools/scripts/workflow.mjs required-files
node contextkit/tools/scripts/workflow.mjs explain-file <artifact-id>
```

The catalog is code-owned and host-neutral. It does not consult Git or infer
files from directory contents.
