# Memory model

<!-- GENRE: Reference (information-oriented) -->

`contextkit/memory/` stores authored project memory and rebuildable projections.
Git visibility does not decide authority; the schema and writer contract do.

## Authored authorities

```text
memory/
  business/BIZ-####-<slug>/business.json
  operations/OP-####-<slug>/operation.json
  workflows/WF-####-<slug>/
  decisions/{business,operations,legacy}/ADR-####-<slug>.md
  sessions/<date>-<sequence>-<slug>.md
  deliberations/
  preferences/owner-preferences.json
```

An owned workflow lives below its Business or Operation. An unowned workflow may
live under `memory/workflows/`. Its path is stable for its whole lifetime.

Each v4 workflow package contains:

| Path | Authority |
| --- | --- |
| `workflow.json` | Identity, ownership, shape, and definition |
| `workflow-state.json` | Workflow lifecycle status and revision |
| `pipeline/tasks.json` | Task status, dependencies, events, revision, and evidence refs |
| `context-manifest.json` | Declared context bundle |
| `prd.md`, `spec.md`, `decisions.md`, `continuation.md` | Authored planning context |
| `reports/` | Factual evidence and closeout reports |
| `tasks.md` | Derived task projection; never an inbound authority |

The explicit 3.x-to-4.0 migrator is the only reader of retired layouts. Normal
runtime code does not fall back to physical lanes or path-based status.

## Generated projections

`SESSIONS.md`, `WORKSPACE.md`, project-map outputs, registries, host projections,
and Markdown task views are rebuildable. Their generators must be read-only over
authored state except for the projection they own. Editing a projection by hand
does not change the underlying authority.

## Sessions and workspace

Session notes are authored under `memory/sessions/`. Transient governance cache
uses the bounded v4 run-state store and is not project memory. Workspace claims
may be projected for visibility, but they cannot transition tasks or create a
second task store.

## Reading and writing

- Read a workflow with `workflow.mjs status|load <ref>`.
- Read tasks with `pipeline.mjs list|board --tasks <scope>`.
- Mutate tasks only through the canonical task writer with an expected revision.
- Repair projections with `pipeline.mjs sync --tasks <scope>`.
- Rebuild registries with their documented generator; missing projections are
  never interpreted as an empty project.

## Historical memory

Accepted and superseded decisions, factual reports, migration manifests, and
changelog evidence may remain for audit. Mark them inactive or historical and do
not load them into default context unless explicitly requested.

See [Domain model](../explanation/domain-model.md) and
[Data posture](data-posture.md).
