# The work domain model

_Why the platform models work as four kinds of entity with explicit ownership, and
which four rules that model refuses to bend._

This is the prerequisite page for every how-to guide. The guides tell you which
command to run; this page tells you what the command is operating on, and why a
refusal you did not expect is usually the model working rather than a bug.

## Background

A coding agent that keeps no record of work has one failure mode that dominates all
others: it cannot tell you why anything is the way it is. Six months later the code
is still there, the reasoning is gone, and the next session reconstructs a plausible
story instead of the real one. The obvious fix — write more documentation — does not
survive contact with delivery, because prose has no structure to enforce and nothing
notices when it drifts from reality.

So the platform does not model work as documents. It models work as **entities with
identifiers, owners, and lifecycles**, and it puts the documents inside them. An
entity can be looked up, referenced, counted, and checked. A paragraph cannot.

That choice has a cost, and the cost is ceremony: to get the benefit you have to
classify a request before working on it, and you have to accept that some paths are
refused. The rest of this page is the argument that the ceremony is proportional —
and the four places where it is not negotiable.

## The four boundaries

The model has four entity kinds. The boundary between them is not organisational
taste; each one answers a different question, and putting work in the wrong one makes
the record unusable in a specific way.

### Business — durable strategic capability

A Business is a capability that has its own reason to exist and its own outcome
review: a new product, a new market or segment, a platform capability, a pivot. The
test is whether the thing would still need explaining after the code shipped. If the
answer is yes, the value story lives in a Business, and the Business is what a future
reader reads first.

A Business is the only entity kind with a **human approval step in its lifecycle**,
because it is the only one where the question "should we do this at all" is the
substance of the work rather than a precondition to it.

### Operation — bounded work inside what exists

An Operation is a fix, an incident, a maintenance chore, a dependency bump, a
localized refactor. Its value story is already told somewhere else: by the Business
it serves, or by the plain fact that the system is supposed to work. Operations exist
so that ordinary work has a home that does not require inventing a strategic
narrative for a typo.

An Operation can be linked to a Business or stand alone. Standing alone is a normal
state, not a defect — much operational work genuinely serves the whole system.

### Workflow — multi-phase delivery

A Workflow is the unit of delivery when work does not fit in one sitting: it carries a
specification, a plan of waves and gates, and a state file that is the single
authority on where it stands. A Workflow always has an owner — a Business or an
Operation — and it never floats free.

Why a separate entity at all, rather than a big Operation? Because a Workflow has
*phases*, and phases are what let a gate say "you may write planning documents now,
but not source code yet". An Operation has no phase structure to gate against.

### Decision record — the reasoning, frozen

A decision record captures one material decision: the context that forced it, what
was decided, and what it costs. It is deliberately the only artifact in the model that
becomes **immutable on acceptance**. Everything else in the model describes work in
motion; a decision record describes a commitment, and a commitment you can quietly
edit later is not a commitment.

Changing an accepted decision means writing a new record that supersedes the old one
and marking the old one superseded. The old text stays exactly as it was, wrong parts
included, because the wrong parts are how the next reader understands what was known
at the time.

### Task — the unit of execution

Below all four sits the task: one unit of executable work, belonging to exactly one
owner. A task's status is folded from an append-only journal of transition events
rather than written as a free field, which is what makes "the board says done" and
"the work is done" the same statement instead of two hopes.

## Ownership relations

Ownership in this model is not a label; it is a containment relation that shows up in
the filesystem and in the registries.

```
Business (BIZ-####)
├── Workflow (WF-####)        nested under the Business it serves
├── Operation (OP-####)       linked, when the Operation serves this Business
└── Decision record           governing this Business

Operation (OP-####)
├── Workflow (WF-####)        nested under the Operation it serves
└── Decision record           governing this Operation

Workflow (WF-####)
├── Waves → gates             the plan
└── Tasks                     the execution units

Decision record (ADR-NNNN-<slug>.md)
└── governs: which Businesses, Operations, and Workflows it authorises
```

Two directions matter and they are not the same. **Downward**, an owner contains its
workflows and tasks: this is what makes a work context readable as one unit. **Upward**,
a workflow names its owner and a decision record names what it governs: this is what
makes an isolated artifact traceable back to the value story that justified it.

A Business may own Operations; an Operation never owns a Business. A decision record
governs work contexts; a work context never governs a decision record — it cites one.
Both restrictions exist so the graph stays acyclic and a reader can always walk
upward to a terminating answer.

## The four invariants

Everything above is design. What follows is the part the platform will actually refuse
over. Each of these is checkable by a script, which is why each of them is enforced
rather than encouraged.

