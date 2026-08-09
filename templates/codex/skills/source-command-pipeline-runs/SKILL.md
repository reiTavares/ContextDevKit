---
name: "source-command-pipeline-runs"
description: "List recent task transitions + pipeline runs from the state.json substrate (ADR-0015 Part C). Read-only, token-light."
---

# source-command-pipeline-runs

Use this skill when the user asks to run the migrated source command `runs`.

## Command Template

Lists the **last N in-flight items** — DevPipeline tasks and squad pipeline
runs — by reading `contextkit/pipeline/<id>/state.json`. Read-only; never
mutates state.

## When to use

- "What was I working on yesterday?" — recent task transitions
- "Did the forge pipeline succeed?" — last few pipeline runs
- A quick activity log when `contextkit/memory/SESSIONS.md` is too coarse

## How

Run the script:

```
node contextkit/tools/scripts/runs.mjs
```

Flags (combine freely):

| Flag | Effect |
|---|---|
| `--kind task` | only DevPipeline tasks |
| `--kind pipeline-run` | only squad pipeline executions |
| `--limit N` | override the default cap (20) |
| `--all` | no cap |
| `--json` | machine-readable output |

## Output shape

```
📋 tasks
────────────────────────────────────────────
  🔵 039   [working ] · reiTavares · feat/foo · started 12m ago
  ✅ 038   [done    ] · reiTavares · main      · ended 2h ago (35m 12s)

🤖 pipeline runs
────────────────────────────────────────────
  ✅ agent-forge-001 [done      ] 8/8 steps (eval-gate×1) · ended 1h ago (4m 22s)
```

The status badges mirror the DevPipeline board:
`📋` backlog · `🔵` working · `🟡` testing · `✅` done · `🔄` running ·
`⏸` blocked-on-checkpoint · `❌` failed.

## What you can do next

- `/pipeline start <id>` / `/pipeline stop <id>` for task transitions
- `/context-stats` for aggregate telemetry (Forge Stats reads the same substrate)
- `/runs --json` to feed another tool

## Refusal

When no state files exist yet, the command prints a single line:

> No runs yet. Start a task with `/pipeline start <id>` or run a squad pipeline.

— and exits 0. This is intentional: a quiet project is not an error.
