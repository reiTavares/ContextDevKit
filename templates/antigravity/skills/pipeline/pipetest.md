# Skill: pipetest

> Deterministic QA gate (ADR-0055) — run the project suite; green + complete acceptance criteria ⇒ qa-approve testing cards into conclusion; red ⇒ report (and qa-reject only attributable failures).
> Argument: [taskId …] | --all
# 🧪 Pipetest (deterministic testing-lane gate)

Targets: **<user-specified argument>** (task ids in `testing/`, or `--all` for the whole lane;
no argument = `--all`).

You are running the ADR-0055 deterministic QA sign-off. The verdict is the
SUITE'S EXIT CODE — never your opinion of the code. Use task.md artifact (or equivalent tracking) for the steps.

## 1. Run the suite

Run the project's full gate — in this repo `npm run ci`; in an installed
project, the runner `/qa-signoff` would use (check `qa.*` config / package
scripts). Capture the exit code and a one-line summary (suites passed, file
count, timestamp).

## 2. Green → approve what is approvable

For EACH targeted card in `testing/`:

1. Read the card. If its acceptance criteria have **≥1 checkbox and zero
   unchecked**, run:
   `node contextkit/tools/scripts/pipeline.mjs qa-approve <id> --evidence "<runner> exit 0 — <summary> @<ISO date>"`
   The verb itself re-validates (testing-only, evidence required, checkboxes
   complete) — if it refuses, relay its reason verbatim; never fall back to a
   bare `move` to force the result.
2. If the card has unchecked or missing checkboxes: **report it, don't approve
   it** — list exactly which boxes are open. The human either completes the
   card or hand-moves it.

## 3. Red → report; bounce only what is attributable

A red suite NEVER mass-bounces the lane. Identify which failing test belongs to
which card (its own new tests / its touched files). Only for an attributable
card: `node contextkit/tools/scripts/pipeline.mjs qa-reject <id> "<the failing
output tail>"`. Everything else: report the failure and stop — fixing is a
separate decision.

## 4. Report

One table: card → verdict (approved / left-in-testing + why / rejected) +
the suite line. Note any card the human still has to look at.

## Hard rules (ADR-0055 / ADR-0043)

- `qa-approve` is the only path you use into `conclusion` — never the free-form
  `move` (that one belongs to the human).
- Evidence is mandatory and goes on the card + the event log (actor `qa`).
- Swarm runs never call this themselves — a human invoking `/pipetest` over the
  parked lane is the designed closing move after `/swarm review`.

## Token economy (ADR-0103)

Run the test suite through the compact runner so only a bounded summary enters
context, not the full log:

```
node contextkit/tools/scripts/economy/run-compact.mjs <your test command>
```

The full log is written to `runs/<id>/` (gitignored); the exit code is the only
pass/fail source. Skip only if `economy.compaction.enabled` is false in config.
