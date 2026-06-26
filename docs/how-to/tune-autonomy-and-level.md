# How to tune autonomy and level

<!-- GENRE: How-to guide (task-oriented)
     Goal: reader adjusts how much the AI may do without asking (grade) and which
           kit capabilities are active (level).
     Voice: direct, imperative — assume competence, skip "what is X" explanations. -->

## When to use this guide

You want to change how much the AI acts on its own (consent grade 1–4), or you want
to enable or disable a tier of kit capabilities (level 1–7). These are two independent
dials — grade controls consent; level controls capability.

## Prerequisites

- ContextDevKit installed in the project.
- `node` 18+ available on the path.
- For grade 4: at least 30 pipeline transitions, 20 sessions, clean wiring, and green
  self-coverage (measured by `autonomy-readiness.mjs`).

## Steps

### Check the current grade

1. Show the current consent grade and what each grade means.

   ```shell
   node contextkit/tools/scripts/autonomy.mjs
   ```

   The script outputs a first-person consequence block for each grade. Read it in
   full before changing anything.

### Change the consent grade

Grade semantics:
- **1** — manual: every action requires explicit approval.
- **2** — suggest and supervise: the AI proposes; you approve each step.
- **3** — auto except decisions (default): ADRs, pushes, high-risk and secret paths
  always come to the user.
- **4** — full-auto, experimental: gated by an eligibility bar; session-scoped by
  default.

2. Set grade 2 or 3.

   ```shell
   node contextkit/tools/scripts/autonomy.mjs 3
   ```

   To apply for this session only and have it expire automatically after 8 hours:

   ```shell
   node contextkit/tools/scripts/autonomy.mjs 3 --session
   ```

3. Clear a session override and return to the persisted grade.

   ```shell
   node contextkit/tools/scripts/autonomy.mjs --clear
   ```

4. Attempt grade 4 (experimental).

   Grade 4 runs the eligibility bar first. If any criterion fails, the script refuses
   and names the failing criterion. Run it and relay the output verbatim:

   ```shell
   node contextkit/tools/scripts/autonomy.mjs 4
   ```

   This is session-scoped by default. To persist after seeing the consequence
   disclaimer and explicitly confirming:

   ```shell
   node contextkit/tools/scripts/autonomy.mjs 4 --persist --confirm
   ```

   If the bar cites self-coverage or attribution as the blocker, measure them first:

   ```shell
   node contextkit/tools/scripts/autonomy-readiness.mjs
   ```

   This command is expensive — it measures self-coverage and attribution across the
   project. Run it only when prompted.

### Non-negotiable floor (all grades)

At every grade the following actions remain manual and no config removes them:
- Secret-bearing paths.
- Gate and hook self-edits.
- Force-push.
- ADR-class decisions.
- Grade escalation itself.

### Check the current level

5. Show the current capability level and what each level enables.

   ```shell
   node contextkit/tools/scripts/context-level.mjs
   ```

### Change the capability level

6. Set a new level.

   ```shell
   node contextkit/tools/scripts/context-level.mjs <1-7>
   ```

   Level reference:
   - **1** Memory: CLAUDE.md + session log.
   - **2** Ledger: drift detection.
   - **3** Multi-session: git hooks, conventional commits.
   - **4** Squads: specialist agents.
   - **5** Proactive: L5 gates and contract checks.
   - **6** Autonomy and Insight: economy runtime, model routing.
   - **7** Ecosystem and Scale: fleet coordination.

   Going up adds capability. Going down cleanly removes the now-disabled hooks.

7. Restart Claude Code.

   The command updates `contextkit/config.json` and recomposes `.claude/settings.json`
   hook wiring. A restart is required for the new hooks to take effect.

## Verify it worked

- `node contextkit/tools/scripts/autonomy.mjs` shows the new grade.
- `node contextkit/tools/scripts/context-level.mjs` shows the new level.
- After a Claude Code restart, the boot banner reflects the active level and grade.

## Troubleshooting

**Symptom:** Grade 4 refuses silently and shows only "eligibility bar not met."
Fix: Run `autonomy-readiness.mjs` to find which criteria are failing. The script names
each criterion and its current status. Fix the specific gap (e.g., register more
sessions with `/log-session`).

**Symptom:** The level was changed but hooks still behave as if the old level is
active.
Fix: You need to restart Claude Code. The hook wiring in `.claude/settings.json` is
only read at startup.

**Symptom:** A config file with `autonomy.level` (not `autonomy.grade`) silently falls
to the default grade without a warning.
Fix: This is a known UX gap. Rename the key to `autonomy.grade` in
`contextkit/config.json`.

## Related

- [`/dev-start`](start-a-focused-session.md) — the session where grade 3+ has the most
  visible effect.
- [`/context-config`](../reference/skills.md) — inspect and validate the full config schema.
- [`/context-doctor`](../reference/skills.md) — diagnose hook wiring problems after a level change.
