---
description: Investigator mode — find root cause before writing any new feature code.
argument-hint: <bug description / symptom>
---

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

Resist the urge to "just try something." A confirmed root cause beats three plausible guesses.
