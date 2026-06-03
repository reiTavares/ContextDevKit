---
description: Workflow macro — chain /roadmap → /new-adr → /pipeline → /ship into one explicit narrative. (ticket 041)
argument-hint: "new <slug> | advance <slug> [ref] | status [<slug>] | resume <slug>"
allowed-tools: Bash(node:*)
---

`/workflow` is a **thin macro** over the primitives the kit already ships.
It doesn't merge `/roadmap`, `/new-adr`, `/pipeline`, or `/ship` — it just
keeps a breadcrumb so a multi-day, multi-session feature lifecycle reads as
one story instead of four disconnected commands.

## When to use

- A feature is big enough to deserve a roadmap entry **and** an ADR **and**
  pipeline tickets **and** a ship pass.
- You want to be able to come back tomorrow (or on another machine) and
  read "where did I stop?" in one place.
- You want `/dev-start` to find the right scope for the next sub-session.

## The four phases

1. **roadmap** — product slice / what & why
2. **adr** — technical decision (architecture, dependency, pattern)
3. **tickets** — break the ADR's follow-ups into DevPipeline tasks
4. **ship** — implement, test, log

## How

### Start a workflow

```
node vibekit/tools/scripts/workflow.mjs new <slug>
```

Then run `/roadmap add …` yourself. Once the roadmap entry is recorded:

```
node vibekit/tools/scripts/workflow.mjs advance <slug> <roadmap-section-ref>
```

…which marks `roadmap` done and points you at `adr`. Repeat for each phase.

### Check status

List all in-flight workflows:

```
node vibekit/tools/scripts/workflow.mjs status
```

Show one:

```
node vibekit/tools/scripts/workflow.mjs status <slug>
```

`--json` for machine-readable output.

### Resume from another session / machine

```
node vibekit/tools/scripts/workflow.mjs status <slug>
```

The breadcrumb file (`vibekit/memory/workflows/<slug>.md`) carries the full
history. The current phase is the resume point — invoke the matching native
command (`/new-adr`, `/pipeline add`, `/ship`) and then `advance` when done.

## What `/workflow` does NOT do

- It does **not** auto-invoke `/roadmap`, `/new-adr`, `/pipeline`, or `/ship`.
  Each phase is an explicit user action (rule 9 — build what is asked).
- It does **not** chain phases silently. Every `advance` is a confirmation.
- It does **not** know which ADR or which tickets belong to which workflow —
  you pass the ref (e.g. `ADR-0023`, `[052,053]`) when advancing.

## Breadcrumb file

Path: `vibekit/memory/workflows/<slug>.md`. Schema is YAML-ish frontmatter
parsed by hand (no `yaml` dep). One file per slug. The body keeps a bullet
history of phase transitions for human inspection — you can hand-edit it
without breaking the parser.

The directory ships seeded (`.gitkeep`); files are written lazily by the
script when you call `new`.
