---
description: Deterministic, stack-agnostic structural map of the project (modules, frontend/backend, symbol inventory) — durable memory the agent reads instead of re-exploring.
argument-hint: [--check]
---

Build (or refresh) a **durable structural map** of THIS project so you orient from a cheap index
instead of re-greping the tree every session. ZERO AI tokens — a deterministic filesystem scan does
the work; you just read and summarize the result.

## Generate / refresh the map

```
node contextkit/tools/scripts/project-map.mjs
```

This writes, under `contextkit/memory/project-map/` (committed — durable memory):

- **`00-index.md`** — one-screen overview: detected stack, the module table (each classified
  🎨 frontend / ⚙️ backend / 🔗 shared / 🛠️ config / 🧪 tests), file counts, data layer. **Read this first.**
- **`01-modules.md`** — per-module detail grouped by role.
- **`02-inventory.md`** — sampled exported symbols per module (a navigation aid, not exhaustive).
- **`manifest.json`** — signature + `generatedAt`; powers the boot staleness nudge.

After running, **read `00-index.md`** and give the user a 3–5 line summary: how many modules, the
frontend/backend split, the stack, and anything surprising.

## Check for staleness

```
node contextkit/tools/scripts/project-map.mjs --check
```

Compares the current tree signature against the saved one and reports fresh vs **stale** (exit 0).
Add `--strict` to exit 1 when stale (useful in CI). The SessionStart boot context also nudges you
automatically when the map is older than your newest source edit.

## When to run it

- After a `/setupcontextdevkit` on an existing project — establishes the baseline map.
- After adding/removing a module, a big refactor, or a new frontend/backend area.
- Whenever the boot context flags **🗺️ Project map is stale**.

The map is committed memory: it travels in the repo and survives across sessions and clones. It does
**not** replace ADRs (the *why*) or sessions (the *what changed*) — it is the *where* (the terrain).
