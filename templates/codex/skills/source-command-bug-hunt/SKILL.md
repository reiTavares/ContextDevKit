---
name: "source-command-bug-hunt"
description: "Investigator mode — find root cause before writing any new feature code."
---

# source-command-bug-hunt

Use this skill when the user asks to run the migrated source command `bug-hunt`.

## Command Template

# 🔍 Mode: Bug Hunt

Symptom under investigation:

> **$ARGUMENTS**

## Posture (strict until root cause is confirmed)

1. **Do NOT write feature code or speculative fixes yet.** First understand the failure.

2. **Gather evidence**: ask the user for (or locate yourself) the exact error message, stack trace,
   logs, failing input, and reproduction steps. State what you have and what is missing.

3. **Map the flow**: trace the code path from entry point to the failure site. Reference files as
   `path:line`. Note every place state is transformed.

4. **Rank hypotheses** (most → least likely) with the evidence for each. Be explicit about what
   would confirm or eliminate each one.

5. **Propose the cheapest decisive experiment** to confirm the top hypothesis (a log line, a unit
   test, a one-line probe). Run it (or ask the user to) before committing to a fix.

6. **Only after root cause is confirmed**: propose the minimal fix, get approval, then implement.
   Add a regression test if the stack supports it.

7. **Report + backlog (RCA writeup).** Write a structured root-cause analysis —
   not just a one-liner [ADR-0030]:
   - **Symptom** — what was observed, with the exact error/repro.
   - **Root cause** — the single underlying defect (the *why*, not the *where*).
   - **Trigger** — what conditions surfaced it (why now / why here).
   - **Fix** — the minimal change that removes the root cause.
   - **Prevention** — the regression test + any guard (a selfcheck/lint rule) so
     this class of bug can't silently return.

   Record the bug — and any *related* issues you surfaced — in the
   DevPipeline, point by point:
   ```
   node contextkit/tools/scripts/pipeline.mjs add --type bug --priority <P0-P3> \
     --source "bug:<area>" --title "<symptom>"
   ```
   Auto-priority: data-loss / security / broken build → P0, broken core path → P1,
   degraded → P2, cosmetic → P3. If you fixed it this session, `pipeline.mjs move
   <id> conclusion`. Priorities are **always editable** (`prioritize <id> <P>` / `/pipeline`).

Resist the urge to "just try something." A confirmed root cause beats three plausible guesses.
