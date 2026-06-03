---
description: L5 — analyze recent sessions and propose refinements to CLAUDE.md (writes a proposal, applies nothing).
---

# 🧬 Distill sessions (propose)

Analyze the recent session history and propose improvements to `CLAUDE.md` — but
**apply nothing**. This is the review step; `/distill-apply` materializes it.

1. Get a **compact digest** of the last N sessions instead of reading the raw
   logs [ADR-0027]: `node contextkit/tools/scripts/session-digest.mjs --last N`
   (N from `contextkit/config.json` → `l5.distill.observeWindow`, default 10),
   newest first. Reason over the digests; open a full file in
   `contextkit/memory/sessions/` only when a digest flags a pattern you must
   inspect verbatim.
2. Look for **recurring signals**: corrections the user gave repeatedly, rules
   re-explained across sessions, conventions that emerged but aren't written
   down, friction that a CLAUDE.md rule would prevent, and decisions that should
   be promoted to an ADR.
3. Draft a concrete diff to `CLAUDE.md` (and note any ADRs worth creating).
   Prefer small, high-signal additions over bloat — CLAUDE.md must stay short.
4. Write the proposal to `.distillation-proposal.md` (gitignored) with: the
   evidence (which sessions, what pattern), the proposed CLAUDE.md edits as a
   clear before/after, and any suggested ADRs.
5. Summarize to the user and tell them to review it, then run `/distill-apply` to
   commit the change. Do not edit `CLAUDE.md` in this command.
