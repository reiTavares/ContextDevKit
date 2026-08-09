---
description: One-pass health audit — runs doctor, a tech-debt sweep, and a QA status check; summarizes top actions.
---

# 🔎 Audit

Run a consolidated health check of the project and summarize the most important
actions. Good to run weekly or before a release (and a natural fit for a
scheduled/recurring run — see below).

1. **Install health** — `node contextkit/tools/scripts/doctor.mjs` — report any ✗
   critical issues or ⚠ notes.
2. **Metrics** — `node contextkit/tools/scripts/stats.mjs` — note drift rate and
   cadence; flag if drift is high (sessions not being registered).
3. **Tech debt** — `node contextkit/tools/scripts/tech-debt-scan.mjs --quick` — list
   the worst offenders; interpret which are real (don't fix here).
4. **Contract** — if `l5.contractGlobs` is set,
   `node contextkit/tools/scripts/contract-scan.mjs` — flag removed/renamed exports.
5. **QA status** — if a test suite exists, run it (and coverage if available) and
   note whether `qa.criticalPaths` are covered vs `qa.coverageTarget`.
6. **Workspace state** — note stale claims without changing task status.

Output a single prioritized list: **🔴 do now / 🟡 soon / 🟢 fyi**, each with the
file and the one-line fix — this is the audit report.

The audit is read-only unless `--write` was explicitly requested for its report.
It never creates tasks automatically. Offer a separate, explicitly scoped
mutation for the top finding.

> Tip: to run this on a schedule, use the harness — e.g. `/loop` for an interval
> in-session, or `/schedule` to register a recurring remote agent that runs
> `/audit` (and pings you with the result).
