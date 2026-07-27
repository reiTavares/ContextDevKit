# Tutorial: your first business case

## Overview

By the end of this tutorial you will have created a business context on disk, read
the governance gate's honest verdict on it, and opened a workflow nested underneath
it — the point at which real work becomes governed work.

You need a shell, Node.js, and a project with ContextDevKit installed. You do not
need to understand the methodology yet; this page explains each action as it happens.
Estimated time: 15 minutes.

Every command here is read-only or dry-run except the two marked as applying a
change. Run them from the repository root, in order, once.

## Prerequisites

- ContextDevKit installed in a project — see [install and choose a level](../how-to/install-and-choose-a-level.md).
- Node.js 18 or newer available as `node`.
- A shell opened at the repository root.

## Step 1: check the toolchain answers

Before classifying anything, confirm the platform is wired up. Both commands read
only; neither changes a file.

```bash tutorial-step
node contextkit/tools/scripts/doctor.mjs
```

You should see a list of checks with a leading marker and a label — the Node version,
the config validity and level, hook wiring, and the git hook. Warnings are fine here;
they name a repair and do not stop you.

```bash tutorial-step
node contextkit/tools/scripts/work.mjs intake --check --json
```

You should see a receipt whose detail reads `"ready": true` with the reason
`work-classification policy loaded`. That is the classifier confirming it can find its
policy. If it says `ready: false`, stop and fix that first — every classification
after this point would be guesswork.

## Step 2: classify an objective

Intake is the first ceremony. It reads a plain-language objective and resolves what
kind of work it is. It writes nothing.

```bash tutorial-step
node contextkit/tools/scripts/work.mjs intake "Create a self-serve onboarding capability so small teams can start without a sales call" --json
```

Look at four fields inside `detail`:

- `nature` — either `operation` or `business`. A business creates or changes a durable strategic capability; an operation fixes, maintains, or executes inside something that already exists.
- `tier` — `trivial`, `feature`, or `architectural`. This is what decides how much ceremony the work pays.
- `executionMode` — `direct`, `batch`, or `workflow`.
- `needsClarification` — when `true`, a `clarifyQuestion` comes with it.

On this objective you will likely see `nature: "operation"` together with
`needsClarification: true`. That is not a bug, and it is worth pausing on: the
classifier scores weighted signal words and neither nature cleared its threshold
confidently, so instead of guessing it asked you the question and recorded the
conservative default. An operation can be promoted to a business later; a business
misfiled as routine work would have quietly skipped its own approval.

Intake advises. You decide. We are treating this objective as a new durable
capability, so the next step creates a business context.

## Step 3: preview the business context

Every command that writes is dry-run by default. Run the preview first and read what
it plans to do.

```bash tutorial-step
node contextkit/tools/scripts/work.mjs business "Self-serve onboarding for small teams" --kind FEATURE --ceremony decision --intent CREATE
```

The output opens with `would write (dry-run; pass --apply)` and then lists eight paths.
Three of them are the case itself, and they are the reason this methodology exists:

- `business-case.md` — the problem and the value hypothesis.
- `growth.md` — the model behind the expected change.
- `investment-decision.md` — what the work is worth, and on what evidence.

Alongside them, `business.json` is the machine-readable envelope, and
`ceremony/decision-only/` is the ceremony directory for the `decision` ceremony you
chose. Nothing has been written yet.

The three flags are worth knowing. `--kind` is required and closed to five values
(`TRANSFORMATION`, `INITIATIVE`, `PROGRAMME`, `FEATURE`, `ENABLER`). `--ceremony` is
either `decision` for a single governed decision or `workflow` for a multi-workflow
programme. `--intent` is why the work has value — here, `CREATE`.

## Step 4: apply it

This is the first command that changes your project.

```bash tutorial-step
node contextkit/tools/scripts/work.mjs business "Self-serve onboarding for small teams" --kind FEATURE --ceremony decision --intent CREATE --apply
```

