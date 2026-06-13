---
name: "source-command-pipeline-ship"
description: "L6 — autonomous feature pipeline. Drives the full squad: design → implement → review → test → log. Checkpoints can be manual or automatic."
---

# source-command-pipeline-ship

Use this skill when the user asks to run the migrated source command `ship`.

## Command Template

# 🚢 Ship (autonomous squad pipeline)

Objective: **$ARGUMENTS**

Run the end-to-end delivery pipeline, orchestrating the squad. Use task plan/checklist to
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

## Grade >= 3 — hardened quorum + kill-switch (ADR-0045 / ADR-0059)

This applies ONLY when `resolveAutonomy('ship-checkpoint', …)` returns `debate`
(grade >= 3). At grade ≤ 2 ignore this
section. At grade >= 3, a ◆ checkpoint may be cleared by a `/debate` quorum INSTEAD of
a human pause — but only under all of these, or you fall back to a manual pause:

1. **Blind voices** — run the deliberation per the ADR-0035 contract (voices blind
   to each other), embedding the `--for-subagent` pack (ADR-0044 D1). Plan the
   council + tiered research with `deliberation-council.mjs plan` (ADR-0070): the
   `fast`-tier scouts gather the checkpoint evidence cheaply, the reasoning voices
   judge it. The deterministic voice (below) is independent of that roster.
2. **≥ 1 deterministic voice** — its vote is NOT an LLM opinion but the **exit
   codes** of `npm test`, `node tools/selfcheck.mjs` and `/deps-audit`. Red exit ⇒
   that voice votes NO; you may not synthesize it away.
3. **Security veto** — a **Critical** from the security voice is a *veto, not a
   vote*: stop and escalate to the human, regardless of the other voices.
4. **`unresolved` → human** — an unresolved verdict never proceeds; it escalates.
5. **Provenance** — stamp the deliberation artifact id into the `state.json` event
   for the transition (`ship-state.mjs` note), so the quorum that authorized an
   autonomous step is auditable.

**Yield & kill-switch (always on at grade 4).** Re-consult `resolveAutonomy` at the
**start of every step** — never cache a grade for the whole run. Any user message or
interrupt cancels in-flight autonomous actions at the **next step boundary**; if the
user runs `/autonomy 1` mid-run it takes effect on the very next step. Branch-only:
the resolver returns `auto` for `push` only toward a non-default branch; a merge to
the default branch is always the human's.

**Budget downgrade (ADR-0044 D3).** When you re-consult the resolver, pass
`budgetExhausted: true` if the session has crossed `tokens.budgetPerSession`
(compare the session total from `token-report.mjs --json` against the config). At
grade 4 the resolver then returns grade-2 behaviour (`suggest`, `reason:
'budget-exhausted'`) — it **downgrades to consent, never blocks an edit**. Surface
the downgrade as a one-line digest so the user knows why the autonomy dropped.

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
   delegated agent starts cheap.

   **Model tier per dispatch (ADR-0052 Phase 2 — resolve, don't eyeball).**
   Classify the TASK (**think**: design, review, security, root-cause, planning →
   keep the agent's tier; **execute**: tests from a given plan, mechanical
   refactor, scaffold, format, summarize → cheap tier; **ambiguous**: agent
   default), then ask the resolver for the concrete alias:
   `node contextkit/tools/scripts/model-policy.mjs resolve --agent <name> --task <think|execute|ambiguous> [--qa-failures N] [--budget-exhausted] --host <claude|codex|agy>`
   using the current host value (`claude`, `codex`, or `agy`), then pass its
   `model` to the Agent tool (`execute` also uses low effort).
   Omitting `model` silently inherits the premium session model — the costly
   default. The resolver already enforces the floor (security / code-security /
   infra-security / privacy-lgpd never below `powerful`), the one-step escalation
   on `--qa-failures 2` (cap `reasoning`), and the budget downgrade (one tier
   down, never below the floor — ADR-0044 §3). If it returns `model:null`,
   surface the reason and dispatch without a fake override. Report any
   non-default resolution in the run summary.

   If the change crosses high-risk paths (L5), run
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
