---
name: "source-command-context-budget"
description: "Context budget — guidance on WHICH context files to load per task type (always / on-demand / skip) to keep token cost low. Read-only advice. (ADR-0066)"
---

# source-command-context-budget

Use this skill when the user asks to run the migrated source command `context-budget`.

## Command Template

# 🎯 Context Budget

Loading **every** memory file into context on every task is the most common way a
session goes token-heavy. This is **read-only guidance** — it changes nothing on
disk. It tells you *which* context to pull in for the task at hand, so the boot
context stays lean and `/token-report` trends cool.

The discipline is a three-tier budget per task type:

- **ALWAYS** — load up front; the task is unsafe or aimless without it.
- **ON-DEMAND** — pull in *only* when the task actually touches that area. Use the
  lightweight loading primitive (below) rather than re-reading wholesale.
- **SKIP** — leave it out unless something explicitly points you to it. Loading it
  "just in case" is pure token cost with no payoff.

This complements the *measurement* commands — `/token-report` (per-session/week
token aggregation) and the `token-attribution.mjs` script (where the tokens went).
This command is the *prevention* side: spend fewer tokens in the first place.

## The loading primitive: `@`-imports

On **Codex**, an `@`-import pulls a file into context on demand and is the
cheapest way to load a reference doc exactly when you need it:

```
@contextkit/best-practices.md
@contextkit/behaviors.md
```

Codex resolves these relative to the file that contains them (e.g.
`AGENTS.md` at the project root), so the paths above point at the installed kit
artifacts. Prefer one targeted `@`-import over re-reading a whole tree.

> **Cross-host note (ADR-0066 trade-off):** the `@`-import is a Claude-Code
> feature. On **Antigravity** and **Codex** the converted skill keeps the same
> lines as **plain textual references** — they read as "open this file" rather
> than auto-resolving. The guidance is identical; only the loading mechanism
> differs by host.

## Per-task-type budget

The artifacts referenced below all exist in an installed project:
`AGENTS.md` (root constitution), `contextkit/best-practices.md`,
`contextkit/behaviors.md` (+ `behaviors-examples.md`),
`contextkit/memory/decisions/` (ADRs — the *why*),
`contextkit/memory/sessions/` (the *what changed*, one file per session) and its
index `contextkit/memory/SESSIONS.md`, `contextkit/memory/GLOSSARY.md`
(UI ↔ code naming), `contextkit/memory/project-map/00-index.md` (the *where* —
durable structural map), `.context-snapshot.md` (full dynamic snapshot), and
`docs/CHANGELOG.md`.

### 🐛 Bugfix

| Tier | Load |
| --- | --- |
| **ALWAYS** | `AGENTS.md`; the **specific file(s)** under suspicion; the failing test or repro. |
| **ON-DEMAND** | `@contextkit/memory/GLOSSARY.md` if the bug spans a domain term; the latest matching entry in `contextkit/memory/sessions/` if the area was touched recently; the one ADR that governs the buggy subsystem. |
| **SKIP** | The full `.context-snapshot.md`, the whole ADR set, the project-map, `docs/CHANGELOG.md`. A bug is local — pull terrain only if the repro is non-local. |

### ✨ New feature

| Tier | Load |
| --- | --- |
| **ALWAYS** | `AGENTS.md`; `contextkit/memory/project-map/00-index.md` (orient before adding); any ADR that constrains the feature's area. |
| **ON-DEMAND** | `@contextkit/best-practices.md` when writing non-trivial code; `@contextkit/memory/GLOSSARY.md` before coining an identifier; the relevant `contextkit/memory/sessions/` entry for adjacent recent work. |
| **SKIP** | `.context-snapshot.md` in full, `docs/CHANGELOG.md`, ADRs for unrelated subsystems. |

### ♻️ Refactor

| Tier | Load |
| --- | --- |
| **ALWAYS** | `AGENTS.md` (the file-size + SRP + layering rules drive the refactor); `contextkit/memory/project-map/00-index.md` (blast radius); the file(s) being refactored. |
| **ON-DEMAND** | `@contextkit/best-practices.md`; the ADR that justifies the current structure (so you don't undo a deliberate decision); `/simulate-impact` for a high-risk path. |
| **SKIP** | `contextkit/memory/sessions/` history, `docs/CHANGELOG.md`, unrelated ADRs. |

### 📝 Docs

| Tier | Load |
| --- | --- |
| **ALWAYS** | the doc file(s) being edited; `AGENTS.md` §Language policy + §Documentation. |
| **ON-DEMAND** | `@contextkit/memory/GLOSSARY.md` for naming consistency; the source file you're documenting. |
| **SKIP** | ADRs, `.context-snapshot.md`, the project-map, sessions history, `contextkit/best-practices.md`. Docs work rarely needs deep code context. |

### 🔍 Review

| Tier | Load |
| --- | --- |
| **ALWAYS** | the **diff** under review; `AGENTS.md` (the constitution is the rubric). |
| **ON-DEMAND** | `@contextkit/best-practices.md`; `@contextkit/behaviors.md` for *how* the change was made; the ADR governing the changed area; the matching `contextkit/memory/sessions/` entry. |
| **SKIP** | The full `.context-snapshot.md`, the whole ADR set, unrelated modules from the project-map. |

## How to apply it

1. **Classify the task** first — bugfix / feature / refactor / docs / review.
2. Load the **ALWAYS** tier and start.
3. Pull **ON-DEMAND** items with an `@`-import (Codex) or by opening the
   named file (other hosts) **only when the work reaches that area** — never
   pre-emptively.
4. Leave the **SKIP** tier out. If you find yourself reaching for it, that's a
   signal the task is broader than you classified it — re-scope, don't bulk-load.

## Why this matters

- **Cheaper sessions** — fewer full-file reads is the single biggest lever on
  `tokens.budgetPerSession`; verify the effect with `/token-report`.
- **Sharper context** — a lean window keeps the model on-task; a bloated one
  buries the signal.
- **Composable** — pairs with `/dev-start` (lock the scope) and `/token-report`
  (measure the result). Budget, then measure, then tighten.

> Guidance only. This command never edits a file — it tells you what *not* to load.
