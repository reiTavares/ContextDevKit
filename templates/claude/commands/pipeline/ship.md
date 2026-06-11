---
description: L6 — autonomous feature pipeline. Drives the full squad: design → implement → review → test → log. Checkpoints can be manual or automatic.
argument-hint: <feature / objective> [--auto]
---

# 🚢 Ship (autonomous squad pipeline)

Objective: **$ARGUMENTS**

Run the end-to-end delivery pipeline, orchestrating the squad. Use TodoWrite to
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

## Resume & progress tracking (ticket 074)

Before anything else, check for an **interrupted ship** to resume:
`node contextkit/tools/scripts/ship-state.mjs current`. If it reports an in-flight
run, offer to **resume from the stage it names** instead of restarting from scope —
pick up at that stage and continue. Otherwise open a fresh run at the start of
step 1: `ship-state.mjs begin "$ARGUMENTS"`.

As you enter each stage below, stamp it:
`ship-state.mjs step <scope|design|plan-tests|implement|self-review|test|quality-gates|record|report>`.
At a checkpoint pause, mark `ship-state.mjs block`; on a red gate, `ship-state.mjs end failed`
and STOP. When step 9 completes, `ship-state.mjs end done`. This keeps the live
stage in `state.json` so a crash, context loss, or `/clear` never loses your place.

## Pipeline

1. **Scope & state.** (`ship-state.mjs step scope`) Run `node contextkit/tools/scripts/context-pack.mjs` (latest-session
   digest + immutable rules + recent ADRs in one call) and
   `node contextkit/tools/scripts/adr-digest.mjs --search "<objective keywords>"` for the
   ADRs relevant to the objective [ADR-0027] — open a full ADR only when needed.
   Then **right-size the pipeline** [ADR-0030]:
   `node contextkit/tools/scripts/complexity-rubric.mjs classify "$ARGUMENTS"`. A
   **regulated domain** (LGPD / fintech / healthcare) makes the design + review
   stages MANDATORY and pulls the named agents (e.g. `@privacy-lgpd`, `@security`)
   into the squad; an **architectural** tier means the ADR in step 8 is required,
   not optional. Restate the objective; define IN/OUT-OF-SCOPE (as `/dev-start`).
2. **Design** — delegate to `architect`: options, trade-offs, recommended path,
   blast radius. When you delegate to ANY agent in this pipeline, first run
   `node contextkit/tools/scripts/context-pack.mjs --for-subagent --objective "$ARGUMENTS"`
   and **embed its output at the top of the agent's prompt** (ADR-0044 D1) — the
   bounded pack carries the standing rule "do not re-read boot context", so each
   delegated agent starts cheap. If it crosses high-risk paths (L5), run
   `/simulate-impact` first. ◆ Checkpoint: confirm the design with the user.
3. **Plan tests** — delegate to `qa-orchestrator` (`/test-plan`): happy / edge /
   failure for the scope.
4. **Implement** — route to the right domain agent(s) (backend/frontend/db/…).
   Keep changes within scope and the constitution (file size, SRP, naming, docs).
5. **Self-review** — delegate to `code-reviewer`: constitution + immutable rules.
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
