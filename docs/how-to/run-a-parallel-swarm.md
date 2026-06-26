# How to run a parallel swarm

<!-- GENRE: How-to guide (task-oriented)
     Goal: reader plans and runs a swarm of parallel workstreams, then reviews the results.
     Voice: direct, imperative — assume competence, skip "what is X" explanations. -->

## When to use this guide

You have several disjoint backlog tasks that can be implemented in parallel in isolated
worktrees. A swarm pulls these tasks, fans them out to parallel sub-agents, parks them
in `testing`, and hands the merge decision back to you.

## Prerequisites

- ContextDevKit installed at level 4 or higher (squads active).
- `node` 18+ available on the path.
- At least 2 backlog tasks with non-overlapping file touch-sets.
- Autonomy grade 3 for a single-OK consent gate; grade 1 or 2 requires a pause
  before every wave.
- The project's test suite passes on `main` before starting.

## Steps

### Plan the run

1. Run the planner to rank and partition disjoint tasks.

   ```shell
   /swarm plan
   # or, to limit to the top N tasks:
   /swarm plan --top 3
   ```

   Internally this calls:

   ```shell
   node contextkit/tools/scripts/swarm-plan.mjs --run-id swarm-<YYYYMMDD>-<NN> [--top N]
   ```

   The planner ranks the backlog by WSJF priority, derives touch-sets for each card,
   and partitions tasks so no two workstreams touch the same files.

2. Review the proposed plan carefully.

   The output shows: workstreams, their touch-sets, tier hints, refused tasks, and
   deferred tasks. Honor the refusals verbatim — if a task was refused because the
   touch-set could not be derived or it touches a secret floor, surface the fix to the
   user before adding it manually.

   At grade 3 (the default), this is the consent gate. Give an explicit OK to proceed.

### Run the workstreams

3. Launch the run.

   ```shell
   /swarm run <runId>
   ```

   The runId was shown in the plan output (format: `swarm-<YYYYMMDD>-<NN>`).

   For each workstream, the coordinator:
   - Creates an isolated git worktree.
   - Starts the pipeline card.
   - Builds a bounded context charter for the sub-agent.
   - Resolves the model tier via `model-policy.mjs` — the model is never eyeballed.
   - Dispatches the sub-agent.

4. Monitor progress.

   As each sub-agent returns, the coordinator runs its QA gate (test suite output +
   self-review). Passing workstreams are parked in `testing`. A failing workstream
   gets one re-dispatch one tier up; a second failure parks it as `failed` with the
   QA report attached.

5. Watch for conflict detection.

   Before parking, the coordinator intersects `git diff --name-only` across all
   workstream branches. Any file overlap parks the younger workstream as `failed`
   with a `conflict-with <workstream>` note. This is not an error you need to fix
   during the run; it surfaces in the review.

   Hard limits that cannot be overridden:
   - Maximum 5 concurrent workstreams (`swarm.maxWorkstreams`).
   - Maximum waves per run: `swarm.maxWavesPerRun` from config.
   - The run stops starting new waves if the token budget is exhausted;
     in-flight workstreams finish their current step.

### Review results

6. Review the run report.

   ```shell
   /swarm review <runId>
   ```

   The report shows: per-branch diff stats, QA verdicts, commit summaries, the
   per-model cost mix, and any conflicts or failures.

7. Merge accepted branches.

   Merging to the default branch is always a manual human action at every autonomy
   grade. The coordinator prepares the commands but never runs the merge itself.

   After merging each branch, move the card from `testing` to `conclusion` via
   `/pipeline`.

### Clean up

8. Remove worktrees after review is complete.

   ```shell
   /swarm clean <runId>
   ```

   This removes worktrees and deletes merged branches. The command refuses to clean
   a run that still has dispatched or working workstreams.

## Verify it worked

- `contextkit/.swarm/<runId>/` contains the run manifest with every workstream's
  final status.
- Every accepted workstream branch is merged and the pipeline card is in `conclusion/`.
- `swarm-state.mjs report <runId>` shows `models:` line with the actual per-model mix
  used — confirming the cost is auditable.

## Troubleshooting

**Symptom:** The planner refuses all tasks with "no derivable touch-set."
Fix: Add a `paths:` field to each card file listing the files the task is expected to
touch. The planner uses these to build the touch-set; without them it cannot partition.

**Symptom:** A workstream is parked as `failed` due to a conflict.
Fix: The conflict note names the other workstream (`conflict-with <ws>`). In the review
phase, decide which branch to keep and merge it first. Re-queue the conflicting task
for the next swarm run or implement it manually.

**Symptom:** The run stops launching new workstreams mid-run.
Fix: The token budget for the run (`swarm.tokenBudgetPerRun`) was exhausted. In-flight
workstreams complete their current step and park as `parked-budget`. Review and merge
the completed ones, then start a new run for the remaining tasks.

**Symptom:** The model used by a sub-agent is unexpectedly expensive.
Fix: The model is resolved by `model-policy.mjs tier <tierHint>`. Check the task
card's tier hint. Omitting `model` in the Agent tool dispatch silently inherits the
premium session model — the coordinator must always pass the resolved alias.

## Related

- [`/pipeline`](use-the-pipeline-board.md) — view and manage the backlog tasks the swarm pulls from.
- [`/dev-start`](start-a-focused-session.md) — alternative for single-task focused work.
- [`/ship`](../reference/skills.md) — end-to-end autonomous pipeline for a single objective.
- [`/worktree-new`](../reference/skills.md) — create a single isolated worktree manually.
