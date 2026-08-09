---
name: "source-command-vcs-claim"
description: "Reserve path(s) for this session so parallel sessions get a cross-claim warning."
---

# source-command-vcs-claim

Use this skill when the user asks to run the migrated source command `claim`.

## Command Template

Reserve the following path(s) for this session: **$ARGUMENTS**

Run:

```
node contextkit/tools/scripts/claim.mjs $ARGUMENTS
```

This records the claim in `.claude/.workspace/<sid>.json` and regenerates
`contextkit/memory/WORKSPACE.md`. Any OTHER active Claude session that edits inside a claimed path
will see a cross-claim warning from the PostToolUse hook.

Confirm to the user which paths are now claimed. Release them at the end with `/release`.
