# 🌀 VibeDevKit

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
# run the installer straight from GitHub into the current project
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

## The five levels

| Level | Name | Adds |
| --- | --- | --- |
| **1** | Memory | Boot context injection, `/log-session`, ADRs, changelog |
| **2** | Ledger | Drift detection — tracks edits, nudges you to register the session |
| **3** | Multi-session | `/claim` · `/worktree-new`, derived indices, git hooks (Conventional Commits) |
| **4** | Squads | Specialized sub-agents (`code-reviewer`, `context-keeper`, `architect`, …) |
| **5** | Proactive | `/simulate-impact` gate on high-risk paths, `/tech-debt-sweep`, auto-distill |

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

`/setupvibedevkit` (run once, first) · `/state` · `/log-session` · `/new-adr`
· `/close-version` · `/context-refresh` · `/dev-start` · `/bug-hunt` · `/claim`
· `/release` · `/worktree-new` · `/simulate-impact` · `/tech-debt-sweep`
· `/vibe-level` · `/vibe-config`

## Customizing for your stack

The one thing worth tuning per project: **which paths matter**. Edit
`vibekit/config.json` → `ledger.*` (or use `/vibe-config`). A Python project adds
`app/`, `tests/`; a Go project adds `cmd/`, `internal/`. Everything else works
out of the box. See [docs/CUSTOMIZING.md](docs/CUSTOMIZING.md) for growing your
own squad of sub-agents and adding slash commands.

## Develop the kit itself

```bash
node tools/selfcheck.mjs    # smoke test: loads the engine, asserts wiring per level
```

## Docs

- [docs/LEVELS.md](docs/LEVELS.md) — what each level does and when to climb.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the engine works internally.
- [docs/CUSTOMIZING.md](docs/CUSTOMIZING.md) — tune config, add agents/commands, rebrand.

## License

MIT — see [LICENSE](LICENSE).
