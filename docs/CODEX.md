# Codex host integration

ContextDevKit projects expose Codex through generated files. Canonical sources
remain under `templates/claude/`; `templates/codex/` is a generated projection.

## Installed surface

- `AGENTS.md`: host-neutral operating contract.
- `.codex/hooks.json`: ContextDevKit event projection plus preserved user hooks.
- `.codex/agents/*.toml`: generated specialist profiles.
- `.agents/skills/source-command-*/SKILL.md`: generated command skills.

The host composer registers one ContextDevKit process for each matching event:

| Event | Dispatcher |
| --- | --- |
| `SessionStart`, `PreCompact`, `SubagentStart` | `governance-session-context.mjs` |
| prompt preflight | `governance-prompt-preflight.mjs` |
| write preflight | `governance-write-preflight.mjs` |
| postflight | `governance-postflight.mjs` |
| completion | `governance-completion.mjs` |

Session context is read-only. ContextDevKit does not create a per-turn edit
ledger or require a global model-routing receipt. Model and specialist selection
are recommendations; Codex may continue with the active agent.

## Regeneration

Edit canonical Claude command/agent sources, then run:

```text
node templates/contextkit/runtime/codex/convert-all.mjs --templates
node templates/contextkit/tools/scripts/host-parity.mjs --check
```

The converter removes orphaned generated files. Never hand-edit a generated TOML
or Codex skill.

## State authority

Workflow identity is in `workflow.json`, aggregate execution state in
`workflow-state.json`, and task definition/status in `pipeline/tasks.json`.
Codex projections, Markdown, dashboards, and filesystem folders never replace
those JSON authorities.
