---
description: Manual premium tier (ADR-0052) — run ONE task on Claude Fable 5, the deliberately expensive/limited model. Explicit-only; never automatic.
argument-hint: <the task to run on Fable>
---

# 🎩 /fable — the manual premium tier (ADR-0052, Phase 2)

Run **`$ARGUMENTS`** on **Claude Fable 5** — the premium model the automatic tier
ladder never reaches. ADR-0052 caps auto-escalation at `opus`; **Fable is the
manual hatch ABOVE that ceiling**, for the rare task that justifies the cost: a
genuinely hard design, a subtle root-cause, a high-stakes review.

**Manual-only by construction.** No agent declares `model: fable` (the selfcheck
forbids it), and nothing auto-routes here — Fable runs ONLY when you type `/fable`
(or literally ask for "fable / modo fable"). The mode does **not** persist: it
covers this one task, then everything returns to the normal tiers.

## How you (the agent) run it

1. **Acknowledge the cost, once.** State plainly: _"Running this on Fable 5
   (premium tier) — one task, then back to normal."_ Scope strictly to
   `$ARGUMENTS`; do not pad it with extra work to "make the most of" Fable.
2. **Dispatch to a Fable subagent.** Delegate `$ARGUMENTS` via the Agent tool with
   `model: fable`. The premium model runs in the **subagent, not the main loop** —
   your session stays on its own model (cache-safe, the ADR-0052 invariant). Give
   the subagent the focused task + just enough context to do it well.
3. **Relay the result** and note that Fable was used, so the cost is on the record.
4. **Return to normal.** The next task uses the standard tiers again.

If the user wants Fable for **their own main conversation** (not a delegated
subagent), point them to the Claude Code model picker (`/model` → Fable 5) — that
switch is theirs to make, not yours.

## Guard-rails (non-negotiable)

- **Never invoke Fable on your own initiative.** Only an explicit `/fable` (or the
  user literally saying "use fable") activates it. It is the most expensive tier;
  the default is always NOT Fable. When unsure, ask — don't spend.
- **One task per invocation.** No batching, no lingering in "fable mode."
- **The floor still holds.** Secret paths, gate/hook self-edits, ADR/grade changes
  and pushes remain governed by the autonomy resolver (ADR-0042) — a premium model
  does not buy more consent, only more capability on the one task.
