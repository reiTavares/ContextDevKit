---
description: Audit the codebase against the constitution — deterministic scan + your interpretation.
argument-hint: [profile: full | quick]
---

# 🧹 Tech Debt Sweep

Run the **deterministic scanner** first, then interpret. Profile: **$ARGUMENTS**
(default `full`; `quick` = red zone only).

1. Run the scanner and write the board:
   ```
   node contextkit/tools/scripts/tech-debt-scan.mjs --write          # full
   node contextkit/tools/scripts/tech-debt-scan.mjs --write --quick   # red zone only
   ```
   It checks: file length vs `l5.lineBudget`, SRP "And/Or/E" names, TODO/FIXME
   markers, and React state-loops — and writes `contextkit/memory/tech-debt-board.md`.

2. **Interpret** the board with judgment the regex can't: which findings are real
   debt vs acceptable cohesion? Which oversized file genuinely hides multiple
   responsibilities? Add any smells the scanner can't see (leaky abstractions,
   duplicated logic, missing error handling) — referencing `CLAUDE.md`.

3. **Report + hand off.** Surface the **top 5** with the one-line fix each — the
   board `contextkit/memory/tech-debt-board.md` is the full report. Do NOT fix here.
   Create no task automatically. Offer to open a focused, explicitly scoped
   `/dev-start` on the worst accepted finding.
