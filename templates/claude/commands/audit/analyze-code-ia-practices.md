---
description: Review the codebase against the best-practices rubric and propose INTELLIGENT refactors (not random splits).
argument-hint: [path or area to focus]
---

# 🧠 Analyze code — IA best practices

Audit the codebase (focus: **$ARGUMENTS** if given, else the whole repo) against
the rubric and propose improvements with engineering judgment.

1. **Read both rubric files** + the constitution:
   - `contextkit/best-practices.md` — *the rubric* (Tier 1 system &
     architecture; Tier 2 module & function hygiene; the four-block
     Principle / Smells / Fix / Don't over-apply per rule).
   - `contextkit/review-protocol.md` — *the protocol* (severity vocabulary
     anchored on scanner sev 1..5; scope / spike relaxations; report shape;
     scanner-vs-agent contract).
   - `CLAUDE.md` constitution (especially §1 line budget, §2 SRP, §3 layers).
   - `contextkit/config.json → l5.lineBudget` for the project's thresholds.
2. **Run the deterministic scan:**
   ```
   node contextkit/tools/scripts/tech-debt-scan.mjs --json
   ```
   The scanner emits findings on a 1..5 severity scale from four detectors:
   `line-budget` (sev 3/5), `srp-and` (sev 2 — JS `And`/`Or`/`E`, Python
   `_and_`/`_or_`), `react-state-loop` (sev 3 — React/JSX only,
   `> 2 useState + ≥ 1 useEffect`), `todo-marker` (sev 1 — `TODO`/`FIXME`/
   `HACK`/`XXX`). Custom detectors auto-load from `contextkit/detectors/*.mjs`.
   That is the *floor* of the report, not the ceiling.
3. **Apply judgment the regex can't — in tier order:**
   - **Tier 1 first** (architecture, no scanner help): does the domain
     depend on infrastructure (S1)? Are module boundaries respected (S2)?
     Any import cycles or god modules (S3)? Where does state live, and
     does it live once (S4)?
   - **Tier 2 next** (hygiene): walk the scanner findings. For each file,
     decide the *right* fix per H1's preference list:
     - Oversized file → name the responsibilities to extract (a hook, a
       service, a sub-component, a mapper) and where each goes. **Never**
       propose "split into two random files because it's long."
     - Leaked business logic in a transport handler → move it to the
       service/use-case layer.
     - Complex component state (`> 2 useState + ≥ 1 effect`) → extract a
       custom hook.
     - Big `renderX()` → promote to a real component.
     - Genuinely cohesive long file (a flat DTO/constants/types file) →
       say "leave it, document the cohesion in a header comment" rather
       than force a split.
   - **Honor each rule's "Don't over-apply" clause.** Manufactured findings
     cost more trust than they save. Silence is a valid result.
4. **Route adjacent concerns out, don't smuggle them in.** Security, a11y,
   privacy, and dependency/supply-chain are owned by other agents/commands
   (see *Adjacent concerns* at the foot of `best-practices.md`). If you
   spot one during the pass, name it briefly and dispatch the relevant
   agent/command — don't expand this command's lane.
5. **Output** a ranked report grouped by file. Each finding:
   ```
   path:line — TIER/§ID — SEVERITY — what's wrong — proposed fix
   ```
   Sort by tier (1 → 2), then severity (BLOCKER → NIT), then blast radius.
   Top 5 first; the rest below.
6. **Feed the DevPipeline backlog** — add each surviving item as a task,
   **auto-prioritised** (BLOCKER→P0, HARD→P1, CANDIDATE→P2, NIT→P3):
   ```
   node contextkit/tools/scripts/pipeline.mjs add --type chore --priority <P> \
     --source "practices:<file>" --title "refactor <file> by responsibility"
   ```
   `--source` keeps re-runs idempotent; then `pipeline.mjs sync`. Priorities
   stay editable (`pipeline.mjs prioritize <id> <P>` or `/pipeline`).
7. **Do not refactor in this command** — it's analysis. Offer to open a
   focused `/dev-start "refactor <file> by responsibility"` (or `/ship`)
   on the top item.

If best-practices aren't active yet, ask the user whether to adopt them
(set `practices.active = true` via `/context-config` and fill the `CLAUDE.md`
constitution).
