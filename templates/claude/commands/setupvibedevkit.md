---
description: One-shot intelligent onboarding — inspects the project and self-configures VibeDevKit to it.
argument-hint: [target level 1-5]
---

# 🚀 Setup VibeDevKit

You are running the **self-configuring onboarding**. Goal: make this project's
VibeDevKit setup *at least as rich as a hand-tuned one* — adapted to THIS
project's stack, structure, and domain. Be thorough, infer aggressively, ask
only the few questions that genuinely need a human, and **never break the
project**. Confirm before any command that installs packages or changes the
environment.

Work through these phases in order. Use TodoWrite to track them.

## Phase 1 — Inspect
1. Run `node vibekit/tools/scripts/detect-stack.mjs` and parse the JSON report
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
- The **target level** (use `$ARGUMENTS` if provided; else recommend based on
  the report — L2 for most, L1 for greenfield, L4/L5 if the codebase is large or
  has clear high-risk areas).

## Phase 3 — Apply configuration
1. Tune the ledger + high-risk paths to this stack in one step (this also flips
   the first-run flag off at the end):
   ```
   node vibekit/tools/scripts/setup-complete.mjs --detect
   ```
   Then review `vibekit/config.json` and refine `ledger.important` /
   `l5.highRiskPaths` by hand if the heuristics missed something.
2. Set the chosen level: `node vibekit/tools/scripts/vibe-level.mjs <N>`
   (this rewires `.claude/settings.json` and installs git hooks at L≥3).

## Phase 4 — Fill in CLAUDE.md
Edit `CLAUDE.md` (or merge `CLAUDE.vibedevkit.md` if the installer left one):
- "What this is" — the description from Phase 2.
- "Stack" — the concrete detected stack (languages, frameworks, package manager).
- "Immutable rules" — the rules from Phase 2; link an ADR for each big one.
- "Language policy" — set the UI language row.
- Keep it under ~200 lines. Push detail into ADRs.

## Phase 4b — Scoped CLAUDE.md per app/module
Run `node vibekit/tools/scripts/claude-md.mjs find`. For a multi-app/monorepo
project, ensure **each app/module has its own CLAUDE.md** (backend, frontend,
each package/service): `claude-md.mjs scaffold`, then **fill each** with real
local rules (role, local stack, local conventions, boundaries) via `/claude-md`.
Single-package project → the root CLAUDE.md is enough; skip.

## Phase 5 — Seed the glossary & domain agents
- Add any clear domain terms (from README/code) to `vibekit/memory/GLOSSARY.md`.
- If level ≥ 4 and there are clear seams, scaffold focused sub-agents from
  `.claude/agents/_TEMPLATE.md` (e.g. `frontend`, `backend`, `db`, `security`)
  — sharp `description`s naming the dirs they own. Skip seams that don't exist.

## Phase 5b — Product roadmap (important — don't skip)
Run `node vibekit/tools/scripts/roadmap.mjs find --json`:
- If it lists an existing roadmap/PRD/spec file → offer to **import/normalize** it
  into `vibekit/memory/roadmap.md` via `/roadmap from-existing`.
- If none and the roadmap is undefined → **analyze** the codebase and **propose** a
  roadmap, then **ask the user for their objectives** to add (P-IDs). Drive this
  with `/roadmap from-existing`. A project without a roadmap is flying blind —
  create it now (with the user), even a small first version.

## Phase 6 — Install what's needed (confirm first)
- If `package.json` exists but dependencies aren't installed, offer to run the
  detected package manager's install (`pnpm install` / `npm install` / …).
- If the user chose **Level 5** and wants strict `/vibe-config` validation,
  offer to add `zod` as a dev dependency (optional — the kit runs without it).
- Never install anything without explicit confirmation.

## Phase 6b — Version control (verify the remote, decide with the user)
Run `node vibekit/tools/scripts/git.mjs status` and act on the result:
- **`isRepo: false`** → offer `git init`.
- **`remoteUrl` present** → a repo is already connected; confirm it's the right one
  and move on.
- **`remoteUrl: null`** → **ask the user**: "No remote is connected. Do you already
  have a repository (GitHub/GitLab/other) to connect, or should we create one?"
  Then run `/git setup-remote` and follow its decision tree (B1 connect existing /
  B2 create new — private by default, install `gh`/`glab` if needed).
Confirm before any push/repo-creation (outward-facing).

## Phase 7 — Record the baseline
1. Create `vibekit/memory/decisions/0001-<stack-slug>.md` (use `/new-adr` style)
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
