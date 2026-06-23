---
name: "source-command-qa-qa-signoff"
description: "QA — final verdict. Run the suite, check critical-path coverage vs target, write a PASS/NEEDS-WORK report."
---

# source-command-qa-qa-signoff

Use this skill when the user asks to run the migrated source command `qa-signoff`.

## Command Template

# 🧪 QA sign-off

Act as **qa-orchestrator** and produce the final QA verdict.

1. Run the project's test suite (and coverage if the runner supports it).
2. Read `contextkit/config.json` → `qa.criticalPaths` and `qa.coverageTarget`.
3. Assess:
   - Do all tests pass?
   - Are the `criticalPaths` covered (happy + failure modes), not just the easy
     lines?
   - Is coverage at or above `coverageTarget` (where measurable)?
   - If a **visual harness** exists (`visual-test.mjs status`), did the visual suite
     pass? An unintended screenshot diff is a NEEDS-WORK (have design-team confirm
     intentional changes before refreshing baselines).
4. Write a concise report: ✅ covered, ⚠️ gaps (with the specific files/cases
   missing), and a clear **PASS** or **NEEDS-WORK** verdict.
5. Record the verdict in the session log (or remind the user to `/log-session`).

This is advisory by default — it informs `/close-version`, it doesn't hard-block.
Treat a NEEDS-WORK on a critical path as a real blocker worth fixing first.

## Token economy (ADR-0103)

Run the test suite through the compact runner so only a bounded summary enters
context, not the full log:

```
node contextkit/tools/scripts/economy/run-compact.mjs <your test command>
```

The full log is written to `runs/<id>/` (gitignored); the exit code is the only
pass/fail source. Skip only if `economy.compaction.enabled` is false in config.
