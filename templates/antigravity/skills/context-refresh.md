# Skill: context-refresh

> Regenerate the dynamic full-project snapshot (.context-snapshot.md).
> ⚠️ **Deprecated (1.0):** prefer **the `audit` skill** (or the auto boot context). This
> still regenerates the on-demand snapshot.

Regenerate the on-demand project snapshot:

```
node contextkit/tools/scripts/generate-context.mjs
```

This writes `.context-snapshot.md` (gitignored) containing the folder tree, detected stack, latest
session, CHANGELOG `[Unreleased]`, and a glossary excerpt.

Use it before a large refactor (so you can see the whole project at once), or to paste into another
AI that lacks the boot hook. After running, read `.context-snapshot.md` and give the user a 3-line
summary of what it captured.
