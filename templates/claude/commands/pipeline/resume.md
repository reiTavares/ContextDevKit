---
description: Re-bind the current Claude Code session to a previously-unregistered ledger so the in-flight narrative can be finished and properly /log-session'd. (ticket 046)
allowed-tools: Bash(node:*)
---

The boot context flags drift when a session ended without
`/log-session` — important files were modified but the session never
registered. Today the only options are to (a) start fresh and orphan
the drift, or (b) piece together what happened from `git status` and
the per-session ledger. `/resume` is the third option: continue the
**same** session.

## When to use

- Boot context shows "Session `<sid>` ended without `/log-session`"
- You know which session was yours
- The files modified by that session are still on disk
- You want to finish what you started and `/log-session` it as one
  continuous session, not as two disconnected ones

## How

List the unregistered candidates:

```
node contextkit/tools/scripts/resume.mjs
```

Resume to a specific session id (full or a unique prefix is enough):

```
node contextkit/tools/scripts/resume.mjs <session-id>
```

After re-bind: subsequent track-edits append to the resumed session's
ledger; claims (if any) are re-asserted under the same id; `/log-session`
will register the resumed session normally.

## Output

```
  3 unregistered session(s) — candidates for /resume:

  b77d8b21-60a · 17 edit(s) · started 6h ago · 2 claim(s)
  d48bdf9c-ab2 · 8 edit(s)  · started 4h ago
  04b759ee-ef9 · 12 edit(s) · started 2h ago

  Resume with: node contextkit/tools/scripts/resume.mjs <session-id>
```

## Refusal modes

Per rule 8 (refuse, don't assume):

| Situation | Exit | Message |
|---|---|---|
| target id not present in `.claude/.sessions/` | 1 | "session not found among unregistered drift candidates" |
| target id is already registered | 1 | "already registered — nothing to resume" |
| target's path claims overlap an active session | 1 | "cannot resume: path(s) claimed by another active session" |

No silent invention. No partial resume.

## What `/resume` does NOT do

- It does **not** alter the historical ledger — only the `.last-touched`
  pointer (which session is "current").
- It does **not** re-create files that were deleted by the previous
  session. That's git's job, not ours.
- It does **not** auto-`/log-session`. Resume + finish + log are
  three deliberate steps.
