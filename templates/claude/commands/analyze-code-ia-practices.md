---
description: Review the codebase against the best-practices doc and propose INTELLIGENT refactors (not random splits).
argument-hint: [path or area to focus]
---

# 🧠 Analyze code — IA best practices

Audit the codebase (focus: **$ARGUMENTS** if given, else the whole repo) against
`vibekit/best-practices.md` and propose improvements with engineering judgment.

1. **Read the rubric**: `vibekit/best-practices.md` (and the constitution in
   `CLAUDE.md`). Use the project's `l5.lineBudget` thresholds.
2. **Run the deterministic scan** for candidates:
   ```
   node vibekit/tools/scripts/tech-debt-scan.mjs --json
   ```
   This surfaces oversized files, SRP "And/Or/E" names, missing-doc and React
   state-loops — the mechanical signal.
3. **Apply judgment the regex can't.** For each flagged (or otherwise smelly)
   file, decide the *right* fix and propose a **specific, intelligent refactor**:
   - Oversized file → name the responsibilities to extract (a hook, a service, a
     sub-component, a mapper) and where each goes. **Never** propose "split into
     two random files because it's long."
   - Leaked business logic → move it to the service/use-case layer.
   - Complex component state → extract a custom hook.
   - Big `renderX()` → promote to a real component.
   - Genuinely cohesive long file → say "leave it, document the cohesion" rather
     than force a split.
4. **Output** a ranked plan (the report): per file → the smell, the recommended
   refactor (concrete: new files + what moves), and effort (S/M/L). Top 5 first.
5. **Feed the DevPipeline backlog** — add each item as a task, **auto-prioritized**
   (blocker→P0, high/RED→P1, medium→P2, nit→P3):
   ```
   node vibekit/tools/scripts/pipeline.mjs add --type chore --priority <P> \
     --source "practices:<file>" --title "refactor <file> by responsibility"
   ```
   `--source` keeps re-runs idempotent; then `pipeline.mjs sync`. Priorities are
   **always editable** by the user (`pipeline.mjs prioritize <id> <P>` or `/pipeline`).
6. Do **not** refactor in this command — it's analysis. Offer to open a focused
   `/dev-start "refactor <file> by responsibility"` (or `/ship`) on the top item.

If best-practices aren't active yet, ask the user whether to adopt them (set
`practices.active = true` via `/vibe-config` and fill the `CLAUDE.md` constitution).
