# Changelog

All notable changes to VibeDevKit are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/);
this project follows [Semantic Versioning](https://semver.org/).

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
