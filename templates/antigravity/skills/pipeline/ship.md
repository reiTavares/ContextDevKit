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
- **Automatic (`--auto` in the arguments)** — do not pause at ◆. Evaluate the
  same objective criteria and report red evidence honestly; repair it when that
  is within scope, otherwise surface it as unresolved. These checkpoints do not
  add guarded domains. Irreversible external actions still use the host's real
  confirmation boundary.

State which mode you're running at the start.

## Optional deliberation and interruption

Use `/debate` only when the decision genuinely benefits from independent
specialist judgment or the owner explicitly requests it. Councils, quorums,
agent receipts, and model output never authorize or deny a ship step. A user
message or interrupt changes the active instruction at the next safe boundary.
Token-budget telemetry may recommend a cheaper path, but it never changes
permission. Force-push, secret rotation, and destructive production actions use
the explicit risk acknowledgement plus the host/platform confirmation boundary.

## Resume & progress tracking (ticket 074)

Before anything else, check for an **interrupted ship** to resume:
`node contextkit/tools/scripts/ship-state.mjs current`. If it reports an in-flight
run, offer to **resume from the stage it names** instead of restarting from scope —
pick up at that stage and continue. Otherwise open a fresh run at the start of
step 1: `ship-state.mjs begin "<user-specified argument>"`.

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
   `node contextkit/tools/scripts/complexity-rubric.mjs classify "<user-specified argument>"`. A
   regulated-domain signal may recommend a specialist report, but LGPD remains
   shadow and no classifier forces a workflow, agent, or guarded gate. Restate
   the objective and define IN/OUT-OF-SCOPE (as `/dev-start`).
2. **Design** — adopt the posture of `architect` (see `.agents/agents/architect.md`): options, trade-offs, recommended path,
   blast radius. When you adopt the posture of `ANY` (see `.agents/agents/ANY.md`) agent in this pipeline, first run
   `node contextkit/tools/scripts/context-pack.mjs --for-subagent --objective "<user-specified argument>"`
   and **embed its output at the top of the agent's prompt** (ADR-0044 D1) — the
   bounded pack carries the standing rule "do not re-read boot context", so each
   delegated agent starts cheap.

   **Model recommendation per dispatch (ADR-0158).** Ask the resolver for an
   optional recommendation:
   `node contextkit/tools/scripts/model-policy.mjs resolve --agent <name> --task <think|execute|ambiguous> [--task-kind kind] [--complexity value] [--risk value] [--title "objective"] [--qa-failures N] [--budget-exhausted] --host <claude|codex|agy>`
   A valid result says `decision:"recommend"`. Missing dimensions, an unknown
   model, a profile conflict, or malformed output emits one warning and the
   current agent continues. The active agent decides whether to delegate and
   which available host model to use.

   If the change crosses high-risk paths, `/simulate-impact` is useful evidence,
   not a universal prerequisite. ◆ Checkpoint: present the design evidence.
3. **Plan tests** — adopt the posture of `qa-orchestrator` (see `.agents/agents/qa-orchestrator.md`) (`/test-plan`): happy / edge /
   failure for the scope.
4. **Implement** — route to the right domain agent(s) (backend/frontend/db/…).
   Keep changes within scope and the constitution (file size, SRP, naming, docs).
5. **Self-review** — adopt the posture of `code-reviewer` (see `.agents/agents/code-reviewer.md`): constitution + immutable rules.
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

If any agent is unavailable, continue on the active agent. Run and report review
and tests honestly; neither agent availability nor a routing receipt may block
the requested implementation.

## Token economy (ADR-0103)

Default to **delegate-to-worker** for mechanical work, but keep the controller
responsible for scope, gates, and final synthesis.

Before each subagent dispatch:

1. Resolve the bounded dispatch profile:
   `node contextkit/tools/scripts/economy/subagent-profile.mjs`, and attach its
   JSON to the agent packet together with the `--for-subagent` context pack.
2. Build a controller-scoped lean-loop hint:
   `node contextkit/tools/scripts/economy/lean-loop-cli.mjs --controller ship --touch <comma-separated-touch-set>`.
   Use it to decide whether delegation is cheaper than direct execution; if it
   says direct work is cheaper, do not dispatch just to satisfy a pattern.
3. Require the §A output envelope and merge the structured result. Do not
   re-prose a subagent report.

Honor `economy.leanLoop.enabled`. If any economy lever lacks data, record it as
`skipped` with the reason in the run summary.
