# How to reduce token cost

<!-- GENRE: How-to guide (task-oriented)
     Goal: reader uses the economy runtime features to lower token spend per session.
     Voice: direct, imperative — assume competence, skip "what is X" explanations. -->

## When to use this guide

Your sessions are consuming more tokens than expected, or you want to be deliberate
about cost before starting a large piece of work. The economy runtime is active by
default at level 6; this guide shows how to use its levers intentionally.

## Prerequisites

- ContextDevKit installed at level 6 (economy runtime active).
- `node` 18+ available on the path.
- The Project Map baseline exists (`contextkit/memory/project-map/00-index.md`).

## Steps

### Before the session — establish a cheap starting point

1. Check whether the Project Map is fresh before doing broad file searches.

   ```shell
   node contextkit/tools/scripts/project-map.mjs --check
   ```

   A stale map means the AI re-explores the tree every session. Refresh it when stale:

   ```shell
   node contextkit/tools/scripts/project-map.mjs
   ```

2. Use `--find` for targeted symbol and path lookup instead of full-tree scans.

   ```shell
   /project-map --find "your symbol or module name"
   ```

   This reads the already-built inventory (`02-inventory.md`) rather than running a
   new `grep` over the source tree.

3. During `/dev-start`, let the bootstrap plan the economy levers before loading
   broad context.

   ```shell
   node contextkit/tools/scripts/economy/dev-start-bootstrap.mjs --objective -- "your objective"
   ```

   The bootstrap reports which context stages are needed and their relative cost. Load
   only what the report flags as necessary.

### During the session — run compact instead of raw

4. Run the test suite through the compact runner so only a bounded summary enters
   context, not the full log.

   ```shell
   node contextkit/tools/scripts/economy/run-compact.mjs <your test command>
   ```

   The full log is written to `runs/<id>/` (gitignored). Only the exit code and a
   short summary enter the session context. Skip this step only if
   `economy.compaction.enabled` is false in config.

5. Use the context pack profile instead of opening files one by one.

   ```shell
   node contextkit/tools/scripts/context-pack.mjs --profile dev-start
   ```

   One call returns the latest-session digest, the `[Unreleased]` changelog section,
   the immutable rules, open backlog, and recent decisions — bounded to what is
   actually needed for a coding session.

### Dispatch work at the right model tier

6. For any Agent dispatch, resolve the model tier before launching.

   Do not eyeball which model to use. Run the resolver:

   ```shell
   node contextkit/tools/scripts/model-policy.mjs resolve \
     --agent <agent-name> \
     --task <think|execute|ambiguous> \
     --host <claude|codex|agy>
   ```

   Pass the returned `model` alias to the Agent tool's `model` parameter. Omitting
   `model` silently inherits the premium session model — the most expensive default.

   Tier posture:
   - **Haiku** — batch mechanical investigation: grep, glob, log triage, test runs.
   - **Sonnet** — bounded low/medium-risk implementation.
   - **Opus** — decisions, high/critical-risk code (auth, migrations, public contracts).

7. Never spawn an agent for a task that is three commands or fewer.

   Run deterministic commands directly. Coordination overhead costs more than the
   commands themselves for small tasks.

### Reduce context re-loading across sessions

8. Register each session at the end with `/log-session`.

   A registered session means the next session starts from a compact digest (one
   short file) rather than re-reading many source files to reconstruct state.

9. Run `/distill-sessions` periodically to compress older session logs.

   ```shell
   /distill-sessions
   ```

   Then apply the distilled output:

   ```shell
   /distill-apply
   ```

   This replaces verbose older session files with compact summaries, shrinking the
   context needed at boot.

### Check the economy config

10. Inspect the active economy toggles.

    ```shell
    node contextkit/tools/scripts/context-pack.mjs --profile economy
    ```

    Key flags in `contextkit/config.json`:
    - `economy.compaction.enabled` — controls `run-compact`.
    - `economy.leanLoop.enabled` — controls delegate-to-worker in squad pipelines.
    - `tokens.budgetPerSession` — triggers grade downgrade at grade 4 when exceeded.

## Verify it worked

- `run-compact` exits with the same code as the raw test command, and `runs/<id>/`
  contains the full log.
- The boot banner shows the economy mode (e.g., `shadow` for advisory).
- `token-report.mjs --json` shows the session total is below `tokens.budgetPerSession`.

## Troubleshooting

**Symptom:** `run-compact.mjs` reports a different pass/fail verdict than the raw
command.
Fix: `run-compact` uses the exit code as the sole pass/fail signal. If the raw test
command exits non-zero on warning-only output, it will also fail compact. Inspect
`runs/<id>/stdout.log` for the full output.

**Symptom:** `model-policy.mjs resolve` returns `model:null`.
Fix: Surface the reason to the user and dispatch without a fake model override. A null
result means no tier matched — do not invent a model name.

**Symptom:** The Project Map refreshes every session, costing tokens.
Fix: The boot hook nudges you when the map is stale. Run `project-map.mjs` after
large refactors, not every session. A fresh map is read cheaply from disk.

## Related

- [`/dev-start`](start-a-focused-session.md) — bootstraps the economy plan at session start.
- [`/project-map`](../reference/commands.md) — generate or check the project map.
- [`/distill-sessions`](../reference/commands.md) — compress older session logs.
- [`/context-stats`](../reference/commands.md) — inspect context usage across sessions.
