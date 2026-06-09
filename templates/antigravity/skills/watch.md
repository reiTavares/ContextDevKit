# Skill: watch

> Watch the active session ledger — what got edited, in order. Optional --follow streams new entries.
> Argument: [-f | --follow]
# 👀 Watch the active ledger

Stream what the **current session** has touched, in the order it touched them.
Zero-dep, file-based — reads `.claude/.sessions/<active-id>.json` via the
runtime's `readMostRecentLedger`.

## Usage

```
node contextkit/tools/scripts/watch.mjs           # print all entries and exit
node contextkit/tools/scripts/watch.mjs --follow  # stream (re-poll every 500 ms; Ctrl-C to stop)
```

Output format:

```
# session 04b759ee — 17 entries
[14:02:11] EDIT  templates/claude/commands/dev-start.md
[14:02:14] WRITE templates/contextkit/runtime/providers/review/_adapter.mjs
[14:02:16] WRITE templates/contextkit/runtime/providers/review/gh.mjs
...
```

## When to use it

- **Mid-session sanity check.** "What has this session actually edited so
  far?" without opening the ledger JSON in the editor.
- **Long agent run.** Pair with `--follow` in a second pane to watch a
  sub-agent's progress in real time.
- **Drift triage.** When the Stop hook nags about unregistered work, run
  `/watch` once to see the footprint before you decide to `/log-session`
  or `/resume`.

## What it does *not* do

- It does **not** filter by ticket. Ticket-scoped view comes when ticket
  042's per-task scratch convention lands and the `/pipeline` board gains
  a "what touched this ticket?" surface.
- It does **not** modify state. Pure read.
- It does **not** invent entries. If the ledger is missing or the active
  session cannot be resolved, the script exits non-zero with a clear
  reason — never prints "0 entries" as a soft success.
