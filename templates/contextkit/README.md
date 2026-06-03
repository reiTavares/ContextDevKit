# contextkit/ — ContextDevKit platform

This folder is the AI-assisted development platform installed by
[ContextDevKit](https://github.com/reiTavares/ContextDevKit). It is a **bounded
context** separate from your product code — everything here exists to make
Claude Code sessions reliable, self-documenting, and consistent across time.

## Layout

| Path | What |
| --- | --- |
| `runtime/hooks/` | Claude Code hooks (boot context, edit ledger, drift nudge, L5 gate) |
| `runtime/config/` | Zero-dep config loader, defaults, paths, settings composer, optional zod schema |
| `runtime/git-hooks/` | `pre-commit` (reindex), `commit-msg` (Conventional Commits), `pre-push` (block real conflicts) |
| `runtime/providers/review/` | PR/review CLI adapters (`gh` ships) — see ADR-0021 |
| `runtime/providers/media/` | Media generation adapters — `nano-banana` (Imagen 3) + `veo` (Veo 3); see ADR-0024 |
| `runtime/state/` | Canonical `state.json` substrate for tasks + pipeline runs (ADR-0015) |
| `tools/scripts/` | 50+ helpers (reindex, dashboard, sync-check, audits, media-gen, …) |
| `memory/decisions/` | ADRs — the immutable *why* |
| `memory/sessions/` | One markdown file per work session — the *what* |
| `memory/SESSIONS.md` | Auto-generated index (do not hand-edit) |
| `memory/WORKSPACE.md` | Auto-generated active-claims index (do not hand-edit) |
| `memory/GLOSSARY.md` | Domain term ↔ code identifier |
| `pipeline/` | DevPipeline lanes: `backlog/ → working/ → testing/ → conclusion/` |
| `workflows/playbooks/` | Reusable procedures (tanstack, landing-page, seo-aiso, tech-debt-sweep, …) |
| `squads/agent-forge/` | The L6+ "agent that builds agents" (Agent Package pipeline) |
| `config.json` | Level + ledger path lists + L5 params (edit via `/context-config`) |
| `.env.example` | Optional credentials template (`/media-gen` Google AI Studio keys) |

## The 7 levels

The active level is `config.json` → `level`. See `/context-level` to inspect or
change it. Higher levels add capability — earlier ones stay active.

1. **Memory** — boot context, session log, ADRs, changelog.
2. **Ledger** — drift detection (tracks edits, nudges you to `/log-session`).
3. **Multi-session** — claims, worktrees, derived indices, git hooks.
4. **Squads** — 28 specialized sub-agents organised into 7 squads (devteam,
   qa-team, design-team with `seo-specialist` + `landing-architect`,
   security-team, compliance-team, ops-team, agent-forge).
5. **Proactive** — `/simulate-impact` gate on high-risk paths, tech-debt sweep,
   distill-detect nudge, contract drift.
6. **Autonomy & Insight** — `/ship`, `/retro`, `/context-stats`, agent-forge squad.
7. **Ecosystem** — `/fleet` multi-repo control plane, `/tune-agents`,
   visual tests, playbook runner.

## Requirements

- **Node.js ≥ 18** (the hooks/scripts — Levels 1–3 need zero npm packages).
  **Node 20.6+** unlocks `--env-file` for the media-gen credentials flow.
- **git** (for divergence detection and Level 3 git hooks).
- `zod` is optional, only for strict `/context-config` validation at Level 5.
- *Optional:* `gh` (GitHub CLI) for sync-check PR awareness;
  `GOOGLE_AI_API_KEY` for `/media-gen`.

## Updating the engine

Re-run the kit installer over the project to pull engine updates without losing
your memory or config:

```bash
npx contextdevkit@latest --target . --update
# or, offline / from GitHub:
npx github:reiTavares/ContextDevKit --target . --update
```

## Quick references

- **Slash commands** — see `.claude/commands/README.md` for the taxonomy.
- **Provider adapters** — `runtime/providers/{review,media}/_adapter.mjs`
  document the contract.
- **Playbooks** — `workflows/playbooks/` for reusable procedures.
- **Setup credentials for `/media-gen`** — copy `.env.example` to `.env`, fill
  in `GOOGLE_AI_API_KEY`, run with `node --env-file=contextkit/.env ...`.
