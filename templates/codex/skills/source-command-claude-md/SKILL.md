---
name: "source-command-claude-md"
description: "Ensure every app/module has its own scoped CLAUDE.md, then fill each with real local rules."
---

# source-command-claude-md

Use this skill when the user asks to run the migrated source command `claude-md`.

## Command Template

# 📁 Modular AGENTS.md

Like a well-run monorepo (root `AGENTS.md` + `apps/api/AGENTS.md` +
`apps/web/AGENTS.md` …), each app / independent module should carry its **own**
scoped `AGENTS.md`. Codex loads the closest one, so local rules live next to
the code — clearer, more accurate guidance per area.

1. **Detect** module roots:
   ```
   node contextkit/tools/scripts/claude-md.mjs find
   ```
   It finds split dirs (`backend/`, `frontend/`, `api/`, `web/`, `mobile/`, …) and
   monorepo group children (`apps/*`, `packages/*`, `modules/*`, `services/*`) that
   look independently buildable, and shows which lack a `AGENTS.md`.

2. **Scaffold** the missing ones (stubs, won't overwrite):
   ```
   node contextkit/tools/scripts/claude-md.mjs scaffold
   ```

3. **Fill each one with real, local content** (this is the important part — don't
   leave the TODOs). For every scoped `AGENTS.md`, read that module and write:
   - what it is + its single responsibility (backend/frontend/lib/service);
   - its local stack/tooling;
   - **local conventions** that differ from the root (folder layout, where logic
     goes, the public surface to keep stable);
   - boundaries (depends on / consumed by).
   Keep it lean and inheriting the root constitution — don't duplicate it.

Run on `$ARGUMENTS` (default: do `find`, then offer `scaffold` + fill). For a
single-package project with no sub-modules, the root `AGENTS.md` is enough — say so.
