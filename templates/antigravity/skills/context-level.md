# Skill: context-level

> Show or change the ContextDevKit activation level (1–7).
> Argument: [1-7]
Inspect or change the ContextDevKit level for this project.

- **Show current level + what each enables**: `node contextkit/tools/scripts/context-level.mjs`
- **Change level** (e.g. to 3): `node contextkit/tools/scripts/context-level.mjs <user-specified argument>`

Changing the level updates `contextkit/config.json` and recomposes `.claude/settings.json` hook wiring
(and installs git hooks at Level ≥ 3). Run the appropriate command based on `<user-specified argument>`, show the
output, and remind the user to **restart Claude Code** so it reloads the hooks.

Levels: 1 Memory · 2 Ledger (drift) · 3 Multi-session · 4 Squads (agents) · 5 Proactive (gates)
· 6 Autonomy & Insight · 7 Ecosystem & Scale. (6–7 are capability tiers — no new hook.)
Going up adds capability; going down cleanly removes the now-disabled hooks.
