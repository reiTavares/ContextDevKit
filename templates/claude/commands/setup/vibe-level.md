---
description: Show or change the VibeDevKit activation level (1–7).
argument-hint: [1-7]
---

Inspect or change the VibeDevKit level for this project.

- **Show current level + what each enables**: `node vibekit/tools/scripts/vibe-level.mjs`
- **Change level** (e.g. to 3): `node vibekit/tools/scripts/vibe-level.mjs $ARGUMENTS`

Changing the level updates `vibekit/config.json` and recomposes `.claude/settings.json` hook wiring
(and installs git hooks at Level ≥ 3). Run the appropriate command based on `$ARGUMENTS`, show the
output, and remind the user to **restart Claude Code** so it reloads the hooks.

Levels: 1 Memory · 2 Ledger (drift) · 3 Multi-session · 4 Squads (agents) · 5 Proactive (gates)
· 6 Autonomy & Insight · 7 Ecosystem & Scale. (6–7 are capability tiers — no new hook.)
Going up adds capability; going down cleanly removes the now-disabled hooks.
