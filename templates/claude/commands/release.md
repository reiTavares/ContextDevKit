---
description: Release this session's claim(s) — a specific path, or all of them.
argument-hint: [path]
---

Release path claims for this session.

- To release a specific path: `node vibekit/tools/scripts/release.mjs $ARGUMENTS`
- To release everything (no argument): `node vibekit/tools/scripts/release.mjs`

Run the appropriate command based on whether `$ARGUMENTS` is empty, then confirm to the user what
was released. This also regenerates `vibekit/memory/WORKSPACE.md`.
