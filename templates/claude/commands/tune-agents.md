---
description: L6 — propose outcome-driven refinements to agent briefings (writes a proposal, applies nothing). Mirrors /distill-sessions.
---

# 🎯 Tune agents (propose)

Refine the squad's **agent briefings** from how they actually performed — but
**apply nothing**. This is the review step (like `/distill-sessions` for `CLAUDE.md`);
you apply the edits with your own OK.

1. **Signals** (deterministic):
   ```
   node contextkit/tools/scripts/agent-tuning.mjs --json
   ```
   Gives the roster, tier-2 briefing coverage, and per-agent mention counts across
   the session history (a usage proxy).

2. **Outcomes** (judgment): read the recent session files + the DevPipeline
   (`/pipeline`, the known-bugs map, ingested findings) and look, per agent, for:
   - **false positives** it keeps raising → add a "don't flag X" note to dampen them,
   - **blind spots** — real issues it missed that sit squarely in its lane → add an
     anti-pattern row,
   - **routing friction** — work that landed on the wrong agent → sharpen the
     `description` (that's what routing keys on).

3. **Draft** concrete briefing edits to `contextkit/squads/<team>/<agent>.md` (scaffold
   a missing briefing first: `node contextkit/tools/scripts/squad.mjs brief <agent>`).
   Prefer small, high-signal additions — briefings stay sharp, not bloated.

4. **Write the proposal** to `.agent-tuning-proposal.md` (gitignored): the evidence
   (which sessions/findings, what pattern), per-agent **before/after** edits, and any
   agent that needs a new briefing. **Apply nothing in this command.**

5. Summarize to the user and tell them to review it, then apply the edits with their
   OK (or re-run after a batch of work). Do not edit agent briefings here.
