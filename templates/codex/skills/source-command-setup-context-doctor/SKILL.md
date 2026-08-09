---
name: "source-command-setup-context-doctor"
description: "Diagnose this project's ContextDevKit install (node, config, hook wiring, git hooks, onboarding)."
---

# source-command-setup-context-doctor

Use this skill when the user asks to run the migrated source command `context-doctor`.

## Command Template

> ⚠️ **Deprecated (1.0):** **/audit** runs the doctor *plus* stats, tech-debt and
> QA — prefer it. This still runs just the doctor.

Run the ContextDevKit health check:

```
node contextkit/tools/scripts/doctor.mjs
```

It verifies Node version, `contextkit/config.json` validity + level, that
`.claude/settings.json` hook wiring matches the configured level, git-hook
presence (Level ≥ 3), memory scaffolding, and onboarding state — printing a
suggested fix for each problem.

Show the output to the user. If it reports critical issues (✗), offer to fix them
(usually `/context-level <n>` to rewire, or re-running the installer). If it only
shows advisory notes (⚠), mention them but don't force action.
