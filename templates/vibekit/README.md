# vibekit/ — VibeDevKit platform

This folder is the AI-assisted development platform installed by
[VibeDevKit](https://github.com/). It is a **bounded context** separate from your
product code — everything here exists to make Claude Code sessions reliable,
self-documenting, and consistent across time.

## Layout

| Path | What |
| --- | --- |
| `runtime/hooks/` | Claude Code hooks (boot context, edit ledger, drift nudge, L5 gate) |
| `runtime/config/` | Zero-dep config loader, defaults, paths, settings composer, optional zod schema |
| `runtime/git-hooks/` | `pre-commit` (reindex) and `commit-msg` (Conventional Commits) |
| `tools/scripts/` | Maintenance scripts (reindex, workspace-sync, snapshot, claim/release, etc.) |
| `memory/decisions/` | ADRs — the immutable *why* |
| `memory/sessions/` | One markdown file per work session — the *what* |
| `memory/SESSIONS.md` | Auto-generated index (do not hand-edit) |
| `memory/WORKSPACE.md` | Auto-generated active-claims index (do not hand-edit) |
| `memory/GLOSSARY.md` | Domain term ↔ code identifier |
| `config.json` | Level + ledger path lists + L5 params (edit via `/vibe-config`) |

## Levels

The active level is `config.json` → `level`. See `/vibe-level` to inspect or
change it. Higher levels add capability:

1. **Memory** — boot context, session log, ADRs, changelog.
2. **Ledger** — drift detection (tracks edits, nudges you to `/log-session`).
3. **Multi-session** — claims, worktrees, derived indices, git hooks.
4. **Squads** — specialized sub-agents in `.claude/agents/`.
5. **Proactive** — `/simulate-impact` gate on high-risk paths, tech-debt sweep, auto-distill.

## Requirements

- **Node.js** (for the hooks/scripts — Levels 1–3 need zero npm packages).
- **git** (for divergence detection and Level 3 git hooks).
- `zod` is optional, only for strict `/vibe-config` validation at Level 5.

## Updating the engine

Re-run the kit installer over the project to pull engine updates without losing
your memory or config:  `node <path-to-vibedevkit>/install.mjs --target . --level <N> --yes`.
