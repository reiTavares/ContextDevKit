---
description: Global deep analysis — every scan (code, security, deps, bugs) → report → ADRs → backlog.
argument-hint: [path or area to focus]
---

# 🔬 Deep Analysis (global)

A full-project sweep (focus: **$ARGUMENTS** if given, else the whole repo):
deterministic scanners **+ agent judgment** → one report → ADRs (if needed) →
DevPipeline backlog. Run before a release, on a cadence, or on demand.

1. **Deterministic pass** — aggregate every scanner:
   ```
   node vibekit/tools/scripts/deep-analysis.mjs --write
   ```
   Merges tech-debt, dependency/supply-chain, and contract findings into
   `vibekit/memory/deep-analysis-findings.json`.

2. **Judgment pass** — what regex can't see. Delegate in parallel (Agent tool):
   - `security` + `infra-security` → vulnerabilities, secrets, infra exposure.
   - `code-reviewer` → constitution / SRP / structure smells.
   - `architect` → cross-cutting design risks (→ candidate ADRs).
   - `qa-orchestrator` → coverage gaps on `qa.criticalPaths`.
   - **Bug pass:** read the highest-risk modules for likely defects (off-by-one,
     unhandled rejections, missing error handling, race conditions, boundary bugs)
     — **classify each by `bugType` + severity S1-S4**.

3. **Report** — one consolidated report: counts by scan + severity, the top issues
   (🔴 / 🟡 / 🟢), and what's healthy. This is the deliverable; keep it factual.

4. **Suggest ADRs** — for any finding implying an architectural decision (a pattern
   to adopt, a boundary to enforce, a dependency to drop), draft one with
   `/new-adr` (Context / Decision / Consequences).

5. **Fill the backlog** — every finding becomes a tracked, prioritized task:
   ```
   node vibekit/tools/scripts/pipeline.mjs ingest vibekit/memory/deep-analysis-findings.json --type chore
   ```
   Bugs found by judgment → `pipeline.mjs add --type bug --severity S1-S4
   --bug-type <t> --title "…"`. Priorities (WSJF / severity) + SLA are auto-set and
   **always user-editable** (`pipeline.mjs prioritize <id> <P>` / `wsjf <id> …`).

6. End with the natural next step — usually `/dev-start` or `/ship` on the worst item.

> This is the command the **security-mode** boot trigger reminds you to run on a
> cadence (config `securityMode.everyNSessions`). It's active, not reactive.
