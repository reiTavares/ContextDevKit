# File Catalog Guide

Every workflow artifact, its purpose, who authors it, its single source of
truth, and what it must **not** duplicate. Values are read directly from
[`registry/file-catalog.json`](../../templates/contextkit/tools/scripts/workflow/registry/file-catalog.json).

Query it yourself (both commands are read-only):

```
workflow explain-file <id>            # purpose, author, source of truth, mustNotDuplicate
workflow required-files --profile <p> [--addon <a>]...   # which artifacts a profile requires
```

`explain-file` returns the artifact's `id`, `filename`, `purpose`,
`authorship`, `sourceOfTruth`, `required`, `whenToRead`, and (sorted)
`mustNotDuplicate`. It throws on an unknown id and lists the known ones.

## Core artifacts (profile-scoped)

| id | File | Author | Source of truth | Must NOT duplicate |
| --- | --- | --- | --- | --- |
| `index` | `index.md` | human | governance journey phase (frontmatter) | `workflow-state` |
| `prd` | `prd.md` | human | problem & value | `spec`, `decisions` |
| `spec` | `spec.md` | human | technical design & contracts | `prd`, `decisions` |
| `decisions` | `decisions.md` | human | local implementation decisions | `spec` |
| `tasks` | `tasks.md` | **generated** | projection of plan + state | `workflow-plan`, `workflow-state` |
| `memory` | `memory.md` | human | durable workflow narrative | `workflow-state`, `continuation` |
| `workflow-plan` | `workflow-plan.json` | **generated** | execution topology | `tasks`, `workflow-state` |
| `workflow-state` | `workflow-state.json` | **generated** | actual execution state | `index`, `tasks`, `memory` |
| `acceptance-matrix` | `acceptance-matrix.md` | human | cross-wave acceptance | `spec` |
| `risk-register` | `risk-register.md` | human | risks & mitigations | `decisions` |
| `rollout-plan` | `rollout-plan.md` | human | activation & reversibility | `spec` |
| `continuation` | `CONTINUATION-PROMPT.md` | **generated** | projection of plan + state + repo truth | `memory`, `workflow-state` |
| `reports` | `reports/` | generated | agent/gate/wave results & evidence | `workflow-state` |

Notes:
- `workflow-state.json` is machine-owned and **never hand-edited** — it is
  written only by the wave commands.
- `tasks.md`, the `index.md` status region, and `CONTINUATION-PROMPT.md` are
  **projections** rendered inside managed blocks; hand-written content outside
  those blocks is preserved.
- `reports/` is a directory artifact; result objects live under
  `reports/{agents,gates,waves}/*.json`, human evidence under `reports/**/*.md`.

## Add-on files

Activated only when the matching `--addon` is selected at creation.

| id | File | Add-on | Author | Source of truth | Must NOT duplicate |
| --- | --- | --- | --- | --- | --- |
| `evidence-register` | `evidence-register.md` | `research-evidence` | human | research sources & citations | `decisions` |
| `benchmark-plan` | `benchmark-plan.md` | `benchmark` | human | benchmark methodology | `spec` |
| `release-plan` | `release-plan.md` | `release` | human | release scope & cut steps | `rollout-plan` |
| `threat-model` | `threat-model.md` | `security` | human | security threat model | `risk-register` |
| `parity-matrix` | `parity-matrix.md` | `host-integration` | human | cross-host parity | `acceptance-matrix` |

`risk-register` and `rollout-plan` are also pulled in by add-ons
(`compliance` → `risk-register`; `migration` / `database-migration` /
`async-runtime` → `rollout-plan`).

## How "required" is computed

An artifact is required for a profile when it lists that profile **and** its
`required` flag is not the literal `false`, OR it lists one of the requested
add-ons. The human-readable `required` string in the catalog (e.g.
`"profile in [advanced, program]"`) is documentation; membership is computed
from the declarative `profiles[]` / `addons[]` lists, so `required-files` is
deterministic.

Per-profile required/optional lists: [profile-guide.md](./profile-guide.md).
