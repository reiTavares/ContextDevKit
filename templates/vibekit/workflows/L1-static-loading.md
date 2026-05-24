# L1 — Static loading (auto-load at boot)

> Level 1 of the context system. Solves: **"How does Claude start every session
> already knowing the essentials, without the user explaining them?"**

## How it works

When Claude Code opens a session in this directory, it automatically loads:

| File / folder | When | Content |
| --- | --- | --- |
| `CLAUDE.md` (root) | Always | Stack, immutable rules, the coding constitution, active level. |
| `<module>/CLAUDE.md` | When editing that subtree | Local rules scoped to a module (see `/claude-md`). |
| `.claude/agents/<name>.md` | Always (frontmatter) | Squad agents — auto-dispatched when the domain matches (L4+). |
| `.claude/commands/<name>.md` | Always (frontmatter) | Slash commands available in the chat. |

On top of that, the `SessionStart` hook (L2) injects **dynamic** boot context: the
last registered session, `[Unreleased]` from the changelog, detected drift, active
claims, and ahead/behind divergence vs `origin/<main>`.

## Hard technical constraints

- Claude Code reads from fixed paths: `.claude/settings.json`, `.claude/commands/`,
  `.claude/agents/`. **Do not move** these folders.
- `.claude/.sessions/` and `.claude/.workspace/` are runtime state (gitignored).
  They persist between sessions but never reach the repo.
- Everything the platform owns lives under `vibekit/` — the single `PLATFORM_DIR`
  (`vibekit/runtime/config/paths.mjs`). Never hardcode the folder name elsewhere.

## End-to-end flow when Claude opens

1. Claude Code reads root `CLAUDE.md` (the whole system, described tersely).
2. Reads `.claude/agents/*.md` — squad agents become available for delegation (L4+).
3. Reads `.claude/commands/*.md` — slash commands become available in the input.
4. The `SessionStart` hook (`vibekit/runtime/hooks/session-start.mjs`) runs via
   `.claude/settings.json`:
   - silent `git fetch origin` (short timeout, never blocks);
   - drift analysis of previous sessions;
   - a fresh ledger for this session;
   - injection of the boot context.
5. Editing a file under a module that has its own `CLAUDE.md` loads those local rules.

## Maintenance rules

- **Keep it lean.** Root `CLAUDE.md` is the overview; detail goes into ADRs or linked
  docs. The file warns when it grows past ~200 lines.
- **Don't duplicate** between root and scoped `CLAUDE.md` — the child complements,
  never repeats.
- **Don't inflate** `.claude/agents/<name>.md` — the frontmatter is executable; the
  rich briefing lives in `vibekit/squads/<team>/<name>.md` (L4).
- Slash commands stay in `.claude/commands/`; their narrative playbooks live in
  `vibekit/workflows/playbooks/`.

## When to update

- Stack change (lib, framework, runtime) → root `CLAUDE.md` **and** an ADR.
- New squad agent → `.claude/agents/<name>.md` + `vibekit/squads/<team>/<name>.md`.
- New slash command → `.claude/commands/<name>.md` (+ a playbook here if it carries
  judgment) + update the command list in root `CLAUDE.md`.
