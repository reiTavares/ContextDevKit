---
description: Open a multi-agent deliberation — a council of specialist voices debate a hard question with tiered research, a synthesizer converges, the result feeds an ADR. (ADR-0035 / ADR-0070)
argument-hint: <question to deliberate> [--approve]
---

Run a **deliberation** on: **$ARGUMENTS**

A deliberation is PRE-DECISION working material (ADR-0035): a council of genuinely
independent SPECIALIST voices argues a hard question, a separate synthesizer
converges, and the result feeds an ADR's Context. It is NOT the canonical record of
the *why* — the ADR is. This is a strategic, intelligent debate, not an essay.

0. **Gate.** Read `deliberations` from `contextkit/config.json` (fall back to
   `runtime/config/defaults.mjs`). If `active` is `false`, stop and say so. The
   `minLevel` gate only governs the *automatic* nudge — an explicit `/debate` always
   runs when `active`. (Auto-invocation from `/workflow`, `/new-adr` and `/ship`
   resolves through the autonomy areas `feature-deliberation` /
   `decision-deliberation` / `ship-checkpoint` — debate mode at grade ≥ 3, ADR-0070.)

1. **Frame the question.** Restate `$ARGUMENTS` as a single decision question with
   just enough context for an independent reader to take a side. If it's too vague
   to debate (no real tension, or several questions tangled), ask one clarifying
   question before spending agent calls.

2. **Plan the council.** Run
   `node contextkit/tools/scripts/deliberation-council.mjs plan --question "<the question>" --json`.
   It returns the **specialist roster** (relevant advisor-lane owners — e.g.
   `architect`, `security`, `ux-designer` — scaled `council.min..max` by the
   question, ADR-0070) and the **tiered research plan** (scout / verify / voice
   models). Use this roster instead of anonymous "Voice A/B/C". If `autoSelect` is
   off, the plan returns N generic positions — fall back to the legacy flat debate.

3. **Gather evidence (cheap scouts).** If `research.tiered`, FIRST run
   `node contextkit/tools/scripts/context-pack.mjs --for-subagent --objective "<the question>"`
   for the bounded boot pack (ADR-0044 D1). Then dispatch **scout** sub-agents at the
   `research.scouts` model (Haiku/`fast`) IN PARALLEL — one per concrete fact the
   debate needs (existing patterns, current behaviour, a config value, a prior ADR).
   Each scout reads at most a couple of files and returns one verifiable fact with
   its source (`file:line` / command output). Collect these into an **evidence pack**.
   The point is economy: the reasoning voices spend premium tokens on judgment, not
   lookups. Skip only when the question is purely abstract.

4. **Fan out to the council (reasoning voices).** Dispatch one sub-agent **per
   council member** with the Task tool, IN PARALLEL, each at the `research.voices`
   model (Opus/`reasoning` — voices are NEVER downgraded, ADR-0052) and
   **blind to the others' arguments** — independence is the whole point (ADR-0035). Embed the
   context-pack + the evidence pack at the top of every voice prompt. Each voice
   argues from its **specialist lens** (the `agent`/`lane` from the plan), takes ONE
   distinct position on a genuinely different axis (correctness vs. cost vs.
   reversibility/blast-radius vs. UX vs. security), and returns its strongest
   one-paragraph case + the trade-off it accepts. CONCISE, OBJECTIVE, HIGHLY TECHNICAL.

5. **Verify the hard claims (powerful tier, optional).** If a position rests on a
   claim that needs checking in a larger context than a scout can hold, dispatch a
   verifier at the `research.verify` model (Sonnet/`powerful`) to confirm or refute
   it. Fold the verdict into the synthesis — never let an unverified claim decide.

6. **Synthesize (you, not the voices).** You are the orchestrator (reasoning tier) —
   you argued no position, so you declare the outcome. Weigh the cases: which wins on
   which axis, what each loser contributes, the decisive trade-off. Then either:
   - **Consensus** → a clear verdict, OR
   - **`unresolved`** → record the positions + the unresolved tension as the
     trade-off the human must break. A VALID outcome, not a failure. Do not
     manufacture agreement to look decisive.

7. **Write the artifact.** Copy `contextkit/memory/deliberations/_TEMPLATE.md` to
   `contextkit/memory/deliberations/<YYYY-MM-DD>-<NN>-<kebab-slug>.md` (`NN` = highest
   existing + 1, zero-padded; start at `01`). Fill Question / **Evidence** / Positions
   (one `### <agent> — <label>` per council member) / Synthesis / Verdict; set
   `Trigger`, `Council` (roster + count) and `Status: resolved | unresolved`. Then
   refresh the index: `node contextkit/tools/scripts/deliberations-reindex.mjs`.

8. **Feed an ADR.**
   - If `unresolved`: offer NO ADR — the tension is the deliverable. Suggest the
     human break it or re-run `/debate` with more context.
   - If `resolved` (default, dry-run): assemble a PRE-FILLED `/new-adr` draft
     (Context = the Synthesis, Decision = the Verdict, Consequences = the trade-offs
     raised) and present it for approval. Write nothing without consent — the ADR
     write is a floor area (`manual` at every grade, ADR-0042/0070), even when the
     deliberation was auto-invoked.
   - If invoked with **`--approve`** (the opt-in apply path): create the ADR in
     sequence — `node contextkit/tools/scripts/adr-digest.mjs --search` for duplicates
     first, then write the next ADR, then generate its backlog with
     `adr-tasks.mjs <NNNN> --write` per [ADR-0034].
   - Either way, link the ADR back to this debate via `[[deliberation: <slug>]]` in
     its Context, and set the deliberation's `Feeds:` to the ADR id.

Keep the whole exchange tight — a deliberation is a fast, technical convergence, not
an essay. The value is the independent specialist disagreement, not the word count.
