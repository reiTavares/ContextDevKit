# Run a parallel swarm

<!-- GENRE: How-to (task-oriented) -->

Use parallel agents when ready tasks are independent and the host can execute
them concurrently. A swarm is optional execution, not a permission mechanism.

## 1. Choose one canonical scope

Identify an existing workflow or batch and inspect its ready tasks:

```shell
node contextkit/tools/scripts/pipeline.mjs list --tasks <scope>
node contextkit/tools/scripts/pipeline.mjs board --tasks <scope>
```

Do not pull from a global queue. Dependencies and current status come from that
scope's `tasks.json`.

## 2. Preview the partition

```text
/swarm plan --tasks <scope>
```

Review concrete ownership paths, dependency readiness, and likely conflicts.
Keep overlapping writers in one workstream. Missing touch hints are uncertainty
to resolve, not a reason to invent permission or refuse unrelated work.

## 3. Run the accepted plan

```text
/swarm run --tasks <scope>
```

The coordinator may create isolated branches/worktrees up to the host's reported
concurrency limit. Model and specialist recommendations are non-binding. Each
worker returns its owned diff, tests, deviations, and remaining risks.

An explicit run request covers the reversible local plan. Pushes, default-branch
changes, secrets, production mutations, and destructive cleanup still require
the real host confirmation applicable to that action.

## 4. Integrate and verify

The coordinator reviews every returned diff, checks for overlap, integrates in a
known order, and reruns focused plus shared tests. Task status changes go through
the canonical CAS writer; workers never edit projections or move directories.

```shell
node contextkit/tools/scripts/pipeline.mjs board --tasks <scope>
```

## 5. Clean up deliberately

Remove worktrees only after their branches and uncommitted files are inspected.
Report what was removed and whether it remains recoverable from Git.

See [Use the pipeline board](use-the-pipeline-board.md) and
[Host parity](../explanation/contextkit-parity.md).
