# Profile Guide

A profile is the complexity dial. Values below are read directly from
[`registry/profile-registry.json`](../../templates/contextkit/tools/scripts/workflow/registry/profile-registry.json).
Defaults are defaults, not hard limits.

Query the real values yourself:

```
workflow required-files --profile <profile> [--addon <a>]...   # required artifact ids
workflow required-files                                        # lists the 5 profiles
```

## The five profiles

| Profile | Default pattern | Min gates | Continuation | Risk reg. recommended | ADR recommended |
| --- | --- | --- | --- | --- | --- |
| `pipeline-only` | _(none)_ | 0 | no | no | no |
| `basic` | `single-delivery` | 1 | no | no | no |
| `standard` | `discovery-build-validate` | 2 | yes | no | yes |
| `advanced` | `architecture-foundation-integration` | 3 | yes | yes | yes |
| `program` | `large-program` | 4 | yes | yes | yes |

## Required vs. optional files

Artifact ids; see [file-catalog-guide.md](./file-catalog-guide.md) for what each
one is.

| Profile | Required files | Optional files |
| --- | --- | --- |
| `pipeline-only` | _(none — DevPipeline card only)_ | _(none)_ |
| `basic` | `index`, `spec`, `tasks`, `decisions`, `reports`, `workflow-plan`, `workflow-state` | `prd`, `memory`, `continuation` |
| `standard` | `index`, `prd`, `spec`, `tasks`, `decisions`, `reports`, `workflow-plan`, `workflow-state` | `memory`, `continuation`, `acceptance-matrix`, `risk-register` |
| `advanced` | `index`, `prd`, `spec`, `decisions`, `tasks`, `reports`, `acceptance-matrix`, `risk-register`, `workflow-plan`, `workflow-state` | `memory`, `continuation`, `rollout-plan` |
| `program` | `index`, `prd`, `spec`, `decisions`, `tasks`, `memory`, `reports`, `acceptance-matrix`, `risk-register`, `rollout-plan`, `continuation`, `workflow-plan`, `workflow-state` | _(none)_ |

Add-ons widen the required set (e.g. `--addon security` adds `threat-model`).
See [file-catalog-guide.md](./file-catalog-guide.md#add-on-files).

## Task count & parallelism guidance

Verbatim from the registry — guidance, not enforcement.

| Profile | Task count guidance | Parallelism guidance |
| --- | --- | --- |
| `pipeline-only` | No pack — a single DevPipeline card covers the whole change. | None — trivial chores run inline, no waves, no agents. |
| `basic` | 1 wave, 1-3 tasks — keep a relevant bug or small feature small. | Sequential by default; parallel only if tasks own disjoint paths. |
| `standard` | 3-4 waves (W0-W3), a handful of tasks per wave. | Parallelize build-wave tasks across disjoint ownership; one gate per wave. |
| `advanced` | 5-7 waves; cross-cutting architecture with several integrations. | Disjoint-ownership swarms per wave; orchestrator owns shared files and integration. |
| `program` | Arbitrary DAG of waves/tasks/gates; multi-week, multi-session. | Multiple concurrent waves and runs bounded by capacity; orchestrator integrates. |

## Capacity is a ceiling, not a quota

A plan's `capacity` block (`maxConcurrentWaves`, `maxConcurrentRuns`,
`maxAgentsPerRun`, `maxTotalAgents`) caps parallelism. 6 ready agent-tasks with
5 agent slots ⇒ 5 dispatched now + 1 deferred. Only `agent`-mode tasks consume a
slot; `deterministic | orchestrator | human` tasks never do. Shared
orchestration files (the `workflow.mjs` CLI, `tools/test-suites.mjs`, package
scripts, shared doc indexes) are owned by the orchestrator alone and are never
edited by parallel agents (ADR-0100 §8).
