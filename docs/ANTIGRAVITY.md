# Antigravity host integration

Antigravity uses `INSTRUCTIONS.md` plus generated assets under `.agents/`.
Canonical sources remain under `templates/claude/`; the Antigravity tree is a
projection and is regenerated, not edited by hand.

## Installed surface

- `INSTRUCTIONS.md`
- `.agents/hooks.json`
- `.agents/agents/*.md`
- `.agents/skills/**/*.md`
- `.agents/workflows/**/*.md`
- `.agents/playbooks/**/*.md`

The hook projection uses the same single-process governance dispatchers as
Claude and Codex. `governance-session-context.mjs` supplies read-only context;
prompt, write, postflight, and completion each invoke their one canonical
dispatcher. There is no host session marker, edit ledger, or hidden autonomy
state.

## Regeneration and parity

```text
node templates/contextkit/runtime/antigravity/convert-all.mjs --templates
node templates/contextkit/tools/scripts/host-parity.mjs --check
```

Regeneration removes orphan projections. A missing graph, agent recommendation,
or optional context never prevents ordinary search or owner-authorized work.

## Shared state

All hosts read the same workflow and task JSON authorities. Explicit workspace
claims use `.claude/.workspace/` as a host-neutral local coordination boundary;
they are warnings, not task-status authority.
