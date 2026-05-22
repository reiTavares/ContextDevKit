e # 🌀 VibeDevKit

[![CI](https://github.com/reiTavares/VibeDevKit/actions/workflows/ci.yml/badge.svg)](https://github.com/reiTavares/VibeDevKit/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/vibedevkit)](https://www.npmjs.com/package/vibedevkit)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)
![Zero deps](https://img.shields.io/badge/runtime%20deps-0-success)

> A portable, **level-based AI-assisted development platform** for Claude Code.
> Drop it into any project — greenfield or existing, any stack — and get durable
> project memory, automatic context loading, drift detection, specialized
> sub-agents, and proactive governance. Activate as much or as little as you want.

VibeDevKit is the generalized, stack-agnostic distillation of a production context
system. It treats "vibe coding" as **engineering**: instead of hoping the AI
remembers things, it makes the harness *enforce* them with hooks, and it records
the *why* in version control so any future session — human or AI — can pick up
where the last one left off.

## Why

A plain `CLAUDE.md` is just instructions the AI can ignore. VibeDevKit adds the
parts that don't depend on the AI's goodwill:

- **Hooks** inject context at session start, track every edit, and *block* the
  session from ending with unregistered work.
- **Durable memory** — ADRs (the *why*), session logs (the *what*), a glossary
  (the naming authority), and an auto-generated changelog — all in your repo.
- **Levels** so you adopt it gradually: start with memory only, turn on more as
  the project (and your trust) grows.

## Requirements

- **Node.js ≥ 18** (the hooks/scripts are plain `.mjs`; Levels 1–3 need **zero**
  npm packages).
- **git** (for divergence detection and the Level 3 git hooks).
- **Claude Code** (CLI, desktop, web, or IDE extension).

## Install

**One command, from anywhere** (the repo is the installer):

```bash
# from npm (recommended)
npx vibedevkit --target . --level 2 --yes

# or straight from GitHub (no npm needed)
npx github:reiTavares/VibeDevKit --target . --level 2 --yes
```

Or clone and run locally:

```bash
# interactive — asks name / mode / level
node install.mjs --target /path/to/your-project

# non-interactive
node install.mjs --target /path/to/your-project --level 2 --name "My App" --yes
```

Greenfield? Run it in an empty (or `git init`-ed) folder and it scaffolds the
whole thing. Existing project? It detects your stack, never clobbers your
`CLAUDE.md` (it writes `CLAUDE.vibedevkit.md` to merge by hand), and preserves
any hooks you already had.

### Then: one-shot self-configuration

Open the project in Claude Code, approve the hooks once — and **VibeDevKit tells
you it isn't configured yet** (a first-run trigger fires from the boot hook).
Run:

```
/setupvibedevkit
```

This inspects the project, tunes the config to your stack (`ledger` path lists,
high-risk paths), fills in `CLAUDE.md` (rules, stack, glossary), scaffolds domain
sub-agents, installs what's needed (with your OK), records a baseline ADR, and
logs the session — going from "kit installed" to "kit fitted to *this* project"
in a single pass. After it finishes, the trigger stops nagging.

### What you'll see

<!-- Drop a real recording here when you have one: a GIF or an asciinema embed.
     ![demo](docs/media/setup.gif) -->

```text
$ npx vibedevkit --target . --level 2 --yes
✓ .claude/settings.json wired for L2
✓ engine installed (vibekit/runtime, vibekit/tools)
✓ slash commands installed (.claude/commands)
✓ CLAUDE.md created  ·  docs/CHANGELOG.md created
✅ VibeDevKit installed at Level 2

# open in Claude Code → the boot hook greets you with:
## 🚀 First run — VibeDevKit not configured yet  →  run /setupvibedevkit

> /setupvibedevkit
  Phase 1 — Inspect ……  detected: TypeScript · Vite · React · vitest
  Phase 3 — Apply ……    ledger tuned (src/, tests/); high-risk: src/db/schema.ts
  Phase 4 — CLAUDE.md …  stack + immutable rules filled in
  Phase 7 — baseline ADR-0001 recorded; session logged
  ✅ VibeDevKit fitted to this project.
```

## The five levels

| Level | Name | Adds |
| --- | --- | --- |
| **1** | Memory | Boot context injection, `/log-session`, ADRs, changelog |
| **2** | Ledger | Drift detection — tracks edits, nudges you to register the session |
| **3** | Multi-session | `/claim` · `/worktree-new`, derived indices, git hooks (Conventional Commits) |
| **4** | Squads | Specialized sub-agents (`code-reviewer`, `context-keeper`, `architect`, QA squad, …) |
| **5** | Proactive | `/simulate-impact` gate, `/tech-debt-sweep` (deterministic), `/contract-check`, auto-distill |
| **6** | Autonomy & Insight | `/ship` (orchestrated squad pipeline), `/retro` (learning loop), `/vibe-stats` (metrics) |

Change level anytime — from inside the project:

```bash
node vibekit/tools/scripts/vibe-level.mjs        # show
node vibekit/tools/scripts/vibe-level.mjs 4      # move to L4
```

…or via the `/vibe-level` slash command. Going up adds capability; going down
cleanly removes the now-disabled hooks. See [docs/LEVELS.md](docs/LEVELS.md).

## What gets installed into your project

```
your-project/
  CLAUDE.md                     # boot context + your coding constitution
  .claude/
    settings.json               # hook wiring (composed for your level)
    commands/                   # 14 slash commands
    agents/                     # sub-agent archetypes (Level 4+)
  vibekit/
    runtime/hooks/              # the engine: boot, ledger, drift, L5 gate
    runtime/config/             # zero-dep loader, defaults, settings composer
    runtime/git-hooks/          # pre-commit (reindex) + commit-msg (Conventional)
    tools/scripts/              # reindex, snapshot, claim/release, worktree, ...
    memory/decisions/           # ADRs
    memory/sessions/            # one file per session
    memory/GLOSSARY.md
    config.json                 # level + ledger path lists + L5 params
  docs/CHANGELOG.md
```

## Slash commands

**Setup:** `/aidevtool-from0` (empty project) · `/setupvibedevkit` (existing project)

**Daily:** `/state` · `/log-session` · `/new-adr` · `/close-version`
· `/context-refresh` · `/dev-start` · `/bug-hunt` · `/audit`

**Multi-session:** `/claim` · `/release` · `/worktree-new`

**Quality:** `/simulate-impact` · `/tech-debt-sweep` · `/analyze-code-ia-practices`
· `/contract-check` · `/test-plan` · `/scaffold-tests` · `/qa-signoff`

**Product & execution:** `/roadmap` (product plan) · `/pipeline` (DevPipeline board)
· `/ship` · `/retro` · `/vibe-stats` · `/distill-sessions` · `/distill-apply`

**Structure & platform:** `/squad` (squads roster + grow) · `/git` (version control
+ remote) · `/claude-md` (scoped CLAUDE.md per module) · `/vibe-level` · `/vibe-config`
· `/vibe-doctor`

### Squads (Level 4)

Sub-agents are organized into **squads** (`vibekit/squads/README.md`, managed with
`/squad`): **devteam** (architect, code-reviewer, context-keeper, security,
test-engineer), **qa-team** (qa-orchestrator + unit/integration/fuzzer/perf/e2e),
**compliance-team** (`privacy-lgpd` — standardized Brazilian LGPD skills),
**design-team** (ux-designer, ui-designer, accessibility), plus starters for
**product-team** (`product-owner`) and **ops-team** (`devops`). Grow your own —
or new squads (docs/data/growth) — from `_TEMPLATE.md` via `/squad`.

### Roadmap vs DevPipeline

Two different artifacts: **`vibekit/memory/roadmap.md`** is the *product/business
plan* (capabilities, P-IDs, the what/why). The **DevPipeline**
(`vibekit/pipeline/`, board in `devpipeline.md`) is *execution control* — bugs,
increments, chores, and roadmap items broken into tasks with priority + SLA,
flowing `backlog → testing → conclusion`. The roadmap says what to build; the
pipeline runs the work.

🇧🇷 Guia em português: [instrucoes.md](instrucoes.md).

## Maintenance

```bash
# diagnose an install (node, config, hook wiring vs level, git hooks, onboarding)
/vibe-doctor          # or: node vibekit/tools/scripts/doctor.mjs

# safe update — refresh engine + slash commands + hook wiring for your CURRENT
# level. NEVER touches CLAUDE.md, vibekit/config.json, memory (ADRs/sessions/
# roadmap), pipeline tasks, or scoped module CLAUDE.md files.
npx vibedevkit@latest --target . --update
#   (offline / from GitHub: npx github:reiTavares/VibeDevKit --target . --update)

# change level (rewires settings.json, installs git hooks at L>=3)
/vibe-level 4

# uninstall — keeps your memory (ADRs, sessions) and CLAUDE.md
node /path/to/vibedevkit/install.mjs --target . --uninstall
# ...or also remove the engine/commands/agents:
node /path/to/vibedevkit/install.mjs --target . --uninstall --purge
```

## Customizing for your stack

The one thing worth tuning per project: **which paths matter**. Edit
`vibekit/config.json` → `ledger.*` (or use `/vibe-config`). A Python project adds
`app/`, `tests/`; a Go project adds `cmd/`, `internal/`. Everything else works
out of the box. See [docs/CUSTOMIZING.md](docs/CUSTOMIZING.md) for growing your
own squad of sub-agents and adding slash commands.

## Develop the kit itself

```bash
npm test                      # selfcheck + integration test (what CI runs)
node tools/selfcheck.mjs      # static: loads the engine, asserts wiring per level
node tools/integration-test.mjs  # end-to-end: installs to a temp dir, drives real hooks
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the rules (zero hot-path deps, hooks
never break work, add a test for anything you add).

## Docs

- [docs/LEVELS.md](docs/LEVELS.md) — what each level does and when to climb.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the engine works internally.
- [docs/CUSTOMIZING.md](docs/CUSTOMIZING.md) — tune config, add agents/commands, rebrand.
- [docs/ROADMAP.md](docs/ROADMAP.md) — architect analysis, the L6 layer, future directions.
- [instrucoes.md](instrucoes.md) — guia de uso em português (pt-BR).

## License

MIT — see [LICENSE](LICENSE).
