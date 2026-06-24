# Codex Integration — Architecture & Specification

How ContextDevKit runs natively in **OpenAI Codex** alongside Claude Code and Google Antigravity: same engine, same memory, generated host assets, local-only dogfood by default.

## Overview

Codex is the third host surface. Claude remains the canonical authored source for
commands and specialist agents; Codex assets are generated from it so the hosts do
not drift. The current Codex build emits 80 command-backed skills and 35
subagents from that source; no Claude command is silently omitted.

## What Gets Installed

```text
your-project/
  AGENTS.md
  cdx.mjs
  .codex/
    README.md
    hooks.json
    agents/*.toml
  .agents/
    skills/source-command-*/SKILL.md
```

- `AGENTS.md` is the Codex boot context, equivalent to `CLAUDE.md`.
- `.codex/hooks.json` wires the same hook scripts used by Claude Code.
- `.codex/agents/*.toml` are generated Codex subagents.
- `.agents/skills/source-command-*` are Codex skills generated from the Claude
  slash-command briefings.
- `cdx.mjs` is the Codex-branded command runner. It shares the same dispatcher as
  `ctx.mjs`, so `node cdx.mjs doctor` and `node ctx.mjs doctor` reach the same
  deterministic script.

## Session Lifecycle

Codex uses `.codex/hooks.json` to run the same governance loop as Claude Code:

- `SessionStart` -> `session-start.mjs --host codex`
- `UserPromptSubmit` -> `execution-contract-hook.mjs --host codex`
- `PreToolUse` -> `concurrency-guard.mjs --host codex`
- `PostToolUse` -> `track-edits.mjs --host codex`
- L5 `PreToolUse` -> `simulate-gate.mjs --host codex` and
  `deliberation-nudge.mjs --host codex`
- L5 `PreToolUse` / `PostToolUse` across `Edit|Write|Bash|mcp__.*` ->
  `execution-gate.mjs --host codex` and
  `indirect-write-reconcile.mjs --host codex`
- `Stop` -> `check-registration.mjs --host codex` and, at L5,
  `completion-gate.mjs --host codex`
- `SubagentStart` / `SubagentStop` -> `subagent-gate.mjs --host codex`
- `PreCompact` and compact/resume `SessionStart` ->
  `compaction-continuity.mjs --host codex`

When Codex does not provide a stable `session_id`, SessionStart mints a local
Codex marker so later hook events reuse the same ledger instead of fragmenting
the session. If a Codex surface does not support hooks, the fallback is explicit:
start with `node cdx.mjs state`, use the generated `source-command-*` skills or
`node cdx.mjs <command>`, and finish with `node cdx.mjs log-session`.

Codex hook output is host-shaped by `host-adapter.mjs`: advisories that would be
plain text on Claude become Codex JSON advisory payloads, and `apply_patch`
payloads are normalized into write paths before edit tracking or execution
guards reason over them.

## Model Routing

ADR-0052 routing is active on Codex. Dispatching skills call
`contextkit/tools/scripts/model-policy.mjs --host codex` before spawning a
subagent, and generated `.codex/agents/*.toml` files project Claude frontmatter
model tiers to Codex model overrides:

- `fast` -> `gpt-5.4-mini`
- `powerful` -> `gpt-5.4`
- `reasoning` -> `gpt-5.5`

Antigravity still reports the ADR-0052 host gap until that host exposes a model
override the kit can enforce.

## Build Pipeline

```bash
npm run build:codex
```

The build converts:

- `templates/claude/commands/**/*.md` -> `templates/codex/skills/source-command-*/SKILL.md`
- `templates/claude/agents/*.md` -> `templates/codex/agents/*.toml`

Selfcheck verifies name parity, byte-for-byte content parity against an
in-memory rebuild, model-tier projection, and the special host-specific
projections for `/token-report`, `/fable`, and `/claude-md`. If a Claude command
or agent changes and Codex is not regenerated, CI fails with the `build:codex`
hint.

Project-specific MCP rendering remains governed by ADR-0073. The Codex host can
wire MCP-shaped hook matchers (`mcp__.*`) once tools are invoked, but it does not
invent a project MCP configuration when no canonical project MCP source exists.

## Coexistence

- Claude Code reads `.claude/` and `CLAUDE.md`.
- Antigravity reads `.agents/` and `INSTRUCTIONS.md`.
- Codex reads `AGENTS.md`, `.codex/`, and project skills under `.agents/skills/`.

The three hosts share `contextkit/` memory, scripts, hooks, ADRs, sessions,
pipeline state, and changelog. The installer excludes generated Codex artifacts
through the managed `info/exclude` block, so dogfood installs stay local unless a
project opts into `--tracked`.

Codex must cooperate with Claude Code and Antigravity. A host never owns the
project alone: workspace claims, DevPipeline cards, ADRs, session ledgers, and
the changelog are the shared coordination substrate. If another active host owns
a file or task, Codex must coordinate or choose non-overlapping work.
