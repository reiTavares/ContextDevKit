# Tutorial: From Idea to a Shipped Feature

<!-- GENRE: Tutorial (learning-oriented)
     Goal: the reader succeeds at something for the FIRST TIME.
     Voice: guide-beside — encouraging, sequential, explains every action.
     Test: run every command yourself before publishing. -->

## Overview

By the end of this tutorial you will have taken a feature idea through the full
ContextDevKit workflow spine: writing a product requirements document and a
technical spec, recording the architecture decision, seeding the pipeline with
tasks, implementing the change, and shipping it through a quality gate. You need
a project that has already been onboarded (see `getting-started.md`). Estimated
time: 45 minutes for a simple feature; more for a complex one.

## Prerequisites

- ContextDevKit installed and onboarded in your project (`/state` shows a
  non-empty baseline)
- Claude Code open in the project folder
- A concrete feature idea — something small and real works best for a first run
  (for example, "add a health-check endpoint" or "add CSV export to the report
  page")

## Step 1: Open a workflow spec pack

For any feature more complex than a one-line fix, ContextDevKit asks you to write
a brief spec before touching code. The workflow command creates a structured
folder that keeps the product requirements, technical design, decisions, and daily
reports in one place for the life of the feature.

Replace `csv-export` with a short kebab-case slug that names your feature:

```shell
node contextkit/tools/scripts/workflow.mjs new csv-export --kind feature
```

This creates:

```
contextkit/memory/workflows/csv-export/
  index.md      — lifecycle tracker
  prd.md        — WHAT and WHY (you fill this)
  spec.md       — HOW (you fill this)
  decisions.md  — links to ADRs born from this work
  tasks.md      — pipeline cards linked here
  memory.md     — scratchpad for context across sessions
```

Then open Claude Code and tell it to start the workflow:

```
/workflow new csv-export --kind feature
```

Claude reads the existing context pack (latest session, open roadmap items, recent
decisions) and starts filling `prd.md` by asking you targeted questions — the
product WHAT and WHY, goals, users, success metric, non-goals. Answer them; Claude
writes the file. This takes five minutes for a small feature.

## Step 2: Advance to the technical spec

Once the PRD is done, advance the workflow to the `spec` phase:

```
/workflow advance csv-export
```

Claude moves the `index.md` lifecycle marker from `prd` to `spec` and starts
filling `spec.md`: the technical approach, affected modules, interface changes,
test cases, and any open questions. It may run a brief deliberation (surfacing
trade-offs) before locking the design — you will see it if it does.

Review the spec output. Push back on anything that looks wrong or over-engineered;
this is the cheapest moment to change direction. When you are satisfied, confirm
and Claude marks the spec accepted.

You should now see both `prd.md` and `spec.md` populated under
`contextkit/memory/workflows/csv-export/`.

## Step 3: Record the architecture decision

If the spec contains a real design choice — a library, a data-model change, a new
module boundary — record it as an architecture decision before writing any code.
Decisions recorded here become searchable history that future sessions load
automatically.

```
/new-adr Add CSV export via streaming serializer
```

Claude drafts the ADR under `contextkit/memory/decisions/`, shows you the draft,
and asks for confirmation before marking it `Accepted`. A confirmed ADR also
generates a preview of the backlog tasks it implies — review them, prune any that
do not apply, then write them to the pipeline.

For a simple feature where no significant design choice is made, skip this step —
not every change needs an ADR.

## Step 4: Seed the pipeline with tasks

Translate the spec into concrete work cards on the DevPipeline board. Run the
add command for each task, linking it back to your workflow:

```shell
node contextkit/tools/scripts/pipeline.mjs add \
  --type feature \
  --priority P1 \
  --title "Implement CSV serializer module" \
  --workflow csv-export \
  --spec contextkit/memory/workflows/csv-export/spec.md
```

Repeat for each distinct task (for example, one for the serializer, one for the
route/controller, one for the UI button). Each card lands in
`contextkit/pipeline/backlog/` as a markdown file you can open and annotate.

Check the board to confirm the cards appeared:

```
/pipeline show
```

You will see a digest grouped by stage: `backlog / working / testing / conclusion`.
Your new cards should be in `backlog`.

## Step 5: Implement

Start the autonomous ship pipeline — it drives the full squad from design through
tests to a quality gate in one command:

```
/ship "Add CSV export with streaming serializer" 
```

Claude runs the delivery stages in order:

1. **Scope** — re-reads the context pack and confirms IN/OUT-OF-SCOPE.
2. **Design** — delegates to the `architect` agent; produces a recommended
   approach and blast radius.
3. **Plan tests** — delegates to `qa-orchestrator`; produces happy / edge /
   failure test cases for the feature.
4. **Implement** — routes to the appropriate domain agent(s) and writes the code,
   staying within the constitution (file size, single responsibility, naming rules).
5. **Self-review** — delegates to `code-reviewer`; blocks on any violation of the
   immutable rules.
6. **Test** — scaffolds and runs the test suite; signals a quality gate.

At each checkpoint (marked with a pause in the output) Claude stops and asks for
your approval before continuing. This is intentional — you remain in control of
every irreversible action. If you want it to proceed without pauses, pass
`--auto`; the gates then run automatically and stop only on a red result.

## Step 6: Observe the artifacts at each step

As `/ship` runs, watch the files it produces:

| Stage | Artifact |
|---|---|
| Scope | A scope summary printed inline |
| Design | Trade-off notes in the session context |
| Plan tests | Test plan in the session or linked from `spec.md` |
| Implement | Source files changed in your codebase |
| Self-review | Review notes (any blockers appear as inline comments) |
| Test | Test output; `contextkit/pipeline/<card-id>/` stamped `implemented` |

After all stages pass, `/ship` moves the relevant pipeline cards to `testing`
and prints a summary of what shipped, test results, and any follow-ups.

## Step 7: Register the session

Once the feature is through the quality gate, close out the session:

```
/log-session
```

Claude drafts the session from the ledger (files changed, tasks moved, ADRs
created), rewrites it into a factual narrative, and adds entries to
`docs/CHANGELOG.md` under `## [Unreleased]`. The workflow report is also pulled
in, so the session file references the specific tasks and diff stats rather than
a generic "worked on X" summary.

After this step the memory layer is fully updated: the ADR is indexed, the
pipeline reflects the new `testing` state, and the session is searchable history.

## What you built

You walked the full workflow spine: opened a spec pack, wrote a product
requirements document and a technical spec, recorded an architecture decision,
seeded the pipeline with tasks, ran the autonomous ship pipeline through design
and implementation and testing, and registered the session. Each artifact — ADR,
pipeline cards, session file, CHANGELOG entry — persists as searchable, linked
history that the kit loads automatically in future sessions.

## Next steps

- Move the cards from `testing` to `conclusion` after QA sign-off:
  `docs/reference/pipeline.md`
- Cut a release once the `[Unreleased]` block is ready:
  `/close-version`
- Run a retrospective on the workflow to surface process improvements:
  `/retro`
