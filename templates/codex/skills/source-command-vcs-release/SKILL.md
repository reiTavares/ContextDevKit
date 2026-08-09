---
name: "source-command-vcs-release"
description: "Release this session's claim(s) — a specific path, or all of them."
---

# source-command-vcs-release

Use this skill when the user asks to run the migrated source command `release`.

## Command Template

> ℹ️ **Paired with `/claim`** (claim → work → release). Manage both as one flow;
> this command does the release half.

Release path claims for this session.

- To release a specific path: `node contextkit/tools/scripts/release.mjs $ARGUMENTS`
- To release everything (no argument): `node contextkit/tools/scripts/release.mjs`

Run the appropriate command based on whether `$ARGUMENTS` is empty, then confirm to the user what
was released. This also regenerates `contextkit/memory/WORKSPACE.md`.
