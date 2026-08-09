# Skill: release

> Release this session's claim(s) — a specific path, or all of them.
> Argument: [path]
> ℹ️ **Paired with `/claim`** (claim → work → release). Manage both as one flow;
> this command does the release half.

Release path claims for this session.

- To release a specific path: `node contextkit/tools/scripts/release.mjs <user-specified argument>`
- To release everything (no argument): `node contextkit/tools/scripts/release.mjs`

Run the appropriate command based on whether `<user-specified argument>` is empty, then confirm to the user what
was released. This also regenerates `contextkit/memory/WORKSPACE.md`.
