# Skill: setupcontextdevkit

> One-shot intelligent onboarding — inspects the project and self-configures ContextDevKit to it.
> Argument: [target level 1-7]
# 🚀 Setup ContextDevKit

You are running the **self-configuring onboarding**. Goal: make this project's
ContextDevKit setup *at least as rich as a hand-tuned one* — adapted to THIS
project's stack, structure, and domain. Be thorough, infer aggressively, ask
only the few questions that genuinely need a human, and **never break the
project**. Confirm before any command that installs packages or changes the
environment.

Work through these phases in order. Use task.md artifact (or equivalent tracking) to track them.

## Phase 1 — Inspect
1. Run `node contextkit/tools/scripts/detect-stack.mjs` and parse the JSON report
   (languages, package manager, frameworks, monorepo, source dirs, suggested
   `ledger` + `highRiskPaths`, README summary, greenfield flag).
2. Read `README*`, the existing `CLAUDE.md`, and skim the top-level structure to
   understand what the project *is* and its domain language.
3. If it's **greenfield** (no source yet), say so — onboarding will set up
   conventions and defer stack specifics to the first `/new-adr`.

## Phase 2 — Ask only what you can't infer
Ask the user (batch into one short round, offer inferred defaults):
- A one-sentence description of the project + its audience.
- The **language for user-facing UI text** (code stays English; this is for
  visible strings) — infer from README if obvious.
- 1–3 **immutable rules** to enforce (propose candidates from the detected
  stack, e.g. "never introduce <competing tech>", "all DB access via <layer>").
- The **target level** (use `<user-specified argument>` if provided; else recommend based on
  the report — L2 for most, L1 for greenfield, L4/L5 if the codebase is large or
  has clear high-risk areas).
- The **autonomy grade** (exactly ONE question, ADR-0041/0042/0058 — phrase the
  options as consequences, not numbers; preselect grade 3): "How much may I do
  without asking? (1) only what you command · (2) I suggest, you approve ·
  (3) I edit and test on my own; decisions still come to you — recommended ·
  (4) experimental full-auto." Apply with
  `node contextkit/tools/scripts/autonomy.mjs <N>` — never preselect 4.

## Phase 3 — Apply configuration
1. Tune the ledger + high-risk paths to this stack in one step (this also flips
   the first-run flag off at the end):
   ```
   node contextkit/tools/scripts/setup-complete.mjs --detect
   ```
   Then review `contextkit/config.json` and refine `ledger.important` /
   `l5.highRiskPaths` by hand if the heuristics missed something.
2. Set the chosen level: `node contextkit/tools/scripts/context-level.mjs <N>`
   (this rewires `.claude/settings.json` and installs git hooks at L≥3).

## Phase 4 — Fill in CLAUDE.md
Edit `CLAUDE.md` (or merge `CLAUDE.contextdevkit.md` if the installer left one):
- "What this is" — the description from Phase 2.
- "Stack" — the concrete detected stack (languages, frameworks, package manager).
- "Immutable rules" — the rules from Phase 2; link an ADR for each big one.
- "Language policy" — set the UI language row.
- Keep it under ~200 lines. Push detail into ADRs.

**Curated-stack rules.** When the detect report contains any `@tanstack/*`
framework, inherit the conventions block from
`contextkit/workflows/playbooks/tanstack.md` (the "Core conventions" section)
into the project's `CLAUDE.md` under "Stack" or "Immutable rules". Cite the
playbook + ADR-0017. Do **not** copy the opt-in starter — `/setupcontextdevkit`
detects and writes rules; the starter is `/aidevtool-from0`-only.

## Phase 4b — Scoped CLAUDE.md per app/module
Run `node contextkit/tools/scripts/claude-md.mjs find`. For a multi-app/monorepo
project, ensure **each app/module has its own CLAUDE.md** (backend, frontend,
each package/service): `claude-md.mjs scaffold`, then **fill each** with real
local rules (role, local stack, local conventions, boundaries) via `/claude-md`.
Single-package project → the root CLAUDE.md is enough; skip.

## Phase 5 — Glossary, business rules & squads (sub-agents)
- Add any clear domain terms (from README/code) to `contextkit/memory/GLOSSARY.md`.
- Capture any explicit **domain rules** you can infer as versioned files in
  `contextkit/memory/business-rules/` (copy `_TEMPLATE.md`) — e.g. pricing, eligibility,
  scheduling, gamification. One cohesive rule per file.
- At **level ≥ 4** the squads install (`.agents/agents/`): **devteam**, **qa-team**,
  **compliance-team** (LGPD), **design-team** (UI/UX), plus starter product/ops
  agents. Review `contextkit/squads/README.md`. Enable the squads relevant to this
  project (e.g. compliance-team if it handles Brazilian residents' personal data;
  design-team if it has a UI) and **grow the devteam** with domain agents via
  `/squad` (e.g. `frontend`, `backend`, `db`) from `_TEMPLATE.md`.

## Phase 5b — Product roadmap (important — don't skip)
Run `node contextkit/tools/scripts/roadmap.mjs find --json`:
- If it lists an existing roadmap/PRD/spec file → offer to **import/normalize** it
  into `contextkit/memory/roadmap.md` via `/roadmap from-existing`.
- If none and the roadmap is undefined → **analyze** the codebase and **propose** a
  roadmap, then **ask the user for their objectives** to add (P-IDs). Drive this
  with `/roadmap from-existing`. A project without a roadmap is flying blind —
  create it now (with the user), even a small first version.

## Phase 6 — Install what's needed (confirm first)
- If `package.json` exists but dependencies aren't installed, offer to run the
  detected package manager's install (`pnpm install` / `npm install` / …).
- If the user chose **Level 5** and wants strict `/context-config` validation,
  offer to add `zod` as a dev dependency (optional — the kit runs without it).
- Never install anything without explicit confirmation.

## Phase 6b — Version control (verify the remote, decide with the user)
Run `node contextkit/tools/scripts/git.mjs status` and act on the result:
- **`isRepo: false`** → offer `git init`.
- **`remoteUrl` present** → already connected; confirm it's the right one, move on.
- **`remoteUrl: null`** → **ask**: "No remote — do you already have a repo
  (GitHub/GitLab/other) to connect, or should we create one?" Then run
  `/git setup-remote` (B1 connect existing / B2 create new, private by default).
Confirm before any push/repo-creation (outward-facing).

## Phase 7 — Record the baseline
1. Create `contextkit/memory/decisions/0001-<stack-slug>.md` (use `/new-adr` style)
   capturing the chosen stack + immutable rules as the baseline decision.
2. Run `/log-session` to register this onboarding session.
3. The `setup-complete.mjs` call already flipped `config.setup.completed = true`,
   so the first-run trigger will no longer fire. Confirm it is `true`.

## Phase 8 — Report
Summarize to the user: detected stack, level set, config tuned (counts of
important/high-risk paths), CLAUDE.md sections filled, agents created, deps
installed, ADR + session logged. End with the natural next step.

If anything is ambiguous, prefer asking one crisp question over guessing wrong.
The point of this command is that the user goes from "kit installed" to "kit
fully fitted to my project" in a single pass.
