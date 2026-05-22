# Changelog

All notable changes to VibeDevKit are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/);
this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **QA squad Tier 2**: `qa-perf` (benchmark/profile a hot path) and `qa-e2e`
  (critical user journeys through the real UI) agents — now 12 agent archetypes.
- **Release workflow** (`.github/workflows/release.yml`): pushing a `v*` tag runs
  the test suite and publishes to npm via the `NPM_TOKEN` repo secret.
- README demo/walkthrough of the `/setupvibedevkit` flow.

### Released
- v0.4.0 published to npm and tagged as a GitHub Release.

## [0.4.0] - 2026-05-22

### Added
- **QA squad** (Level 4): `qa-orchestrator` (router + sign-off) plus `qa-unit`,
  `qa-integration`, `qa-fuzzer` specialists, and the `/test-plan`,
  `/scaffold-tests`, `/qa-signoff` commands. New `qa` config section
  (`criticalPaths`, `coverageTarget`); `detect-stack`/`setup-complete` suggest
  and apply `qa.criticalPaths`.
- **`/audit`** — one-pass health audit (doctor + tech-debt + QA + drift) with a
  prioritized action list; README documents running it on a schedule.
- **GitHub templates** installed into the target's `.github/` (PR template +
  bug/feature issue templates), written only if missing.
- **npm packaging**: `prepublishOnly` gates publish on the test suite.

### Notes
- Now ships 22 slash commands and 10 agent archetypes. Agents install at L ≥ 4.

## [0.3.0] - 2026-05-22

### Added
- **GitHub Actions CI** (`.github/workflows/ci.yml`) — runs the self-check and a
  full integration test on Node 18/20/22, plus a greenfield install smoke test.
- **`tools/integration-test.mjs`** — installs into a temp project and drives the
  real hooks through a true stdin pipe (drift block, L5 gate block + allow,
  first-run trigger, level rewire, doctor). Cross-platform, self-cleaning.
- **`/distill-sessions` + `/distill-apply`** — the auto-distill cycle the L5 Stop
  nudge referenced (propose CLAUDE.md refinements, then apply with an ADR).
- **`/vibe-doctor`** + `doctor.mjs` — diagnoses node version, config validity,
  hook wiring vs level, git hooks, memory scaffolding, and onboarding state.
- **`vibe-config.mjs`** — robust `show`/`set` backing `/vibe-config` (type
  coercion + optional zod validation), replacing free-form JSON editing.
- **Agent archetypes**: `test-engineer`, `security` (now 6 universal agents).
- **Installer**: `--help`, `--version`, `--uninstall [--purge]`, and a
  `.gitattributes` patch (keeps engine scripts LF on all platforms).
- **Packaging**: `files`, `repository`, `homepage`, `bugs`, and `npm test`.

### Notes
- `--uninstall` keeps your memory (`vibekit/memory/`) and `CLAUDE.md`; `--purge`
  additionally removes the engine, commands, and agents.

## [0.2.0] - 2026-05-22

### Added
- **First-run trigger** — the SessionStart hook surfaces a "First run" banner
  until onboarding completes, prompting `/setupvibedevkit`.
- **`/setupvibedevkit`** — one-shot self-configuring onboarding (detect stack,
  tune config, fill CLAUDE.md, seed glossary, scaffold agents, baseline ADR).
- **`detect-stack.mjs`** + **`setup-complete.mjs`** — read-only stack analyzer
  with suggested ledger/high-risk paths, applied via `--detect`.
- `npx github:reiTavares/VibeDevKit` import documented.

## [0.1.0] - 2026-05-22

### Added
- Initial release: portable, level-based (L1–L5) AI dev platform for Claude Code.
- Engine: 4 hooks (boot context, edit ledger, drift nudge, L5 risk gate),
  config-driven path classification, zero-dependency BOM-safe config loader.
- Installer with greenfield/existing detection and idempotent settings
  composition. 14 slash commands, agent archetypes, ADR/session/glossary
  scaffolding, and docs.
