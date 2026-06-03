---
description: L5 pre-flight — map the blast radius of a change BEFORE editing high-risk paths.
argument-hint: <one-sentence objective>
---

# 🔮 Simulate Impact

Objective: **$ARGUMENTS**

Produce a **Blast Radius Report** before any Edit/Write on high-risk paths.

1. **Identify what the change touches.** List the concrete files/dirs you expect to modify. Cross-
   reference `contextkit/config.json` → `l5.highRiskPaths` to see which are gated.

2. **Map the blast radius.** For each touched area, reason about downstream effects: public
   contracts/exports, API/route signatures, data schema, auth surface, shared types, anything that
   other modules or external consumers depend on. If agents are installed (Level 4), delegate
   focused sub-analyses to the relevant specialists in parallel and consolidate.

3. **Write the report** to `contextkit/memory/predictions/<YYYY-MM-DD>-<slug>.md` with: objective,
   files in scope, downstream risks, suggested order of changes, and a rollback note.

4. **Authorize the edits** by recording the simulation on the ledger (this unblocks the L5 gate):
   ```
   node contextkit/tools/scripts/mark-simulation.mjs "$ARGUMENTS" <covered-path-or-dir/> [more ...]
   ```
   Use trailing slashes for directory coverage (e.g. `src/services/`).

5. Summarize the report to the user and proceed with the change in the suggested order.

For a genuinely trivial edit (typo/comment) on a gated path, record an explicit bypass instead:
`node contextkit/tools/scripts/mark-simulation.mjs "BYPASS: <reason>" <path>`.