The verb changes from `would write` to `wrote`, over the same eight paths. The whole
context is published through a single atomic rename, so you never observe a
half-written case.

Read the identifier out of that receipt. In an empty project it is `BIZ-0001`; in a
project that already has business contexts, the allocator gives you the next free one
across every worktree. The rest of this tutorial writes `BIZ-0001` — substitute the
identifier your receipt actually printed.

## Step 5: read the gate's verdict

Now ask the platform what it thinks of what you just made.

```bash tutorial-step
node contextkit/tools/scripts/work.mjs validate --id BIZ-0001 --json
```

You should see `"valid": true` with an empty `errors` array. The context is
structurally sound.

```bash tutorial-step
node contextkit/tools/scripts/work.mjs status --id BIZ-0001 --json
```

Here you should see `gate.pass` set to `false`, with `gate.reasons` naming three
things: the status is still `draft` rather than human-approved, no approval actor is
stamped, and no governing decision is attached.

That failing gate is the correct result, and understanding why is the point of this
step. Nobody has approved this case yet. A gate that passed here would mean the
platform accepts unapproved work, and approval is the one thing an AI agent can never
perform on its own — it requires a human actor, at every autonomy level, with no
configuration that weakens it. The gate is not complaining about your typing. It is
reporting the truth about where the case stands.

## Step 6: open a workflow under the case

A workflow carries the actual execution ladder. The owner flag is what nests it inside
the case, which is how execution stays attached to the case that justified it.

```bash tutorial-step
node contextkit/tools/scripts/workflow.mjs new onboarding-first-slice --business BIZ-0001
```

You should see `Workflow "onboarding-first-slice" created. Next phase: intake.` The
workflow number was allocated from a single global sequence — one shared run of
`WF-####` across the whole project, counting concluded work too, so a number is never
reused. Never pick one by hand.

## Step 7: rebuild the registries

Creating artefacts does not update the registries that the gates and the projection
commands read. Refresh them from disk.

```bash tutorial-step
node contextkit/tools/scripts/work.mjs reconcile --apply
```

The receipt lists the three registry files it wrote and the counts it found —
work contexts, workflows, and decisions. Running it again on unchanged disk state
produces the same bytes, so it is safe to repeat whenever something looks stale.

## Step 8: confirm the workflow is real

Two final read-only checks.

```bash tutorial-step
node contextkit/tools/scripts/workflow.mjs status onboarding-first-slice
```

You should see one line naming the slug, its format, its start date, and
`current: intake` — followed by nine phases, each `pending`: intake, prd, spec, adr,
roadmap, pipeline, ship, testing, conclusion. That ladder is what the workflow will
walk, and source writes are not permitted until it reaches the ship phase.

```bash tutorial-step
node contextkit/tools/scripts/work.mjs map --id BIZ-0001
```

You should see five lines: the resolved shape (`decision-only`), the journey branch
(`business-decision`), the current phase, the current stage, and a `next:` line
holding the exact command to run next. When you are unsure what to do, this command
answers it rather than making you infer it.

## What you built

You now have a business context on disk holding the problem, the value hypothesis and
the investment decision, with a workflow nested underneath it and its nine-phase
ladder waiting at intake. The registries know about both, and the governance gate is
honestly reporting that the case is still a draft nobody has approved.

The shape of what you did is the shape of the whole methodology: classify, write the
case, let the gate tell you the truth, then attach execution to the case rather than
to a ticket. Nothing you ran asserted success — each command handed back a receipt
naming exactly what it touched, which is the only evidence the gates accept.

## Next steps

- [Run a business case](../how-to/run-a-business-case.md) — the same path as a reference task, including the operation nature and the known defect in its identifier allocation.
- [Business-driven development](../explanation/business-driven-development.md) — the model behind every step above: the two natures, the five ceremonies, proportionality, and the invariants.
- [Run a workflow](../how-to/run-a-workflow.md) — how to advance the phase ladder you just opened.
