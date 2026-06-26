# How to record a decision

<!-- GENRE: How-to guide (task-oriented)
     Goal: reader writes a well-formed Architecture Decision Record before implementing.
     Voice: direct, imperative — assume competence, skip "what is X" explanations. -->

## When to use this guide

You are about to make — or have just made — a significant architectural, stack, or
cross-cutting design choice that a future reader (or a fresh AI session) could not
reconstruct from the code alone. Write the ADR before you implement, not after.

## Prerequisites

- ContextDevKit installed at level 1 or higher.
- The `contextkit/memory/decisions/` folder exists in the project.
- `node` 18+ available on the path.

## Steps

1. Check whether a decision record already exists for this topic.

   ```shell
   node contextkit/tools/scripts/adr-digest.mjs --search "your key terms"
   ```

   If an existing record covers this decision, extend or supersede it rather than
   creating a duplicate.

2. For a feature or architecture kind, run the deliberation gate first.

   At autonomy grade 3 with deliberations enabled, a debate must precede the write:

   ```shell
   /debate "your core decision question"
   ```

   Use the debate synthesis as the Context section of the new record. Skip this step
   only for mechanical or trivially obvious decisions (no real tension).

3. Run `/new-adr` with the decision title.

   ```shell
   /new-adr "adopt zod for runtime validation at service boundaries"
   ```

   The skill finds the next available number, copies `contextkit/memory/decisions/_TEMPLATE.md`,
   and creates `contextkit/memory/decisions/<NNNN>-<kebab-slug>.md`.

4. Fill in the four required sections.

   Open the new file and complete:

   - **Status** — set to `Proposed`.
   - **Context** — the forces at play; why a decision is needed now.
   - **Decision** — what you will do, stated plainly.
   - **Consequences** — trade-offs; what becomes easier and what becomes harder.

   If this supersedes an earlier record, add `Supersedes <older-record>` and update
   the older file's status line to `Superseded by <new-record>`.

5. Show the draft to the user and wait for confirmation before marking it `Accepted`.

   Do not mark it `Accepted` unilaterally. The human sign-off is the gate.

6. After acceptance, generate backlog tasks from the decision.

   ```shell
   node contextkit/tools/scripts/adr-tasks.mjs <NNNN>            # preview (dry-run)
   node contextkit/tools/scripts/adr-tasks.mjs <NNNN> --write    # create tasks
   ```

   Review the preview, prune or merge as needed, then write. The tasks are tagged
   with the record number and flow into the pipeline backlog automatically.

## Verify it worked

- `contextkit/memory/decisions/<NNNN>-<slug>.md` exists with status `Accepted`.
- If it supersedes an older record, the older file now shows the updated status.
- Backlog tasks tagged `source: adr:<NNNN>` appear in `contextkit/pipeline/backlog/`.

## Troubleshooting

**Symptom:** The next number conflicts with an existing file (two sessions writing
simultaneously).
Fix: Refresh the file list, take the true highest number + 1, and rename your draft
before marking it Accepted.

**Symptom:** The deliberation gate blocks writing even for a trivial mechanical
decision.
Fix: The gate checks the autonomy grade and the `deliberations.active` config flag.
A trivial or purely mechanical decision (no real tension) may skip the debate — state
the reason explicitly in the Context section.

**Symptom:** `adr-tasks.mjs` produces tasks that do not match the actual implementation
needed.
Fix: Run the preview first (`--dry-run` is the default without `--write`). Edit or
delete individual tasks in the backlog before starting them.

## Related

- [`/debate`](../reference/commands.md) — convene the deliberation council.
- [`/pipeline`](use-the-pipeline-board.md) — move ADR-generated tasks through backlog to working.
- [`/workflow`](run-a-workflow.md) — for ADRs that are part of a larger feature workflow.
- `contextkit/memory/decisions/_TEMPLATE.md` — the canonical record template.
