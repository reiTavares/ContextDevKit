# Skill: ship

> L6 — autonomous feature pipeline. Drives the full squad: design → implement → review → test → log. Checkpoints can be manual or automatic.
> Argument: <feature / objective> [--auto]
# 🚢 Ship (autonomous squad pipeline)

Objective: **<user-specified argument>**

Run the end-to-end delivery pipeline, orchestrating the squad. Use task.md artifact (or equivalent tracking) to
track the stages.

## Checkpoint mode

The stages marked ◆ are checkpoints. Pick the mode from the arguments:

- **Manual (default)** — pause and ask for the user's OK at each ◆. Safest.
- **Automatic (`--auto` in the arguments)** — do NOT pause at ◆; instead each
  checkpoint becomes an **automatic gate**: proceed only if its objective
  criteria pass (design has no unresolved high-risk item; review has zero
  blockers; tests green; coverage ≥ `qa.coverageTarget` on `qa.criticalPaths`).
  If a gate **fails**, STOP and report — never push past a red gate. Always pause
  for the user before an irreversible action (commit/push/PR) regardless of mode.

State which mode you're running at the start.

## Pipeline

1. **Scope & state.** Read latest session + relevant ADRs + `CLAUDE.md`. Restate
   the objective; define IN/OUT-OF-SCOPE (as `/dev-start`).
2. **Design** — adopt the posture of `architect` (see `.antigravity/agents/architect.md`): options, trade-offs, recommended path,
   blast radius. If it crosses high-risk paths (L5), run `/simulate-impact` first.
   ◆ Checkpoint: confirm the design with the user.
3. **Plan tests** — adopt the posture of `qa-orchestrator` (see `.antigravity/agents/qa-orchestrator.md`) (`/test-plan`): happy / edge /
   failure for the scope.
4. **Implement** — route to the right domain agent(s) (backend/frontend/db/…).
   Keep changes within scope and the constitution (file size, SRP, naming, docs).
5. **Self-review** — adopt the posture of `code-reviewer` (see `.antigravity/agents/code-reviewer.md`): constitution + immutable rules.
   Fix blockers before continuing.
6. **Test** — `/scaffold-tests` then run the suite; `/qa-signoff` against
   `qa.criticalPaths` + `coverageTarget`. If the UI's *look* is part of the change,
   run the **visual** suite too (`/visual-test`). ◆ Checkpoint if anything is red.
7. **Quality gates** — run `tech-debt-scan` and (if `l5.contractGlobs` set)
   `contract-scan`; surface regressions.
8. **Record** — `/new-adr` if a real decision was made; `/log-session`; update
   `CHANGELOG.md` `[Unreleased]`.
9. **Report** — summary: what shipped, tests, debt/contract status, follow-ups.
   Offer the commit/PR (do not push without the user's OK).

If any agent isn't available in this environment, do that stage yourself but keep
the gates. Never skip the review and test stages to "save time".
