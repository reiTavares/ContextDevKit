---
name: "source-command-dashboard"
description: "Visual dashboard — pipeline lanes + ADRs + sessions + roadmap + CHANGELOG. Snapshot HTML by default; live SSE-driven view with --watch."
---

# source-command-dashboard

Use this skill when the user asks to run the migrated source command `dashboard`.

## Command Template

# 📊 Dashboard

A single-file HTML view of the project's current state. Pipeline lanes
(backlog / working / testing / concluded), the ADR catalogue, recent
sessions, the roadmap, and the `[Unreleased]` CHANGELOG — all rendered
from the existing files. Zero deps; pure `node:` stdlib.

## Two modes — one command

### Snapshot (default)

```
node contextkit/tools/scripts/dashboard.mjs                    # writes ./dashboard.html
node contextkit/tools/scripts/dashboard.mjs --out=tmp/state.html
```

Writes a self-contained HTML file and exits. Inline CSS + JS, no external
assets — opens by double-click, works offline, survives without the kit
installed. Use this for share-by-email or commit-to-PR-preview.

### Live (`--watch`)

```
node contextkit/tools/scripts/dashboard.mjs --watch            # serves http://127.0.0.1:4242
node contextkit/tools/scripts/dashboard.mjs --watch --port=8080
CONTEXTDEVKIT_DASHBOARD_PORT=5555 node contextkit/tools/scripts/dashboard.mjs --watch
```

Spawns a tiny `node:http` server bound to **127.0.0.1 only** (no network
access). The page subscribes to `/events` via Server-Sent Events; an
`fs.watch` on `contextkit/` (200 ms debounced) triggers a rebuild and pushes
the new data object. The client patches the DOM in place — no full
reload. Ctrl+C to stop.

## What it shows

- **Counts strip** — totals per lane.
- **Pipeline (4-column kanban)** — every ticket as a card with id, type
  badge, priority badge, SLA, source. Sorted by id within each lane.
- **Recent ADRs** — the 12 newest, status colour-coded.
- **Recent sessions** — the 10 newest, with branch.
- **`[Unreleased]` CHANGELOG** — collapsible.
- **Roadmap** — collapsible, only if `contextkit/memory/roadmap.md` exists.

## What it does NOT do

- **No edit-in-place.** Read-only by design.
- **No remote access.** 127.0.0.1 only — no `0.0.0.0`, no auth, no TLS.
- **No multi-project.** Use `/fleet` for the portfolio view.
- **No JS framework.** Inline vanilla JS in the page; no React, no Vite,
  no `node_modules` to install.
- **No persistent state.** Every render re-reads the files.

## When to use it

- **During a session** — `--watch` in a second pane, edits in the editor,
  the board updates as you move tickets between lanes.
- **End of session** — snapshot to attach to a `/log-session` summary or
  a PR description.
- **Reviewing someone else's progress** — open the snapshot file they
  committed (no install required).
