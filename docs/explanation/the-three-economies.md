# The three economies: token, cost, and autonomy

_Why an AI-assisted development platform tracks three separate resource
dimensions — what each one measures, why collapsing them into one number loses
information, and the hard limit on what any of them may change._

## Why one number is not enough

A traditional developer tool has a simple resource model: wall-clock time and
compute. An AI-assisted one does not. Three things vary independently, and each
has its own failure mode.

How much context enters a call is an engineering property of the prompt and the
retrieval around it. What that context is worth in money depends on the tier
that served it and on how much of it was already cached. How much useful work
came out per unit of human supervision is neither of those — it is a governance
property of what the agent was authorised to do on its own.

Collapse them and you get a number that moves for reasons you cannot name. A
session gets cheaper because caching improved, or because the agent stopped
reading the files it needed. Those are opposite outcomes with the same signature
in a single metric. Keeping the three apart is what makes the question "cheaper,
or just worse?" answerable at all.

## The token economy: how much context enters

The token economy is the unit-level accounting layer: prompt tokens, completion
tokens, cache reads and cache writes, per session and across the project.

It answers questions about volume and shape. Is the same file re-read every
session because the durable structural map went stale? Is a subagent inheriting
the full boot context where a bounded pack would do? Is a noisy test log
entering the window verbatim instead of as a summary? Each of those is a
token-economy problem with a token-economy fix, and none of them is visible in a
monetary total.

This is the layer the platform's levers act on. They reduce what enters the
window and what a worker is asked to emit. That is a narrow and honest claim:
fewer tokens in, fewer tokens out.

## The cost economy: what that context is worth in money

Tokens are not fungible. The same token costs a different amount depending on
the tier that processed it and on whether it was served from cache, so a token
count does not become a budget without a pricing layer on top of it.

The cost economy is that translation. It converts recorded usage into monetary
units, keeps the cached and uncached portions distinct rather than blending
them, and marks its own confidence per model. On a subscription host it states
plainly that the marginal money cost is near zero until a quota wall is reached,
so the figure it reports there is an estimated equivalent and not a bill.

Two constraints shape it deliberately. Pricing and model entries live in a
generated table carrying a visible timestamp, never in prose, because a price
written into a sentence is wrong within a release — and changing a price or a
model entry requires a recorded decision, with automation permitted only to
refresh the date. And a figure the layer cannot derive reports as skipped with a
reason, never as zero and never as an estimate wearing the confidence of a
measurement.

## The autonomy economy: useful work per unit of supervision

The third economy measures neither volume nor money. It measures how much useful
work completed per unit of human supervision — and, symmetrically, what the
agent was permitted to do without asking first.

Autonomy is graded, not binary. A grade widens the action space the agent may
enter alone: read-only inspection, file edits, running the suite, moving work
items, version-control operations. The grade is resolved from project
configuration and enforced by the harness, not declared by the agent, because a
self-reported grade is not governance. Hooks are how that enforcement happens,
which also bounds what it can promise: they are a governance mechanism and they
fail open on error, so they are not a security control.

This belongs beside the other two because it catches a failure neither can see.
A session can be cheap in tokens and cheap in money and still have been a poor
session — because a human had to intervene at every step, or because the agent
acted outside what it was authorised to do. No financial metric detects either.

## How the three relate

They stack, but the arrows point one way only.

The token economy is the substrate, measured directly from usage records. The
cost economy is a derivation over it: no token data, no cost figure. The
autonomy economy is orthogonal to both — it constrains what may be attempted,
while the other two describe what the attempt consumed.

The useful diagnostic reads them together. Tokens fell, cost fell, and the work
still completed within the same supervision budget: the context architecture
improved. Tokens fell but the work needed more human correction: something
necessary was trimmed, and the saving was borrowed from the supervision budget
rather than earned. That second pattern is exactly what a single number hides,
and it is why the platform refuses to optimise on cost alone.

## What economy may never do

This is the constraint that governs every lever, and no configuration key
negotiates it away.

Economy may reduce the cost of context and of output. That is the whole mandate:
fewer tokens into the window, fewer tokens out of a worker, less repetition of
context that has not changed since the last session.

Economy may not do any of the following.

- **Reorder the stages of work.** The order — map the structure, resolve the
  economy profile, settle design and governance, implement, then test and sign
  off — is fixed. A lever cannot move a stage earlier because doing so would be
  cheaper.
- **Satisfy evidence.** A gate is satisfied by a receipt a script emitted.
  Reducing what enters the context window produces no receipt and never stands
  in for one.
- **Lower the quality of an agent.** A bounded context pack changes how much a
  worker reads, not how carefully it works or which specialist is selected. The
  routing layer emits structural facts about a selection — the tier and the rule
  that applied — and never a judgment ranking one model against another.
- **Skip tests or the QA verdict.** No budget, no toggle and no mode causes a
  suite to be skipped or a sign-off to be assumed.

The default mode is advisory for the same reason: a lever able to block real
work in pursuit of a saving would be trading the wrong resource. Trivial and
no-code work stay proportional — the ceremony scales to the task rather than the
task inflating to fit the ceremony.

## Measured, advisory, and skipped

The three economies report in three registers, and the distinction carries
weight.

**Measured** means an observable token difference was recorded at the moment a
lever fired — the count it actually avoided, appended to a ledger as it
happened. Only a small set of levers can produce one. The ledger deliberately
records the observation without attaching a causal claim about what the same
work would have cost with no platform at all; that counterfactual is a different
measurement with a different design, and conflating the two would turn an
observation into marketing.

**Advisory** means a lever produced a recommendation. What gets reported is that
it fired and whether the recommendation was adopted — never an invented saving
on the strength of having offered advice.

**Skipped** means the data was not there: a missing snapshot, an absent
transcript, a lever no hook or command invoked. Each reports as skipped with a
reason. Skipped is never counted as a pass, and an unknown is never rounded up
into a favourable number. Silence about a capability that has not been exercised
is more useful than a figure nobody can trace.

## Further reading

- [Reference: economy configuration and levers](../reference/economy.md) — every
  toggle, the script behind it, and its wiring status.
- [How to reduce token cost](../how-to/reduce-token-cost.md) — the levers in
  order of effect, as a task.
- [Reference: levels](../reference/levels.md) — the action space each level
  authorises.
- [Governance and enforcement](./governance-and-enforcement.md) — why the
  harness enforces the grade instead of trusting the agent to report it.
