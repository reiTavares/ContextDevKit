# `.codex/` — OpenAI Codex host

This directory is ContextDevKit's Codex adaptation layer. It contains the
project-local Codex hook wiring and the TOML subagent definitions generated from
the canonical Claude Code agents.

## Host-coexistence rule

- **Codex** reads `AGENTS.md` for boot context and `.codex/` for Codex-local
  hooks/subagents.
- **Claude Code** reads `.claude/` and `CLAUDE.md`.
- **Google Antigravity** reads `.agents/` and `INSTRUCTIONS.md`.
- Codex skills are installed under `.agents/skills/source-command-*` because that
  is the project skill surface Codex discovers in this host. Those skills are
  generated from the same Claude command source as the Antigravity skills.

Codex, Claude Code, and Antigravity cooperate over the same ContextDevKit memory,
ledger, DevPipeline, ADRs, and changelog. Do not use this host tree to fork the
project process or bypass another active host's workspace claim.

## Converter — wire-or-retire status (ADR-0056 follow-up)

The Claude→Codex converter lives at
`contextkit/runtime/codex/convert-all.mjs` and has two modes:

- **Kit-build mode (`--templates`) — WIRED.** `npm run build:codex` regenerates
  `templates/codex/skills/<skill>/SKILL.md` and `templates/codex/agents/*.toml`
  from the canonical `templates/claude/` source. These generated assets ship
  with the kit, and `installCodexHost` copies them into the project's
  `.agents/skills/source-command-*` surface on install/update.

- **Installed-mode (run against a project's `.claude/`) — available but NOT
  auto-wired.** Unlike the Antigravity host (which auto-converts a project's
  `.claude/` customizations on install), the Codex installer ships the
  kit-generated skills as-is. It does **not** run the converter over a project's
  own custom `.claude/commands`. This is a deliberate retire-from-the-install-
  path decision: it keeps the install flow deterministic and avoids converting
  half-formed project commands. The converter remains usable on demand — a
  project that wants its custom commands as Codex skills can run
  `node contextkit/runtime/codex/convert-all.mjs` manually (opt-in), mirroring
  the constitution's "default to refuse, opt-in to permit" posture.

Treat this tree as kit-owned and regenerated on update. Put durable project
decisions in `contextkit/memory/decisions/`, not in generated host assets.
