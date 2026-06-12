---
name: "source-command-debate"
description: "Open a multi-agent deliberation — independent voices debate a hard question, a synthesizer converges, the result feeds an ADR. (ADR-0035)"
---

# source-command-debate

Use this skill when the user asks to run the migrated source command `debate`.

## Command Template

Run a **deliberation** on: **$ARGUMENTS**

A deliberation is PRE-DECISION working material (ADR-0035): genuinely independent
voices argue a hard question, a separate synthesizer converges, and the result
feeds an ADR's Context. It is NOT the canonical record of the *why* — the ADR is.

0. **Gate.** Read `deliberations` from `contextkit/config.json` (fall back to the
   defaults in `runtime/config/defaults.mjs`). If `active` is `false`, stop and say
   so. Read `voices` (default 3) for the number of positions. The `minLevel` gate
   only governs the *automatic* nudge — an explicit `/debate` always runs when
   `active`.

1. **Frame the question.** Restate `$ARGUMENTS` as a single decision question with
   just enough context for an independent reader to take a side. If it's too vague
   to debate (no real tension, or several questions tangled together), ask one
   clarifying question before spending agent calls.

2. **Fan out to independent voices.** First run
   `node contextkit/tools/scripts/context-pack.mjs --for-subagent --objective "<the question>"`
   and **embed its output verbatim at the top of every voice's Task prompt** (ADR-0044 D1) —
   one bounded pack, so the voices don't each re-read boot context. Then dispatch
   **`voices`** sub-agents with the Task tool, IN PARALLEL, each assigned ONE distinct
   position and **blind to the others' arguments** — this independence is the whole
   point (ADR-0035); a single model role-playing every side collapses to its own prior.
   Assign genuinely different axes (e.g. correctness vs. cost vs. reversibility/blast-radius),
   not three shades of the same take. Each voice returns its strongest one-paragraph case +
   the trade-off it accepts. Keep them CONCISE, OBJECTIVE, HIGHLY TECHNICAL.
   Voices are think-class — never downgrade them to a cheap model (ADR-0052's
   tier override applies to execution dispatches only; deliberation quality IS
   the product here).

3. **Synthesize (you, not the voices).** You are the orchestrator — you argued no
   position, so you declare the outcome. Weigh the cases: which wins on which axis,
   what each loser contributes that survives, the decisive trade-off. Then either:
   - **Consensus** → a clear verdict, OR
   - **`unresolved`** → record the positions + the unresolved tension as the
     trade-off the human must break. This is a VALID outcome, not a failure. Do not
     manufacture agreement to look decisive.

4. **Write the artifact.** Copy `contextkit/memory/deliberations/_TEMPLATE.md` to
   `contextkit/memory/deliberations/<YYYY-MM-DD>-<NN>-<kebab-slug>.md` where `NN` is
   the next monotonic number (highest existing + 1, zero-padded; start at `01`).
   Fill Question / Positions (one per voice) / Synthesis / Verdict and set
   `Status: resolved | unresolved`. Then refresh the index:
   `node contextkit/tools/scripts/deliberations-reindex.mjs`.

5. **Feed an ADR.**
   - If `unresolved`: offer NO ADR — the tension is the deliverable. Suggest the
     human break it or re-run `/debate` with more context.
   - If `resolved` (default, dry-run): assemble a PRE-FILLED `/new-adr` draft
     (Context = the Synthesis, Decision = the Verdict, Consequences = the
     trade-offs raised) and present it for approval. Write nothing without consent.
   - If invoked with **`--approve`** (the opt-in apply path): create the ADR in
     sequence without the approval gate — `node contextkit/tools/scripts/adr-digest.mjs
     --search` for duplicates first, then write the next ADR, then generate its
     backlog with `adr-tasks.mjs <NNNN> --write` per [ADR-0034].
   - Either way, link the ADR back to this debate via `[[deliberation: <slug>]]` in
     its Context, and set the deliberation's `Feeds:` to the ADR id.

Keep the whole exchange tight — a deliberation is a fast, technical convergence, not
an essay. The value is the independent disagreement, not the word count.
