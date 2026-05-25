# Architecture

How VibeDevKit works internally — for anyone extending the engine.

## Two install locations

Claude Code reads settings, slash commands, and agents from **hardcoded** paths
under `.claude/`. Everything else — the engine, memory, scripts — lives under a
single rebrandable folder, `vibekit/` (a "bounded context" separate from your
product code). The only literal reference to that folder name is
`PLATFORM_DIR` in `vibekit/runtime/config/paths.mjs`.

```
.claude/              # fixed by Claude Code
  settings.json       # hook wiring (composed by the installer per level)
  commands/*.md       # slash commands (prompts with frontmatter)
  agents/*.md         # sub-agents (frontmatter: name + description)
  .sessions/          # per-session ledgers (gitignored runtime state)
  .workspace/         # per-session claim files (gitignored runtime state)
vibekit/
  runtime/hooks/      # the four hooks + shared ledger/classification/readers
  runtime/config/     # paths, defaults, zero-dep loader, settings composer, zod (opt)
  runtime/git-hooks/  # pre-commit, commit-msg
  tools/scripts/      # maintenance + slash-command helpers
  memory/             # decisions/, sessions/, business-rules/, GLOSSARY.md, generated indices
  config.json         # level + ledger path lists + L5 params
```

## The hooks (the engine)

Wired in `.claude/settings.json`, each is a `node` script fed the tool payload on
stdin. **Contract for every hook: never throw, exit 0 on error, stay silent
unless it has something to say.** A broken hook must never block real work.

| Hook | Event | File | Job |
| --- | --- | --- | --- |
| Boot context | `SessionStart` | `session-start.mjs` | git fetch + divergence; drift banner; inject latest session + `[Unreleased]` + active claims |
| Edit ledger | `PostToolUse` (Edit\|Write\|MultiEdit) | `track-edits.mjs` | append edit to per-session ledger; renew claim heartbeat; cross-claim warning |
| Drift nudge | `Stop` | `check-registration.mjs` | block stop if ≥ 2 important files changed and session unregistered; L5 archive + distill nudge |
| Concurrency guard (L3) | `PreToolUse` (Edit\|Write\|MultiEdit) | `concurrency-guard.mjs` | warn when another session/external change touched the same file (no clobber) |
| Risk gate (L5) | `PreToolUse` (Edit\|Write\|MultiEdit) | `simulate-gate.mjs` | block edits to `highRiskPaths` without a covering `/simulate-impact` |

Git hooks (installed at L≥3): `pre-commit` (regenerate indices), `commit-msg`
(Conventional Commits), `pre-push` (fetch upstream + **block real conflicts** via
`git merge-tree` — the cross-machine guarantee).

Shared modules:

- **`ledger.mjs`** — per-session JSON ledger (read/write/list), simulation
  records, session-id resolution. One ledger file per session so parallel chats
  never stomp each other (and worktrees isolate naturally).
- **`path-classification.mjs`** — `isTrackable` / `isImportant` /
  `isRegistrationFile`, driven by `config.json` → `ledger.*`. **This is the seam
  that makes the kit stack-agnostic.**
- **`boot-context-readers.mjs`** — pure readers for the session/changelog/
  workspace artifacts.

## Configuration (zero-dependency by design)

The hot path (hooks) must run on a brand-new project with nothing installed, so
`runtime/config/load.mjs` is **plain JSON + a recursive deep-merge over
`defaults.mjs`** — no `zod`, no npm packages. Arrays replace; objects merge. A
leading UTF-8 BOM is stripped (common on Windows). On any failure it returns the
frozen defaults — config is best-effort, never fatal.

Strict validation (`runtime/config/schema.mjs`, zod) is **optional** and used
only by `/vibe-config`; it degrades gracefully when zod isn't present.

## Level system

`config.json` → `level` (1–7) is the single switch.

- The **installer** and the in-project **`vibe-level.mjs`** both call the shared
  `composeSettings(existing, level)` (`runtime/config/settings-compose.mjs`) to
  rebuild the `hooks` block — preserving your own hooks, stripping previously
  installed VibeDevKit entries so going down a level cleanly removes them. It is
  idempotent: re-running never duplicates entries.
- Hooks also read the level at runtime and self-gate (e.g. the Stop hook only
  runs L5 distillation when `level >= 5`), so the wiring and the behaviour can
  never disagree.

## Derived indices

`SESSIONS.md` (session index) and `WORKSPACE.md` (active claims) are **generated**
from source-of-truth files (`sessions/*.md` and `.claude/.workspace/*.json`).
This avoids merge conflicts between parallel sessions. The `pre-commit` git hook
regenerates them before each commit. Never hand-edit a generated file.

## Why this shape

- **Defense in depth.** Instructions (CLAUDE.md, slash commands) are advisory;
  hooks are enforced. The two layers cover each other.
- **Reversible & inspectable.** Everything is plain files in your repo. Uninstall
  by deleting `vibekit/` and the VibeDevKit block from `.claude/settings.json`.
- **No lock-in on the hot path.** Zero runtime deps for Levels 1–3.
