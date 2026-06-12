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

Treat this tree as kit-owned and regenerated on update. Put durable project
decisions in `contextkit/memory/decisions/`, not in generated host assets.
