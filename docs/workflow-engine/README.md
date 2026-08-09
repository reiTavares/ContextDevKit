# Workflow engine

ContextDevKit 4 workflows are atomic JSON-backed packages for work whose
topology requires ordering, dependencies, waves, multiple sessions, cutover, or
rollback. Smaller work should remain direct or batch.

## Authorities

- `workflow.json`: identity, owner, objective, scope, acceptance, dependencies,
  wave topology, and artifact references;
- `workflow-state.json`: aggregate status, phase, revision, blockers, QA summary,
  and report reference;
- `pipeline/tasks.json`: the only task and task-status authority;
- `context-manifest.json`: required/optional context-loading contract.

`index.md` and `pipeline/tasks.md` are generated projections. The runtime does
not read `workflow-plan.json`, frontmatter, a physical status lane, or `done/`.

## Package creation

The creator allocates an id, materializes every required artifact in a sibling
staging directory, renders projections, validates the complete pack, and
renames it into place atomically. A failure removes staging and leaves no
partial workflow.

## Runtime flow

Before workflow mutation, the shared loader reads canonical state plus PRD,
SPEC, decisions, tasks, and relevant reports. Task updates use the task-store
CAS; workflow phase updates use the workflow-state CAS. Renderers never become
writers of canonical state.

## Guides

- [Workflow guide](workflow-guide.md)
- [CLI reference](cli-reference.md)
- [File catalog](file-catalog-guide.md)
- [Profile and pattern guidance](profile-guide.md)
- [Migration guide](migration-guide.md)
