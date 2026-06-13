---
description: L6 — learning loop. Turn recurring drift/debt/patterns from recent work into concrete governance (rules + ADRs).
---

# 🔁 Retro (learning loop)

Look back at recent work and convert repeated friction into durable improvements
to how this project is built. Output proposals — apply only with the user's OK.

1. **Gather signal:**
   - `node contextkit/tools/scripts/stats.mjs --json` (drift rate, cadence).
   - `node contextkit/tools/scripts/tech-debt-scan.mjs --json` (recurring smells).
   - The last ~10 sessions as a **compact digest** [ADR-0027]:
     `node contextkit/tools/scripts/session-digest.mjs --last 10` (corrections the
     user repeated, conventions that emerged, decisions made informally) — open a
     full log only when a digest flags something to inspect.
   - `git log` since the last few sessions (what actually changed).
   - **Advisor outcomes** [ADR-0032]: `node contextkit/tools/scripts/advise-review.mjs`
     — per-lane hit-rate of `/advise` findings (acted-on vs still-open). A lane with
     many open + low hit-rate is a pattern: either the owner is noisy (tune it down)
     or the lane is under-served (schedule the work).

2. **Find patterns**, not one-offs: the same correction 3×, a debt category that
   keeps growing, a rule that's implied but unwritten, a decision never recorded.

3. **Propose concrete governance:**
   - **CLAUDE.md edits** — a new immutable rule or convention (keep it lean).
     This overlaps with `/distill-sessions`; reuse it for the CLAUDE.md diff.
     **Deprecate by strikethrough, never delete** [ADR-0065]: when a rule is
     superseded, mark the old line `~~old rule~~ — deprecated: <reason>. Use <new>.`
     instead of removing it, so the *why* of the change stays in history. Standards
     are living, not a graveyard — only prune a struck-through rule much later,
     once it's clearly fossilized.
   - **New ADRs** — for decisions that were made but never written down.
   - **Config tweaks** — e.g. add a path to `l5.highRiskPaths` or
     `qa.criticalPaths` that keeps breaking.
   - **Habit nudges** — e.g. "drift rate 40% → register sessions".

4. Present the proposals ranked by impact. On approval, apply via `/distill-apply`
   (CLAUDE.md + ADR in one commit) and `/context-config` (config), then `/log-session`.

The point: the platform should get *smarter about this project* over time, not
just enforce static rules.
