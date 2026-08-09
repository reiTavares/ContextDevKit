# Skill: deep-analysis

> Global read-only analysis across code, security, dependencies, and likely defects.
> Argument: [path or area to focus]
# 🔬 Deep Analysis (global)

A full-project sweep (focus: **<user-specified argument>** if given, else the whole repo):
deterministic scanners plus specialist judgment into one factual report.

1. **Deterministic pass** — aggregate every scanner:
   ```
   node contextkit/tools/scripts/deep-analysis.mjs --write
   ```
   Merges tech-debt, dependency/supply-chain, and contract findings into
   `contextkit/memory/deep-analysis-findings.json`.

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
   to adopt, a boundary to enforce, a dependency to drop), first scan existing
   decisions with `node contextkit/tools/scripts/adr-digest.mjs --json` [ADR-0027] so
   you extend/reference an existing ADR instead of duplicating it; then draft a new
   one with `/new-adr` (Context / Decision / Consequences) only if none fits.

5. End with the natural next step — usually an explicitly scoped `/dev-start`
   on the worst accepted item. The analysis itself creates no task, workflow, or
   source edit.

> This is the command the **security-mode** boot trigger reminds you to run on a
> cadence (config `securityMode.everyNSessions`). It's active, not reactive.
