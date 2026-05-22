---
description: One-pass health audit — runs doctor, a tech-debt sweep, and a QA status check; summarizes top actions.
---

# 🔎 Audit

Run a consolidated health check of the project and summarize the most important
actions. Good to run weekly or before a release (and a natural fit for a
scheduled/recurring run — see below).

1. **Install health** — run `node vibekit/tools/scripts/doctor.mjs` and report
   any ✗ critical issues or ⚠ notes.
2. **Tech debt** — perform a `/tech-debt-sweep` (quick profile is fine): list the
   worst offenders against the `CLAUDE.md` constitution (oversized files, SRP
   smells, missing docs). Don't fix here — just surface.
3. **QA status** — if a test suite exists, run it (and coverage if available) and
   note whether `qa.criticalPaths` are covered vs `qa.coverageTarget`.
4. **Drift** — note any unregistered prior sessions or stale claims from the boot
   context.

Output a single prioritized list: **🔴 do now / 🟡 soon / 🟢 fyi**, each with the
file and the one-line fix. Offer to open a focused `/dev-start` on the top item.

> Tip: to run this on a schedule, use the harness — e.g. `/loop` for an interval
> in-session, or `/schedule` to register a recurring remote agent that runs
> `/audit` (and pings you with the result).
