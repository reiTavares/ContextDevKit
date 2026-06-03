# Playbook — `/simulate-impact`

> Operational spec: [`.claude/commands/simulate-impact.md`](../../../.claude/commands/simulate-impact.md).
> This page explains **why** it exists, **when** to fire it, **how to read the
> report**, and the common **anti-patterns**.

## Why it exists

Three frictions motivated L5:
1. High-blast-radius changes land **silently** without prior analysis.
2. "Architecture before syntax" is a posture; a posture with no executable mechanism
   becomes drift.
3. The squad was used in **serial** delegation — `/simulate-impact` is the first
   feature to exploit **parallelism**, multiplying the squad's ROI.

## When to fire it

Use it when the objective crosses **≥ 2** high-risk surfaces, e.g.:
- a data-model / schema change;
- a change to a shared type or validation schema;
- a change to a public route/endpoint signature;
- the auth or crypto surface;
- a new service/module on a critical path;
- direct implementation of an accepted ADR.

**When NOT to** (it wastes tokens):
- a bug fix with the root cause already mapped (use `/bug-hunt`);
- a refactor with scope locked by `/dev-start`;
- a cosmetic / i18n / comment / internal-rename change.

## How to read the Blast Radius Report

- **`Risk overall`** = `max(per-agent risks)`, not the average. If **High**, do not
  proceed without understanding *which* agent said High and why.
- **`Affected paths (union)`** becomes `coveredPaths` in the ledger. The PreToolUse
  gate authorizes edits against this set — **if a path isn't listed, the gate blocks
  the edit** on high-risk paths. If the simulation missed a critical path, re-run
  with a refined objective.
- **`Per sub-agent`** — each speaks from its own view. **Disagreement is the
  signal** — don't reconcile it mentally. (The data agent says "trivial"; the QA
  agent says "no fixture exists" → the real risk is in tests, not the schema.)
- **`Mitigations`** — each needs an owner: a feature TODO, a new ADR, or an explicit
  discard.
- **`Decision required`** — Proceed (with mitigations), Defer (too big without an
  ADR), or Abort (mis-scoped — re-scope).

## Prediction-file lifecycle

```
/simulate-impact "<obj>"  → contextkit/memory/predictions/<date>-<sid>-<slug>.md  (pending, coveredPaths)
implementation in the same session (or discard)
/predictions-review       → fills "Actual": paths changed, delta vs predicted, risk note
       (auto-run by /log-session at session end)
```
This corpus calibrates future simulations.

## Anti-patterns

1. **Firing to validate a decision already made.** It's a search for disagreement,
   not an approval checklist. If you already know the answer, you're burning tokens.
2. **Implementing before showing the report.** L5 requires an explicit user decision
   among the three outcomes.
3. **Ignoring disagreement ("5 said Low, 1 said High → Low").** Risk is max, not
   average; the lone High *is* the signal.
4. **Running without reading active ADRs first.** Sub-agents get the objective + a
   domain briefing, not the full project state — anchoring in ADRs is step 1.
5. **Forgetting to mark the ledger.** Without `mark-simulation.mjs`, the PreToolUse
   gate blocks the next edit. It's part of the contract, not cosmetic.

## Calibration over time

After 10+ predictions with "Predicted vs Actual" filled in, look for systematic
patterns (an agent that underestimates risk; a path that's always collateral but
actually central). Refine the command's prompts; if the pattern is architectural,
make it an ADR.

## Relation to other L5 components

- **PreToolUse gate** — reads the ledger's `simulations[]`; no simulation on a
  high-risk path → it blocks.
- **`/tech-debt-sweep`** — independent; neither requires nor produces simulations.
- **Contract-drift gate** — independent; may flag the very change the simulation
  predicted.
