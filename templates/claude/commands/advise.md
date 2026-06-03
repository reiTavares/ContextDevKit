---
description: Proactive Advisor — one classified, six-lane improvement scan (architecture · features · deepen · security · UX · growth), before or after a change.
argument-hint: [--before <objective> | --after] [--lane <id>]
---

# 🧭 Advise — the proactive, six-lane improvement engine

Aggregate the project's analysis lanes into **one classified digest** and feed the
backlog — *proactively*, so improvements surface instead of waiting to be asked for.
This command **orchestrates**; it does not re-implement the lanes (it delegates to
the owning agents/commands) and it does not write code (it's analysis).

## Modes (read `$ARGUMENTS`)

- **`--after`** *(default)* — you just finished an implementation/adjustment. Frame
  each lane as **improvements**: what to refine now that the change exists. Scope to
  the **changed surface** first (`git diff --name-only` vs the branch base), widening
  only if a lane needs project context.
- **`--before <objective>`** — you're about to start. Frame each lane as
  **opportunities + risks**: what the planned work unlocks and what it endangers.
  This is the "predict errors / analyze possibilities" pass; pairs with
  `/simulate-impact` for the high-risk-path blast radius.
- **`--lane <id>`** — restrict to one lane (`architecture` | `features` | `deepen` |
  `security` | `ux` | `growth`) to keep a run cheap.

## Steps

1. **Load the taxonomy** from config (`advisor.lanes` in `vibekit/config.json`,
   defaults in `runtime/config/defaults.mjs`). Each lane carries an `owner`. Honor
   `advisor.active`; if `false`, say so and stop. Note the level — the fan-out needs
   the squad (Level ≥ 4).

2. **Fan out to each ACTIVE, OWNED lane in parallel** (Agent tool), giving each the
   right lens for the mode. Reuse the existing surfaces — don't duplicate them:

   | Lane | Owner | Delegates to / reuses | Lens |
   | --- | --- | --- | --- |
   | `architecture` | `architect` | `/analyze-code-ia-practices`, `/tech-debt-sweep` | Stack/code/tech: design risks, SRP, layering, the next pattern to adopt |
   | `features` | `product-owner` | `/roadmap` | New features the project/codebase makes natural and valuable |
   | `deepen` | _(seam)_ | — | Depth on the **best existing** features (power-user paths, edge coverage) |
   | `security` | `security` | `/deep-analysis` (security pass), `/deps-audit` | Vulnerabilities, secrets, trust boundaries, supply chain |
   | `ux` | `ux-designer` | design-team (`ui-designer`, `accessibility`) | Friction, empty/error states, IA, a11y |
   | `growth` | _(seam)_ | `seo-specialist` covers **acquisition** only | Retention, activation, funnels, growth loops, instrumentation |

3. **Skip unowned lanes honestly (rule 8).** A lane whose `owner` is `null` is
   printed as **`skipped — no owner`** with the fix
   (`run /squad new-squad growth-team`, or assign `advisor.lanes.<id>.owner` via
   `/vibe-config`). **Never** fabricate findings for a lane that has no owner — a
   skip is a skip, never a false pass. Today `deepen` and `growth` are the two seams.

4. **Emit ONE report, grouped by lane.** For each owned lane: the top findings,
   each as `impact (🔴/🟡/🟢) — what — why now — proposed action`. Lead with the
   single highest-leverage item across all lanes. Keep it factual; silence in a lane
   is a valid result.

5. **Feed the DevPipeline backlog** — every surviving finding becomes a tracked,
   auto-prioritized task, tagged by lane so re-runs stay idempotent:
   ```
   node vibekit/tools/scripts/pipeline.mjs add --type chore \
     --source "advise:<lane>" --title "<lane>: <finding>"
   ```
   then `pipeline.mjs sync`. Security findings → `--type bug --severity S1-S4`.
   Priorities stay user-editable (`pipeline.mjs prioritize <id> <P>` / `/pipeline`).

6. **End with the next step, don't take it.** Offer
   `/dev-start "<top finding>"` (or `/ship`) on the highest-leverage item. A finding
   that implies an architectural decision → draft `/new-adr` first. This command
   **never edits code**.

## Notes

- **Proactive by default.** The Stop hook nudges `/advise` after a productive
  session (`advisor.nudgeOnStop`, debounced 24h) — this is the "after each
  implementation" trigger. Disable via `advisor.active: false`.
- **Cost.** A full six-lane fan-out is token-heavy; prefer `--lane <id>` or the
  changed-surface scope of `--after`. `--before` is naturally narrow (one objective).
- **Adjacent, not a replacement.** `/deep-analysis` is the deep four-lane
  (code/security/deps/bugs) sweep; `/advise` is the broader, lighter, *classified*
  six-lane view that also covers features, UX, and growth, and runs before/after a
  single change.
