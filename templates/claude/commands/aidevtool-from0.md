---
description: Bootstrap a brand-new (empty) project from zero — product idea, interactive questionnaire, stack suggestion, roadmap, best practices.
argument-hint: [one-line idea]
---

# 🌱 AI Dev Tool — Start from Zero

Use this when the project is **empty** (no code yet). If there's already a
codebase, use `/setupvibedevkit` instead. Goal: go from a blank folder to a
project with a clear product vision, a stack, a roadmap, the best-practices
constitution, and an initialized DevPipeline — by **actively** interviewing the
user and suggesting, not just scaffolding.

First confirm it's greenfield: run `node vibekit/tools/scripts/detect-stack.mjs`
and check `greenfield: true` / no `sourceDirs`. If it's not empty, stop and point
to `/setupvibedevkit`.

## Phase 1 — Intelligent product questionnaire (interactive)

Ask a focused, **smart** set of questions — adapt follow-ups to the answers, do
not dump a static form. Cover:
1. **What is the app?** Problem it solves, who it's for, the core value.
2. **The core user journey** (the one flow that must be great).
3. **Platform**: web / mobile / desktop / CLI / API / library?
4. **Scale & constraints**: expected users, budget, deadlines, team size, any
   hard constraints (offline, on-prem, regulation like LGPD/GDPR)?
5. **Tech preferences**: do they already have stack ideas, or want a suggestion?
6. **Audience language** for UI text.

Summarize your understanding back and get a thumbs-up before proceeding.

## Phase 2 — Product vision

Write `vibekit/memory/product.md`: one-paragraph vision, target user, core value,
the primary journey, non-goals. Short and sharp.

## Phase 3 — Stack: suggest or refine

If they gave a stack, sanity-check it against the requirements and note risks. If
they want a suggestion, propose **one** recommended stack with a short rationale
and 1–2 alternatives + trade-offs (act like `architect`). Record the choice as
`/new-adr "Stack: <summary>"` (ADR-0001). Don't over-engineer for imagined scale.

## Phase 4 — Roadmap (product/business)

Write `vibekit/memory/roadmap.md`: phases/milestones with **P-IDs** (P1.x, P2.x…),
each a user-facing capability with a one-line acceptance note, ordered by value.
This is the *what/why* of the product — NOT bugs or CI tasks (those live in the
DevPipeline).

## Phase 5 — Best practices (the constitution)

Offer to adopt the vibe-coding best practices in `vibekit/best-practices.md`
(280-line rule + **intelligent** refactoring — split by responsibility, never
random; SoC; naming; errors; docs). On yes, fill the constitution section of
`CLAUDE.md` accordingly and set `practices.active = true` via `/vibe-config`.

## Phase 6 — Initialize execution

Seed the DevPipeline from the roadmap: break the first milestone into a few
concrete backlog tasks —
`node vibekit/tools/scripts/pipeline.mjs add --type feature --priority P1 --title "..." --roadmap P1.1`.

## Phase 7 — Set level & finish

Recommend a starting level (usually L2; L4+ if it'll be a team). Run
`node vibekit/tools/scripts/setup-complete.mjs` to clear the first-run trigger,
then `/log-session`. Report: product, stack (+ADR), roadmap, pipeline seeded,
level. The platform stays **active** — as the roadmap grows, suggest the next
practice/level. Empty project today, opinionated project tomorrow.
