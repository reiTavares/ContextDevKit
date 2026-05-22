# Changelog

All notable changes to VibeDevKit are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/);
this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Version-control skill** — `/git` command + `git.mjs` diagnostics. Codifies the
  workflow (Conventional branches/commits — already hook-enforced — feature→PR, no
  direct push to default, rebase-sync, conflict handling via pre-push) and the
  **remote setup**: detects git/repo/remote/provider and whether `gh`/`glab` are
  installed+authed, and guides connecting GitHub/GitLab/other (install the CLI +
  create the repo, private by default). Wired into `/setupvibedevkit` (6b),
  `/aidevtool-from0` (6b), the installer hint, and `doctor` (notes missing remote).
- **Modular CLAUDE.md** — each app/module gets its own scoped CLAUDE.md (like the
  source platform's `apps/api/CLAUDE.md` + `apps/mobile/CLAUDE.md`). `claude-md.mjs`
  (find/scaffold) detects module roots (`backend/`, `frontend/`, `api/`, `web/`,
  `mobile/`, and `apps/*`/`packages/*`/`modules/*`/`services/*`), `/claude-md`
  scaffolds + fills them, a `CLAUDE.child.md.tpl` is seeded, and `doctor` notes
  modules missing one. Wired into `/setupvibedevkit` (Phase 4b) + `/aidevtool-from0`.
- **Product roadmap as a first-class artifact**: seeded `vibekit/memory/roadmap.md`
  (P-ID format), `/roadmap` command (new project → build it WITH the user;
  existing project → find a roadmap/PRD/spec to import, or analyze the code and
  **propose** one + ask the user for objectives), and `roadmap.mjs`
  (find/status/init). Wired into `/setupvibedevkit` (Phase 5b) and
  `/aidevtool-from0` (Phase 4); `doctor` notes when the roadmap is undefined.
- **`/aidevtool-from0`** — bootstrap an empty project from zero: intelligent
  interactive product questionnaire → product vision, stack suggestion/refine
  (ADR), product **roadmap** (P-IDs), best-practices constitution, and a seeded
  DevPipeline. First-run boot now routes empty projects here, existing ones to
  `/setupvibedevkit`.
- **Best-practices skill**: `vibekit/best-practices.md` (file-size budget +
  **intelligent** refactor-by-responsibility, SoC, naming, errors, docs) and
  `/analyze-code-ia-practices` — runs the scanner then proposes the *right*
  refactor per file (never random splits). New `practices.active` config; boot
  reminds when active.
- **DevPipeline** (execution control, distinct from the product roadmap):
  `vibekit/pipeline/{backlog,testing,conclusion}/` task files + generated
  `devpipeline.md` dashboard; `pipeline.mjs` (`add`/`move`/`sync`) and the
  `/pipeline` manager command. Bugs/increments/chores + roadmap items broken into
  tasks with priority + SLA. Synced on pre-commit.

## [0.5.0] - 2026-05-22

### Added
- **Concurrency hardening (L3)** — robust against parallel sessions on the same
  machine AND different devs/machines:
  - `concurrency-guard.mjs` (`PreToolUse`): warns before you overwrite a file
    another active session edited recently, or that changed on disk since you
    last wrote it (covers full-file `Write`, which Claude Code's `Edit` freshness
    check doesn't).
  - `pre-push.mjs` git hook: fetches the upstream and **blocks a push that has a
    real textual conflict** with what was pushed there (`git merge-tree`); warns
    on auto-mergeable overlap. Bypass: `VIBE_ALLOW_CONFLICT_PUSH=1`.
  - SessionStart now lists **other active branches** (local worktrees + recent
    remote branches with author/age) for cross-machine awareness.
  - New config `l3.mainBranch` (upstream the conflict check compares against).
- **`/ship` automatic checkpoints** — `--auto` runs the pipeline through
  objective gates (no manual pause), still stopping on a red gate and before any
  irreversible action.
- **L6 — Autonomy & Insight** (new level): `/ship` (autonomous squad pipeline:
  design → implement → review → test → record, with checkpoints), `/retro`
  (learning loop turning recurring drift/debt into rules + ADRs), `/vibe-stats`
  (platform telemetry). No new hook — a capability tier on top of L5.
- **Deterministic tech-debt scanner** (`tech-debt-scan.mjs` + `tech-debt-detectors.mjs`):
  generic regex detectors (line budget, SRP "And/Or/E" names, TODO markers,
  React state-loops). `/tech-debt-sweep` now runs the scanner, then interprets.
- **Generic contract-drift** (`contract-scan.mjs` + `/contract-check`): declare
  `l5.contractGlobs`, snapshot exported symbols, flag removals/renames. CI-able.
- **Platform metrics** (`stats.mjs`): sessions, drift rate, cadence, ADR/agent counts.
- **`instrucoes.md`** — pt-BR usage guide (kit root + installed into projects).
- **`docs/ROADMAP.md`** — architect gap analysis vs the source system + L6 + future.
- New config: `l5.lineBudget`, `l5.contractGlobs`. Level range is now 1–6.

### Changed
- `/audit` now runs doctor + stats + tech-debt-scan + contract-scan deterministically.

## [0.4.1] - 2026-05-22

### Added
- **QA squad Tier 2**: `qa-perf` (benchmark/profile a hot path) and `qa-e2e`
  (critical user journeys through the real UI) agents — now 12 agent archetypes.
- **Release workflow** (`.github/workflows/release.yml`): pushing a `v*` tag runs
  the test suite, publishes to npm via the `NPM_TOKEN` secret, and creates the
  GitHub Release automatically.
- README demo/walkthrough of the `/setupvibedevkit` flow.

### Note
- First release cut by the automated tag pipeline (validating it end-to-end).

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
