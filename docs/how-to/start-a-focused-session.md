# How to start a focused session

<!-- GENRE: How-to guide (task-oriented)
     Goal: reader starts a scoped session that blocks opportunistic drift.
     Voice: direct, imperative — assume competence, skip "what is X" explanations. -->

## When to use this guide

You are about to begin a non-trivial change and want the AI to stay narrowly focused on
one objective — no drive-by refactors, no unrelated "while we're here" edits.

## Prerequisites

- ContextDevKit installed in the project (level 1 or higher).
- `node` 18+ available on the path.
- The project has been cloned and `npm install` run (if a `package.json` is present).

## Steps

1. Run `/dev-start` with your objective as the argument.

   ```shell
   /dev-start "add rate-limiting middleware to the API gateway"
   ```

   The skill immediately runs a sync preflight to surface in-flight branches and open
   PRs that might overlap your objective before you touch any code.

2. Let the bootstrap classify the economy plan and load context.

   The skill runs two scripts internally. You do not need to run them manually unless
   you want raw output:

   ```shell
   node contextkit/tools/scripts/economy/dev-start-bootstrap.mjs --objective -- "your objective"
   node contextkit/tools/scripts/context-pack.mjs --profile dev-start
   ```

   Wait for the boot report. It shows Project Map freshness, the task intake digest,
   and which economy levers are active.

3. Review the complexity classification.

   The skill classifies your objective automatically:

   ```shell
   node contextkit/tools/scripts/complexity-rubric.mjs classify "your objective"
   ```

   - **Trivial** — proceed directly; no story or architecture record required.
   - **Feature** — create a pipeline card first (`/pipeline add`).
   - **Architectural** — run `/new-adr` before writing any code.

   If the classifier flags a regulated domain (LGPD, fintech, healthcare), the session
   must route to the named specialist agents before continuing.

4. Confirm the scope boundary the skill proposes.

   The skill presents an IN-SCOPE / OUT-OF-SCOPE block. Read it, correct anything
   wrong, and give an explicit OK. The scope lock is active from this point forward.

5. If your objective references a backlog task by ID, start the card now.

   ```shell
   node contextkit/tools/scripts/pipeline.mjs start <id>
   ```

   The task heartbeat renews on every edit. Check off acceptance criteria before the
   session ends.

6. Work within scope until the objective is met.

   Any out-of-scope problem you spot goes into a "for next session" note — do not act
   on it now.

7. If the work outgrows the agreed scope mid-session, stop and re-classify.

   Do not silently expand scope (e.g., a bug fix that turns into a migration). Re-run
   the complexity rubric and get confirmation before continuing.

8. Close the session.

   ```shell
   /log-session
   ```

   If you made an architectural decision, also run `/new-adr` first.

## Verify it worked

- The boot report shows no overlapping PRs or branches that would duplicate work.
- The scope block is shown and confirmed before any file is edited.
- The task card (if applicable) is in `contextkit/pipeline/working/`.
- At the end, a session file exists under `contextkit/memory/sessions/`.

## Troubleshooting

**Symptom:** The sync preflight can not reach GitHub and blocks startup.
Fix: The script degrades gracefully to git-only view when `gh` is missing or
unauthenticated. It never hard-blocks; the output just shows less PR detail.

**Symptom:** The complexity classifier returns "architectural" for what feels like a
small change.
Fix: The classification is advisory, not a cage. State why you disagree, adjust the
tier with the user, and continue. The rubric favors caution on ambiguous signals.

**Symptom:** The scope definition is too broad — the AI keeps suggesting out-of-scope
edits.
Fix: Tighten the objective string. A more specific objective produces a narrower
IN-SCOPE block. You can also explicitly add exclusions in plain language when confirming
the scope.

## Related

- [`/log-session`](../reference/commands.md) — register the session after it ends.
- [`/new-adr`](record-a-decision.md) — required before architectural work.
- [`/pipeline`](use-the-pipeline-board.md) — create and move task cards.
- [`/workflow`](run-a-workflow.md) — for large, multi-session features.
