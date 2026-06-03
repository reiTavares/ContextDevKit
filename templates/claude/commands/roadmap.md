---
description: Create/manage the product roadmap (the what/why). New project: build it with the user. Existing: find or analyze→propose.
argument-hint: [show | new | from-existing | add | sync-pipeline]
---

# 🗺️ Roadmap

The product/business plan in `contextkit/memory/roadmap.md` — capabilities + milestones
(P-IDs), ordered by value. **Not** bugs/tasks/SLA (those are the DevPipeline). The
roadmap is **important** — keep it real and current.

First, get the facts: `node contextkit/tools/scripts/roadmap.mjs find --json`
(tells you if the canonical roadmap is defined, and lists any existing
roadmap/PRD/spec/vision files in the repo).

Act on **$ARGUMENTS**:

## show (default)
Read `contextkit/memory/roadmap.md`; summarize the phases, what's done/in-progress,
and the next highest-value milestone. If it's still the placeholder, say so and
offer to create it (→ `new` or `from-existing`).

## new — build it WITH the user (greenfield or undefined)
Co-create it, don't dump a template. Ask, in a short adaptive round:
- the product vision + primary user journey (reuse `contextkit/memory/product.md` if present);
- the few **outcomes** that matter first, and roughly in what order;
- any hard deadlines/constraints.
Then draft phases `P1, P2, …` with items `P1.1, P1.2, …` — each a user-facing
capability + a one-line acceptance note. Show it, refine with the user, save.

## from-existing — existing project
1. If `roadmap.mjs find` listed a roadmap/PRD/spec file → read it and **import /
   normalize** it into `contextkit/memory/roadmap.md` (P-ID format), keeping intent.
2. If nothing was found → **analyze** the codebase (structure, README,
   `product.md`, routes/features, open TODOs/issues) and **propose** a roadmap:
   what exists, gaps, and likely next milestones. Present it as suggestions.
3. Either way, **ask the user to add their own objectives** — turn each into a
   P-ID item. The roadmap must reflect their intent, not just your inference.

## add
Append a new milestone/item with the next P-ID and an acceptance note.

## sync-pipeline
Hand the next milestone to execution: `/pipeline from-roadmap` breaks it into
backlog tasks (cross-referenced by P-ID). Keep the non-duplication rule —
roadmap = capabilities; pipeline = the tasks to deliver them.

After any change, save `contextkit/memory/roadmap.md` and offer `/log-session`.