### An owned workflow lives under its owner's directory

A workflow with an owner is stored inside that owner's `workflows/` directory. Not
beside it, not in a central pool with a pointer.

The reason is recovery, not tidiness. Every index in the system is regenerable from
the filesystem, and that guarantee only holds if the filesystem carries the ownership
relation. A workflow in a central pool whose pointer is stale is unrecoverable: you
can read the workflow and you can read the owner, and nothing on disk tells you they
belong together. Placement *is* the record.

This is the one placement rule that blocks rather than warns, because a wrong
placement is cheap to fix at creation and expensive to reconstruct later.

### Workflow numbering is one global sequence, never contiguous per owner

Workflow identifiers come from a single sequence for the whole project. Every new
workflow takes the next number, whoever asks for it.

The consequence surprises people, so state it plainly: **an owner's workflow numbers
have gaps, and that is correct.** In this repository one Operation owns `WF-0096` and
`WF-0107`, with `WF-0097` through `WF-0106` belonging to other owners — allocated by
other sessions between those two creations. Nothing is missing and nothing is
corrupt.

The alternative — a per-owner counter — reads more tidily and breaks under the exact
condition the platform is built for. Two sessions working in parallel, each on its own
owner, would each allocate "the next one" and produce colliding directory names on the
same branch. A single global sequence makes a collision structurally impossible, and
the price is a gap in a list that no logic depends on being dense.

Never hand-pick an identifier. Allocate through the allocator, which reads what
already exists across the project before it answers.

### The agent cannot approve its own work

Approval flows `draft` → `proposed` → `confirmed`, with `needs-revision` and
`rejected` as the other outcomes of a proposal. The transition into `confirmed`
requires the acting identity to be the human actor. Any other actor is refused
outright, with the refusal recorded — not downgraded to a warning, and not relaxed at
higher autonomy grades.

This is the load-bearing constraint of the whole governance layer, and it is worth
being precise about what it does and does not claim. It does not claim the agent is
untrustworthy. It claims that an approval an agent can grant itself carries no
information: it is a self-signed certificate. The refusal exists so that "approved"
means a human read the proposal and accepted the consequences, and so that the record
six months from now can distinguish a decision someone made from a decision that
happened.

The same human floor applies to closing a Business with an outcome verdict. An agent
can prepare the outcome report; it cannot rule on it.

### Only a script-emitted receipt satisfies a gate

A gate reads evidence. The evidence is a receipt: the structured record a script emits
saying which command ran, whether it applied or was a dry run, and which files it
touched. An assertion in prose satisfies nothing, however confidently phrased. "Tests
pass" is a claim; the test command's output is evidence.

Two properties of this rule matter more than the rule itself.

First, **absent evidence is skipped, never passed.** When a gate cannot read what it
needs — the tool is not installed, the data does not exist yet, the check errored — it
reports that it could not evaluate. It does not infer success from silence. A gate
that guessed "probably fine" would be worse than no gate, because it would produce
false confidence that reads identically to real confidence.

Second, **a gate that cannot evaluate safely degrades to advisory.** In the default
enforcement mode a gate blocks when it can evaluate and the answer is a definite no;
when it cannot evaluate at all it warns and lets the work through. A fresh install
with no history does not become unusable, and a project can widen or tighten this
posture deliberately.

## Consequences

**What you get.** Any artifact in the repository can be walked upward to the value
story that justified it. Any decision can be read as it was written, with its
supersession chain intact. Any claim of completion has evidence behind it or is
visibly marked as unverified. Parallel sessions collide loudly at creation time
instead of quietly at merge time.

**What it costs.** Classification happens before the work, which feels like friction
on a request you already understand. Numbering has gaps that look like mistakes.
Approval waits on a human, which means an autonomous run can stop at a gate and stay
stopped. Some paths are refused rather than warned about.

**Where the ceremony is deliberately absent.** Trivial work skips it. A typo fix does
not open a work context, does not need a decision record, and does not wait for
approval. The model scales its ceremony to the tier of the request, and getting that
proportion right is the difference between a governed project and an obstructed one.

## See also

- [Glossary](../reference/glossary.md) — the normative term-to-identifier mapping,
  with entities separated from classification values.
- [Memory model](../reference/memory-model.md) — where each entity lives on disk, and
  which files are generated rather than authored.
- [Business-driven development](business-driven-development.md) — the methodology
  these entities implement.
- [Governance and enforcement](governance-and-enforcement.md) — the enforcement modes
  and how gates degrade.
