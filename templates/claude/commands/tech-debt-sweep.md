---
description: L5 audit against the project constitution — flags oversized files, SRP smells, missing docs.
argument-hint: [profile: full | quick]
---

# 🧹 Tech Debt Sweep

Run a silent audit of the codebase against the constitution in `CLAUDE.md`. Profile: **$ARGUMENTS**
(default `full`; `quick` = only the worst offenders).

Detectors (adapt thresholds to the values declared in `CLAUDE.md`):

1. **File size** — source files over the project's line limit (default 280, hard cap ~308). List
   path + line count, sorted worst-first.
2. **SRP smell** — functions/modules whose name contains "And"/"E"/"Or" or that clearly do two
   things; suggest a split.
3. **Orphan/redundant docs** — comments that restate the code ("// fetches user" over
   `fetchUser()`), and exported business logic with NO doc comment.
4. **State-loop smell** (UI stacks) — components with `> 2 useState + ≥ 1 effect` not extracted into
   a hook.

Write findings to `vibekit/memory/tech-debt-board.md`, grouped by area, newest sweep on top with a
date header. Do NOT fix anything in this command — it is an audit. Surface the top 5 items to the
user and ask whether to open a focused `/dev-start` to address them.
