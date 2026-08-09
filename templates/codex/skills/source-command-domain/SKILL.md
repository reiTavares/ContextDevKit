---
name: "source-command-domain"
description: "Domain Engineering diagnostic — optional CMIS/DAS/profile recommendations. Observation-only; never mutates or blocks."
---

# source-command-domain

Use this skill when the user asks to run the migrated source command `domain`.

## Command Template

`/domain` is an observation-only diagnostic. It classifies an objective and shows
optional profile, agent, skill, artifact, and simulate-impact recommendations.
It does not dispatch an agent, create a packet or receipt, or gate a write.

Use it when a human wants to inspect or calibrate Domain Engineering suggestions:

```bash
node contextkit/tools/scripts/domain-inspect.mjs "<objective>"
node contextkit/tools/scripts/domain-inspect.mjs "<objective>" --json
```

The command reuses `buildImplementationBlock`; `recommendationsOnly: true` is a
public invariant. Missing policy produces an honest degraded result and the active
agent continues.

From Codex use this slash command. Antigravity and Codex call the same
host-neutral script through their generated projection.
