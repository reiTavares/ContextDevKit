# Business-driven development

_The central pillar of ContextDevKit: work starts from a business case, not from a
queue of tickets. This page explains the model, the vocabulary the code actually
uses, the ceremonies work is routed into, and the invariants that hold no matter
how autonomous the agent is._

## Why work starts from a business case

Most tooling treats development as a flat queue. Tasks arrive, someone executes
them, and the reason the work mattered — if it was ever written down — lives in a
document nobody opens again. That is efficient for throughput and terrible for
judgement. An engineer, human or AI, makes dozens of local calls a day: what to cut,
what to defer, which of two designs to take. Every one of those calls is only as
good as the goal it is serving, and when the goal is implicit, everyone works by
inference. Inference produces drift, gold-plating, and the classic failure of
building the right thing wrong.

So the platform inverts the order. Before meaningful work is decomposed into
engineering tasks, the case for it is written down: the problem, the value
hypothesis (what changes for someone if this works), and the investment decision
(what the work is worth, on what evidence). That case becomes a durable, addressable
artefact on disk — not a slide. Requirements descend from it into workflows,
workflows into governed tasks, and each material choice along the way is recorded as
a decision record with its reasoning attached.

The chain matters more than any single artefact in it. When an agent hits a fork six
weeks later, it does not have to reconstruct intent from the diff. There is a
well-formed question available — which branch better serves the stated hypothesis —
and a recorded answer for every fork already crossed.

## The two natures of work

Everything the methodology routes is first classified into one of exactly two
natures. The distinction is not about size, and it is not about effort.

A **business** creates or changes a durable strategic capability. It has its own
outcome to defend, its own investment decision, and it usually outlives the work
that builds it. A new product surface, a new market, a change to how the product
makes money.

An **operation** fixes, maintains, or executes work inside something that already
exists. A bug, an incident, a dependency bump, a localized refactor, a feature that
extends a capability already agreed on. An operation borrows its value story from a
business that already exists rather than arguing for a new one.

Each nature gets its own context on disk with its own identifier: `BIZ-####` for a
business, `OP-####` for an operation. Both carry a **value intent** — the reason the
work has value, from a closed set: `CREATE`, `PROTECT`, `RECOVER`, `ENABLE`,
`IMPROVE`, `LEARN`, `COMPLY`, `SERVE_MISSION`. An operation may be **linked** to the
business whose value it borrows, which is how a bug fix stays connected to the
capability it protects.

The vocabulary here is normative: the terms in this page map one-to-one to
identifiers in the code. See the [glossary](../reference/glossary.md) and the
[domain model](../explanation/domain-model.md) for the full entity map.

## How intake classifies a request

Intake is the classification ceremony that runs before substantive work. It reads
the objective and resolves three things: the **work nature**, the **tier**
(`trivial`, `feature`, `architectural`), and the **execution mode** (`direct`,
`batch`, `workflow`). It also reports whether a governing decision is needed and
whether an existing business context looks like the owner.

Two properties are worth understanding, because they shape how much you can trust
the answer.

It is **deterministic, not a model call.** Nature is scored by weighted signal
tables in a policy file, in English and Portuguese, with a floor each side must
clear and a margin it must win by. Execution mode is scored on ceremony points with
bands, plus hard triggers that force the workflow mode outright — a required
decision, a data migration, a rollout with rollback, a breakable public contract,
cross-cutting architecture, multiple teams.

And it **asks rather than guesses.** When neither nature clears its floor, or
confidence lands under the floor, intake returns a clarification question instead of
a verdict, and the recorded default stays `operation`. That default is the
conservative one: an operation that turns out to be a business gets promoted, while
a business misfiled as trivial work would have skipped its own approval.

Intake advises; it does not decide for you. The ceremony that actually gets written
to disk is the one passed explicitly on the create verb. Reading the classification
and then choosing deliberately is the intended flow, not a workaround.

## The ceremonies

The resolved axes collapse to exactly one **ceremony shape**, and each shape has one
ordered **journey branch** — the stage list the engine walks. These are the real
names in the code; there are five of each.

| Nature | Execution mode | Tier | Ceremony shape | Journey branch |
| --- | --- | --- | --- | --- |
| operation | direct | trivial | `quick-fix` | `operation-direct` |
| operation | direct | feature or architectural | `single-workflow-operation` | `operation-workflow` |
| operation | batch | any | `batch-operation` | `operation-batch` |
| operation | workflow | any | `single-workflow-operation` | `operation-workflow` |
| business | workflow | architectural | `multi-workflow-program` | `business-workflow` |
| business | anything else | any | `decision-only` | `business-decision` |

The branches differ in how many stages they impose, in this order:

- `operation-direct` — intake, operation context, implement, tests, done move.
- `operation-batch` — the same, with a task-authoring stage before implementation.
- `operation-workflow` — adds a nested workflow, a governing decision, and QA sign-off.
- `business-decision` — intake, business context, governing decision, human approval, implement, tests, QA sign-off, done move.
- `business-workflow` — the full path: business context, human approval, nested workflow, governing decision, task authoring, implementation, tests, QA sign-off, done move.

On the creation surface for a business context, the public ceremony choice is
narrower than the shape vocabulary: `decision` or `workflow`. A third internal token
exists in the resolver and is explicitly refused at the public boundary, so a
business is always created as either a single governed decision or a multi-workflow
programme.

## Proportionality is a feature, not a leak

This matters as much as the rigour, and it is easy to get wrong in both directions.

