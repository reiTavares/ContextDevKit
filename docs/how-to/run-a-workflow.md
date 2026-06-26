# How to run a workflow

<!-- GENRE: How-to guide (task-oriented)
     Goal: reader drives a large feature from intake through conclusion using the
           /workflow spec-pack layer.
     Voice: direct, imperative — assume competence, skip "what is X" explanations. -->

## When to use this guide

You are starting a large feature or architectural change that spans multiple sessions,
multiple pipeline cards, and possibly an architecture decision record. Simple bugs and
chores can stay on the lightweight pipeline path; use `/workflow` when a PRD and SPEC
are warranted.

## Prerequisites

- ContextDevKit installed at level 2 or higher.
- `node` 18+ available on the path.
- The objective is not already covered by an open workflow — run
  `node contextkit/tools/scripts/workflow.mjs status` to check first.

## Steps

### Start the workflow

1. Create the workflow folder.

   ```shell
   node contextkit/tools/scripts/workflow.mjs new <slug> --kind feature
   ```

   Replace `<slug>` with a short, kebab-case identifier (e.g., `rate-limit-gateway`).
   Valid kinds: `feature`, `architecture`, `bug`, `chore`, `spike`.

   This creates `contextkit/memory/workflows/<slug>/` with `index.md`, `prd.md`,
   `spec.md`, `decisions.md`, `tasks.md`, `memory.md`, and a `reports/` folder.

2. Fill `prd.md` — the WHAT and WHY.

   Open `contextkit/memory/workflows/<slug>/prd.md` and complete:
   - Product goal and user problem.
   - Success metrics.
   - Non-goals (explicit).

3. Run the deliberation gate before locking the SPEC (for `feature` and `architecture`
   kinds).

   At autonomy grade 3 with deliberations enabled, convene the specialist council:

   ```shell
   /debate "your core feature decision"
   ```

   Record the synthesis in `decisions.md` and let it shape the SPEC.

4. Fill `spec.md` — the HOW.

   Complete the technical design: interfaces, impact surface, sequence diagram, and
   test approach. For large features, reference relevant ADRs; do not duplicate their
   full content.

### Advance through the lifecycle

The full lifecycle is:
`intake -> prd -> spec -> adr -> roadmap -> pipeline -> ship -> testing -> conclusion`

5. Create or accept an architecture decision record when needed.

   ```shell
   /new-adr "your decision title"
   ```

   See [record-a-decision.md](record-a-decision.md) for the full flow.

6. Add the workflow to the roadmap if it introduces new product capability.

   Link the P-ID in `index.md`. Do not duplicate roadmap content in the workflow
   folder.

7. Create pipeline cards for the work.

   ```shell
   node contextkit/tools/scripts/pipeline.mjs add \
     --type feature \
     --priority P1 \
     --title "implement rate-limiting middleware" \
     --workflow <slug> \
     --spec contextkit/memory/workflows/<slug>/spec.md
   ```

   Repeat for each decomposed task.

8. Implement the scoped cards.

   Start each card with `/dev-start "<task title>"`, implement, and move to `testing`.
   See [start-a-focused-session.md](start-a-focused-session.md) and
   [use-the-pipeline-board.md](use-the-pipeline-board.md).

9. Write a daily progress report.

   ```shell
   node contextkit/tools/scripts/workflow.mjs report <slug> --task <card-id>
   ```

   Reports include branch, commit, `git diff --stat`, and touched files. Full patches
   stay in git.

10. Advance the workflow state when a lifecycle gate is passed.

    ```shell
    node contextkit/tools/scripts/workflow.mjs advance <slug> --ref <ADR-NNNN|card-id>
    ```

11. Check current status at any time.

    ```shell
    node contextkit/tools/scripts/workflow.mjs status <slug>
    # or for machine-readable output:
    node contextkit/tools/scripts/workflow.mjs status <slug> --json
    ```

### Close the workflow

12. Move all implemented cards through QA sign-off.

    ```shell
    /qa-signoff
    ```

    See [audit-and-test.md](audit-and-test.md) for the full QA flow.

13. Close cards to `conclusion` and run `/log-session`.

    ```shell
    /log-session
    ```

## Verify it worked

- `contextkit/memory/workflows/<slug>/index.md` shows the current lifecycle phase.
- Every pipeline card created with `--workflow <slug>` is in `conclusion/` at the end.
- A `reports/YYYY-MM-DD.md` exists for each active day.
- The session log references the workflow slug.

## Troubleshooting

**Symptom:** `workflow.mjs status` shows a phase mismatch — the code is done but the
lifecycle shows `spec`.
Fix: Run `workflow.mjs advance <slug>` for each gate that was passed without being
recorded. The `advance` command is idempotent; it will not create duplicate transitions.

**Symptom:** The PRD and SPEC files are empty stubs and the AI is guessing.
Fix: The files are intentionally left for the developer to complete. Fill `prd.md`
and `spec.md` before asking the AI to implement. An empty SPEC is a governance signal,
not a starting point.

**Symptom:** A legacy breadcrumb file at `contextkit/memory/workflows/<slug>.md` is
found instead of the folder layout.
Fix: `status` and `advance` can read legacy breadcrumbs. New workflows always use the
folder layout. You can keep the legacy file as-is; it does not need migration unless
you want `report` to work.

## Related

- [`/dev-start`](start-a-focused-session.md) — lock scope for each implementation session.
- [`/pipeline`](use-the-pipeline-board.md) — manage the cards created by the workflow.
- [`/new-adr`](record-a-decision.md) — record the architectural decisions the workflow surfaces.
- [`/ship`](../reference/commands.md) — end-to-end autonomous pipeline for a single scoped objective.
