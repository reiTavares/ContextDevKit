---
description: Diagnose this project's VibeDevKit install (node, config, hook wiring, git hooks, onboarding).
---

> ⚠️ **Deprecated (1.0):** **/audit** runs the doctor *plus* stats, tech-debt and
> QA — prefer it. This still runs just the doctor.

Run the VibeDevKit health check:

```
node vibekit/tools/scripts/doctor.mjs
```

It verifies Node version, `vibekit/config.json` validity + level, that
`.claude/settings.json` hook wiring matches the configured level, git-hook
presence (Level ≥ 3), memory scaffolding, and onboarding state — printing a
suggested fix for each problem.

Show the output to the user. If it reports critical issues (✗), offer to fix them
(usually `/vibe-level <n>` to rewire, or re-running the installer). If it only
shows advisory notes (⚠), mention them but don't force action.
