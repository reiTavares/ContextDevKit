# `.agents/` — Google Antigravity host (agy CLI + IDE)

This directory is ContextDevKit's **Antigravity adaptation layer** [ADR-0036,
ADR-0048]. The name `.agents/` is **dictated by the Google `agy` binary** — it
resolves workspace skills, hooks and MCP config strictly from this folder.

## ⚠️ Host-coexistence rule

- **Do not remove or rename this folder.** The `agy` CLI requires the literal
  name `.agents/` to register native slash commands and hooks.
- **Claude Code** reads exclusively from `.claude/` — it never looks here.
- **Google Antigravity (`agy`)** reads exclusively from `.agents/` — it never
  looks at `.claude/`.
- The two hosts coexist independently; ContextDevKit keeps them in parity
  (`.claude/commands/` ↔ `.agents/skills/`) via its generator. Treat this tree
  as **kit-owned and always-overwritten on update** — put your own custom agy
  skills in nested files the kit doesn't ship, or they belong in
  `.claude/commands/` first and get converted.

## Directory map

```
.agents/
  skills/      ← slash commands in the agy TUI (/state, /pipeline, /log-session …)
  agents/      ← specialist persona briefings (devteam / qa / security squads)
  playbooks/   ← reusable procedures the agent can follow
  workflows/   ← level-activation guides (L1–L7)
  hooks.json   ← lifecycle automation (boot context, edit tracking, L5 gate) [ADR-0049]
```

## How skills work

Every Markdown file under `skills/` becomes a native slash command: typing `/`
in the agy prompt autocompletes them (e.g. `skills/state.md` → `/state`).
Nested folders are preserved (e.g. `skills/pipeline/ship.md`).

## Hooks

`hooks.json` wires ContextDevKit's lifecycle hooks (the same scripts Claude
Code runs from `.claude/settings.json`) into agy events — boot context at
session start, edit tracking, the L5 high-risk gate. The hook **scripts** live
in `contextkit/runtime/hooks/`; this file only registers them. Hooks always
fail open: a broken hook never blocks your real work.

## Knowledge Items

The project's durable memory is also available as **Knowledge Items** in
`<appDataDir>/knowledge/` (`contextdevkit-boot/`, `contextdevkit-architecture/`),
auto-loaded by the Antigravity IDE when their summaries match the task.
