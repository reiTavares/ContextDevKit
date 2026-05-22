# Contributing to VibeDevKit

Thanks for improving VibeDevKit. It's intentionally small and dependency-free —
keep it that way.

## Ground rules

- **Zero runtime dependencies on the hot path.** The hooks (Levels 1–3) must run
  in a brand-new project with nothing installed. No npm packages in
  `templates/vibekit/runtime/hooks/**` or `runtime/config/load.mjs`. `zod` is
  allowed only behind an optional dynamic import (see `schema.mjs`).
- **Hooks never break real work.** Every hook exits 0 on error and stays silent
  unless it has something to say. Defensive I/O, always.
- **The platform folder name lives in one place.** `PLATFORM_DIR` in
  `templates/vibekit/runtime/config/paths.mjs`. Don't hardcode `vibekit/`
  elsewhere if a constant exists.
- **Keep it portable.** No bash-isms in `.mjs`; use `node:*` APIs. Strip a BOM
  before `JSON.parse`. Forward-slash paths in config.

## Project layout

- `install.mjs` — the installer (also the `npx`/`bin` entry).
- `templates/` — everything copied into a target project (`claude/` → `.claude/`,
  `vibekit/`, `CLAUDE.md.tpl`, `docs/CHANGELOG.md.tpl`, `gitattributes`).
- `tools/` — kit-dev tooling: `selfcheck.mjs` (static), `integration-test.mjs`
  (real hooks end-to-end).
- `docs/` — LEVELS, ARCHITECTURE, CUSTOMIZING.

## Before you push

```bash
npm test        # selfcheck + integration test
```

Both must pass. CI runs them on Node 18/20/22. If you add a hook, slash command,
script, or change the level wiring, **add a check** to `tools/selfcheck.mjs` or
`tools/integration-test.mjs` that would fail if it regressed.

## Adding things

- **Slash command** → `templates/claude/commands/<name>.md` (frontmatter
  `description` + prompt body; `$ARGUMENTS` interpolates).
- **Sub-agent** → `templates/claude/agents/<name>.md` from `_TEMPLATE.md`; sharp,
  narrow `description` (that's how routing works).
- **Engine change** → keep files under the 280-line constitution; update the
  relevant doc and add a test.

## Commits

Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`,
`ci:`). The kit ships its own `commit-msg` hook that enforces this in installed
projects — please follow it here too.
