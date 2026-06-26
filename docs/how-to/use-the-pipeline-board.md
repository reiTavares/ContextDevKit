# How to use the pipeline board

<!-- GENRE: How-to guide (task-oriented)
     Goal: reader creates, moves, and closes pipeline cards.
     Voice: direct, imperative — assume competence, skip "what is X" explanations. -->

## When to use this guide

You want to add work to the board, move a card between stages, or check what is
currently in progress. The pipeline board is the execution tracker — distinct from
the product roadmap, which is the business plan.

## Prerequisites

- ContextDevKit installed at level 1 or higher.
- `node` 18+ available on the path.
- `contextkit/pipeline/` exists with `backlog/`, `working/`, `testing/`, `conclusion/`
  sub-folders.

## Steps

### See the board

1. Run `/pipeline` (or `/pipeline show`) to read a token-light digest first.

   ```shell
   /pipeline show
   ```

   Internally this runs:

   ```shell
   node contextkit/tools/scripts/pipeline.mjs board --digest
   ```

   Open `contextkit/pipeline/devpipeline.md` only when the digest is not enough.

### Add a task

2. Classify the work before creating the card.

   ```shell
   node contextkit/tools/scripts/complexity-rubric.mjs classify "your task description"
   ```

3. Create the card.

   ```shell
   node contextkit/tools/scripts/pipeline.mjs add \
     --type <bug|feature|increment|chore> \
     --priority <P0|P1|P2|P3> \
     --title "your task title" \
     [--sla YYYY-MM-DD] \
     [--roadmap P2.3] \
     [--workflow <slug>] \
     [--spec contextkit/memory/workflows/<slug>/spec.md]
   ```

   Pass `--workflow` and `--spec` for non-trivial workflow work so the card includes
   spec references, an implementation report section, a diff summary, and a
   verification section.

4. Open the newly created file in `contextkit/pipeline/backlog/` and fill in the
   context and acceptance criteria sections.

### Move a card

5. Move a card to `working` when you begin implementation.

   ```shell
   node contextkit/tools/scripts/pipeline.mjs move <id> working
   ```

6. Move a card to `testing` when implementation is done.

   ```shell
   node contextkit/tools/scripts/pipeline.mjs move <id> testing
   ```

   Moving to `testing` stamps the `implemented: YYYY-MM-DD` field automatically.

7. Close a card through QA sign-off or human approval.

   ```shell
   /pipetest        # structured QA gate — preferred
   # or
   node contextkit/tools/scripts/pipeline.mjs move <id> conclusion
   ```

   Moving to `conclusion` stamps `concluded: YYYY-MM-DD`. Use `/pipetest` when
   formal QA sign-off is required.

### Keep the board current

8. After any change, sync the generated dashboard.

   ```shell
   node contextkit/tools/scripts/pipeline.mjs sync
   ```

   This regenerates `contextkit/pipeline/devpipeline.md` from the card files.

### Pull work from the roadmap

9. To break a roadmap milestone into backlog cards, use:

   ```shell
   /pipeline from-roadmap
   ```

   The skill reads `contextkit/memory/roadmap.md`, picks the next milestone, and
   creates concrete backlog tasks tagged with the roadmap P-ID.

## Verify it worked

- `contextkit/pipeline/backlog/<NNN>-<slug>.md` exists after `add`.
- `contextkit/pipeline/working/<id>` is present when you run `move <id> working`.
- `devpipeline.md` reflects the new state after `sync`.
- P0/SLA items are at the top of the board.

## Troubleshooting

**Symptom:** `pipeline.mjs board --digest` shows stale data.
Fix: Run `pipeline.mjs sync` to regenerate the dashboard from the card files.

**Symptom:** Moving a card fails with a gate error.
Fix: The pipeline checks the autonomy grade for some transitions. If `resolveAutonomy`
returns `manual` for your grade, present the move as a command for the user to run
rather than running it autonomously.

**Symptom:** A card appears in the wrong stage after a move.
Fix: Verify the card file is physically located in `contextkit/pipeline/<stage>/`.
The `move` command renames the directory; if the file was edited manually, move it
manually and then run `sync`.

## Related

- [`/dev-start`](start-a-focused-session.md) — auto-moves the referenced card to `working`.
- [`/workflow`](run-a-workflow.md) — for multi-card workflows with spec references.
- [`/pipetest`](../reference/commands.md) — QA-gated close for cards in `testing`.
- [`/new-adr`](record-a-decision.md) — generates cards automatically after acceptance.