Trivial work does not pay the full ceremony. A `quick-fix` has five stages and needs
no nested workflow, no governing decision, and no QA sign-off stage; the governing
decision and sign-off stages only apply when the tier is `feature` or
`architectural`, or when the nature is business. The journey the engine walks carries
this as an explicit invariant: trivial and no-code work stay proportional. A stage
whose input is absent reports as **skipped** — never as passed, and never as a
blocker on a fresh install.

A methodology that charges full price for a typo tax will be routed around, and a
methodology that is routed around governs nothing. The ceremony ladder exists so the
expensive path is reserved for work whose blast radius earns it. If you find
yourself resenting the ceremony for a two-line change, the classification is
probably wrong — that is a signal to check the tier, not to skip the ceremony.

The inverse abuse is real too. Classification is a judgement call, and a judgement
call can be gamed by filing a structural change as trivial. Two things push back:
the enforcement gate watches for a workflow whose phase does not yet permit source
writes, and the classification is persisted next to the work, so systematic
under-classification shows up as a pattern in review rather than as isolated
incidents.

## The invariants

Four properties hold regardless of ceremony, autonomy level, or how confident the
agent is. They are enforced in code, not requested in a prompt.

### An owned workflow lives under its owner

A workflow belonging to a business or an operation is created inside that owner's
`workflows/` directory. It is never loose and never central. Placement is the
ownership record, so a workflow that drifts out of its parent has lost the link
between execution and the case that justified it. The enforcement gate blocks a
central placement it can positively detect.

### Workflow numbering is one global sequence

There is a single `WF-####` sequence across the whole project — not one per business,
not one per directory. The allocator counts every workflow-holding directory,
including the archives of concluded work, so a number is never reused, and it
reconciles across parallel worktrees so two sessions cannot mint the same id. Never
hand-pick a workflow number; allocate it through the engine.

### The AI proposes, a human accepts

Approval of a business case requires a human actor. Passing anything else is a hard
refusal with a structured error, and no autonomy grade or configuration can weaken
it. The same floor applies to closing a business with an outcome, and to
re-parenting a governed entity to a new owner. Approval also stamps a hash over the
governing decision's canonical fields, so the gate verifies a provenance chain
rather than trusting a status field somebody wrote.

This is not distrust of a particular model. "Respect the approval gate" in a prompt
is a request; an agent under pressure to ship will rationalise its way past a
request. The gate is built so that forgetting is not an available outcome.

### Only a script receipt satisfies a gate

Every mutator returns a receipt: the command, whether it applied, the mode
(`dry-run` or `apply`), the exact paths written, and structured detail. A gate is
satisfied by that receipt and by nothing else. Prose does not count — "tests passed"
in a message is not a test run, and a stale receipt from the wrong branch is not a
receipt for this change. Where evidence is missing, the verdict is `skipped`, which
is explicitly not a pass.

Mutators are also **dry-run by default**. Nothing is written without an explicit
apply flag, so the plan is always inspectable before it becomes a change. See
[governance and enforcement](../explanation/governance-and-enforcement.md) for how
the gate degrades when it cannot evaluate safely.

## The approval cycle

A business case is created in `draft`. From there the lifecycle is a state machine
with a fixed transition table, and the terminal states are genuinely terminal.

- `draft` moves only to `proposed`.
- `proposed` moves to `confirmed` (approve), `needs-revision` (revise), or `rejected` (reject).
- `needs-revision` moves back to `proposed`.
- `confirmed` moves to `active`, `paused`, or back to `needs-revision`.
- `active` moves to `paused`, `validated`, `partially-validated`, or `closed`.
- `validated` and `partially-validated` move to `closed`. `closed` and `rejected` are terminal.

Approve, revise, and reject are the lifecycle verbs the command surface exposes
today, and approve is the only path that produces `confirmed`. Every transition
appends an entry to the case's revision history with the actor, the timestamp, and
an optional note, so the argument is auditable and not just its outcome. Closing a
business is a governed outcome decision in its own right: it requires a human actor,
one of the three closing statuses, and a reference to an outcome report that must
exist inside the repository. You cannot close a case by asserting it worked.

Decision records have their own, separate lifecycle: `proposed` becomes `accepted`
or `rejected`, and an accepted record can later be superseded. Only an **accepted**
record governs. A proposed record authorizes nothing, which is why material work
waits on acceptance rather than on the record merely existing.

## What this page does not cover

This is the methodology — the why and the shape. It deliberately leaves out the
mechanics of individual workflow phases, which belong to
[workflow governance](../explanation/workflow-governance.md) and the
[run-a-workflow guide](../how-to/run-a-workflow.md); the enforcement machinery and
its degradation modes, in
[governance and enforcement](../explanation/governance-and-enforcement.md); and the
token, cost, and autonomy budgets in
[the three economies](../explanation/the-three-economies.md).

It is also not an organisational methodology. It helps a team that already has a
product direction turn that direction into reliable execution. It does not replace
the product thinking that produced the direction, and it has no opinion on your
stakeholder process.

## Further reading

- [Run a business case](../how-to/run-a-business-case.md) — the task-oriented path from a case to an active workflow.
- [Your first business case](../tutorials/first-business-case.md) — the guided first pass, one command at a time.
- [Domain model](../explanation/domain-model.md) — the entities, their fields, and their relationships.
- [Glossary](../reference/glossary.md) — every term above, mapped to its identifier in the code.
- [Governance and enforcement](../explanation/governance-and-enforcement.md) — the gate, its modes, and what happens when it cannot evaluate.
- [Run a workflow](../how-to/run-a-workflow.md) — the phase ladder once a workflow is open.
