# Skill: audit

> One-pass health audit — runs doctor, a tech-debt sweep, and a QA status check; summarizes top actions.
# 🔎 Audit

Run a consolidated health check of the project and summarize the most important
actions. Good to run weekly or before a release (and a natural fit for a
scheduled/recurring run — see below).

1. **Install health** — `node vibekit/tools/scripts/doctor.mjs` — report any ✗
   critical issues or ⚠ notes.
2. **Metrics** — `node vibekit/tools/scripts/stats.mjs` — note drift rate and
   cadence; flag if drift is high (sessions not being registered).
3. **Tech debt** — `node vibekit/tools/scripts/tech-debt-scan.mjs --quick` — list
   the worst offenders; interpret which are real (don't fix here).
4. **Contract** — if `l5.contractGlobs` is set,
   `node vibekit/tools/scripts/contract-scan.mjs` — flag removed/renamed exports.
5. **QA status** — if a test suite exists, run it (and coverage if available) and
   note whether `qa.criticalPaths` are covered vs `qa.coverageTarget`.
6. **Drift** — note any unregistered prior sessions or stale claims from boot.

Output a single prioritized list: **🔴 do now / 🟡 soon / 🟢 fyi**, each with the
file and the one-line fix — this is the audit report.

**Feed the backlog so nothing is lost.** Ingest the mechanical findings (run
`tech-debt-scan.mjs --write` first, then `node vibekit/tools/scripts/pipeline.mjs
ingest vibekit/memory/tech-debt-findings.json --type chore`), and `pipeline.mjs
add` the 🔴/🟡 items you raised by judgment (🔴→P0/P1, 🟡→P2). The priorities are
**auto-assigned but always editable** by the user (`pipeline.mjs prioritize <id>
<P>` or `/pipeline`). Offer to open a focused `/dev-start` on the top item.

> Tip: to run this on a schedule, use the harness — e.g. `/loop` for an interval
> in-session, or `/schedule` to register a recurring remote agent that runs
> `/audit` (and pings you with the result).
