---
description: L6 — autonomous feature pipeline. Drives the full squad: design → implement → review → test → log, with checkpoints.
argument-hint: <feature / objective>
---

# 🚢 Ship (autonomous squad pipeline)

Objective: **$ARGUMENTS**

Run the end-to-end delivery pipeline, orchestrating the squad. Use TodoWrite to
track the stages and **pause for the user's OK at each checkpoint (◆)** — this is
autonomous, not unsupervised.

## Pipeline

1. **Scope & state.** Read latest session + relevant ADRs + `CLAUDE.md`. Restate
   the objective; define IN/OUT-OF-SCOPE (as `/dev-start`).
2. **Design** — delegate to `architect`: options, trade-offs, recommended path,
   blast radius. If it crosses high-risk paths (L5), run `/simulate-impact` first.
   ◆ Checkpoint: confirm the design with the user.
3. **Plan tests** — delegate to `qa-orchestrator` (`/test-plan`): happy / edge /
   failure for the scope.
4. **Implement** — route to the right domain agent(s) (backend/frontend/db/…).
   Keep changes within scope and the constitution (file size, SRP, naming, docs).
5. **Self-review** — delegate to `code-reviewer`: constitution + immutable rules.
   Fix blockers before continuing.
6. **Test** — `/scaffold-tests` then run the suite; `/qa-signoff` against
   `qa.criticalPaths` + `coverageTarget`. ◆ Checkpoint if anything is red.
7. **Quality gates** — run `tech-debt-scan` and (if `l5.contractGlobs` set)
   `contract-scan`; surface regressions.
8. **Record** — `/new-adr` if a real decision was made; `/log-session`; update
   `CHANGELOG.md` `[Unreleased]`.
9. **Report** — summary: what shipped, tests, debt/contract status, follow-ups.
   Offer the commit/PR (do not push without the user's OK).

If any agent isn't available in this environment, do that stage yourself but keep
the gates. Never skip the review and test stages to "save time".
