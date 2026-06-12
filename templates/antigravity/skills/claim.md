# Skill: claim

> Reserve path(s) for this session so parallel sessions get a cross-claim warning.
> Argument: <path1> [path2 ...]
Reserve the following path(s) for this session: **<user-specified argument>**

Run:

```
node contextkit/tools/scripts/claim.mjs <user-specified argument>
```

This records the claim in `.claude/.workspace/<sid>.json` and regenerates
`contextkit/memory/WORKSPACE.md`. Any OTHER active Claude session that edits inside a claimed path
will see a cross-claim warning from the PostToolUse hook.

Confirm to the user which paths are now claimed. Release them at the end with `/release`.
