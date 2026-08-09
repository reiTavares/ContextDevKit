# Workflow guide

Use a workflow only when the work has strong dependencies, waves, required
ordering, multiple sessions, cutover, rollback, or an explicit owner request.
One to three cohesive tasks are normally direct; four to twelve related tasks
without strong ordering are normally batch.

## Create

```bash
node contextkit/tools/scripts/workflow.mjs new <slug> \
  --title "..." --objective "..." \
  [--operation OP-#### | --business BIZ-####] \
  [--profile <name>] [--pattern <name>] [--continuation]
```

Owner is optional. Absence means neutral/`none`; the command never invents an
Operation. Profile/pattern may seed wave topology but cannot change storage
authority or create mandatory agent/gate contracts.

The command returns only after the complete package validates. Required files
are never promised for later creation.

## Author intent

Edit the human-authored documents:

- `prd.md` for problem, goals, users, non-goals, and measures;
- `spec.md` for design, interfaces, impact, sequence, and tests;
- `decisions.md` for accepted ADR references.

Edit topology and stable workflow fields in `workflow.json` through a validated
writer. Edit tasks and statuses only through the canonical task store/CLI.
Never hand-edit `index.md` or `pipeline/tasks.md`.

## Load before mutation

```bash
node contextkit/tools/scripts/workflow.mjs load <WF-ref>
```

The loader validates the pack and returns authored documents, state, tasks,
manifest, and reports. Hosts use this same loader at start/resume and before the
first write.

## Validate and render

```bash
node contextkit/tools/scripts/workflow.mjs validate <WF-ref>
node contextkit/tools/scripts/workflow.mjs render <WF-ref>
```

Validation checks required paths, schemas, references, single authority, and
renderability. Rendering is idempotent and changes projections only.

## Advance

```bash
node contextkit/tools/scripts/workflow.mjs advance <WF-ref> --ref <report-ref>
```

The aggregate state revision increments by exactly one. Task status is not
copied into workflow state.

## Repair

```bash
node contextkit/tools/scripts/workflow.mjs repair-scaffold <WF-ref>
node contextkit/tools/scripts/workflow.mjs repair-scaffold <WF-ref> --write
```

Repair is dry-run first, stages a complete v2 pack, validates, swaps, and rolls
back on failure. It refuses a directory without `workflow.json`; use the
offline 3.x migrator for v1 data.
