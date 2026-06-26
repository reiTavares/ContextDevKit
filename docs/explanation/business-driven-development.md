# Business-driven development: connecting intent to execution

_Why ContextDevKit anchors engineering work in an explicit business case rather than a queue of tickets — and how the platform makes that discipline mechanically enforceable, not just aspirational._

## Background

Most development tooling treats work as a flat queue: tasks arrive, engineers execute them, and business rationale — if it was ever written down — lives in a slide deck that nobody reads three months later. This is efficient for throughput, but it severs the link between what gets shipped and why it matters. Engineers make dozens of local decisions every day (scope trade-offs, deferral calls, architecture choices) and the goodness of those decisions depends entirely on knowing the goal they are supposed to serve. Without that goal made explicit and durable, developers work by inference — which produces drift, gold-plating, and the canonical "we built the right thing wrong."

ContextDevKit's approach is to make business intent a first-class, persisted artefact. Before a meaningful piece of work is decomposed into engineering tasks, a **business case** is authored: the problem being addressed, the value hypothesis (what changes for the customer if this works), the growth or operational model behind it, and the investment decision — roughly, what the work is worth and on what evidence. This is not a heavyweight document-first bureaucracy. It is a structured minimum: write down the *why* before you write down the *how*, and make that *why* something the system can reference mechanically.

## Core idea

The mental model is simple: work flows downward from business intent. A business case sits at the top; it decomposes into **operations** — discrete capability units, each with a global identifier and a registry entry — and operations compose into **workflows** that carry the actual execution ladder (planning phases, engineering tasks, testing, conclusion). At every level, the link back to the originating business intent is preserved and addressable.

This has a practical consequence: when a developer or an AI agent encounters a fork in the road, there is always a well-formed question available — "which branch better serves the stated value hypothesis?" — rather than a judgment call made in a contextual vacuum. The business case is not a constraint on creativity; it is a frame that keeps local decisions coherent with each other.

The second half of the model is that this intent is not just recorded; it is **governed**. Intent that can be silently overridden, re-interpreted, or fast-tracked past its own approval gate provides no discipline at all. So the platform treats the business case lifecycle as an enforced engine state, not a prose convention.

## Key design decisions and trade-offs

**Decision: business proposals follow an approval lifecycle with a human gate**

A business case moves through draft, review, revision, and approval states. The critical property is that an AI agent operating within the platform cannot move a proposal from draft to approved on its own — the approval state requires a verifiable human action. A cryptographic revision hash is stamped at each transition; the gate checks the provenance chain rather than trusting a declared state. The cost of this is ceremony: it adds a mandatory pause in the flow. The benefit is accountability. Without the hard gate, an autonomous agent under pressure to ship will rationalise its way to self-approval, which means every governance property downstream of the business case is built on sand.

The alternative — trusting the AI to respect an advisory approval signal — was ruled out because it collapses under exactly the conditions where discipline matters most: when there is time pressure, scope ambiguity, or a model that is strongly opinionated about the right answer. The gate is not distrust of any particular model; it is an acknowledgement that "respect the approval gate" is a rule that lives in a prompt, and a rule in a prompt is a request. The gate is designed so that forgetting to respect it is not an option.

**Decision: classify work by value-intent before routing it to a ceremony**

Not all work warrants the same process overhead. A two-line copy fix is categorically different from a new subsystem, and treating them identically wastes time. ContextDevKit classifies each unit of work by its **value-intent** — what kind of business outcome it is trying to produce — and uses that classification to route it to an appropriate ceremony: lightweight (no planning phases required, direct to execution) for genuinely trivial changes, full (PRD, SPEC, architecture decision) for changes with structural consequences.

The trade-off is that the classification is a judgment call, and judgment calls can be gamed. A developer who wants to skip ceremony can classify a significant change as trivial. Two things constrain this. First, the L5 mutation guard watches the workflow state: if you open a workflow for a change (which signals you judged it non-trivial), the guard blocks source edits until planning phases are complete. Second, the classification is recorded alongside the business case, so a retrospective can surface systematic under-classification as a pattern rather than as isolated incidents.

**Decision: recurring operations are detected and forecast with honest uncertainty**

A business goal often decomposes into operations that recur — weekly reporting cycles, monthly billing reconciliations, seasonal campaign deployments. Detecting this recurrence and surfacing a forecast is useful; inventing confidence where there is none is worse than silence. The platform tracks execution cadence and produces quota-aware forecasts, but it distinguishes explicitly between a projection built on observed history and an estimate built on a single data point. When there is insufficient history, it reports "unknown" rather than extrapolating from noise. This is a deliberate constraint: the temptation to produce a number (even a hedged one) is strong, but a false precision signal corrupts the prioritisation decisions downstream.

**Decision: outcomes are tracked as a closed loop**

Each business case records expected outcomes at approval time. As operations and workflows execute, the platform tracks forecast outcomes (what the model predicts given current progress) and actual outcomes (what was measured). The loop closes when the actual is recorded — which may confirm the hypothesis, refute it, or flag that the measurement was never set up. The point is not to be right; it is to learn. A development organisation that never closes the loop between "we expected X" and "we got Y" cannot improve its investment decisions, because it has no signal about what its hypotheses are worth. The platform makes closing the loop a ceremony, not an afterthought.

## What this does NOT cover

This explanation addresses the platform's *methodology* — why work is structured as business-driven and how that structure is enforced. It does not describe the *execution mechanics* of individual workflow phases (PRD, SPEC, testing, conclusion — those are covered in [docs/explanation/workflow-governance.md](./workflow-governance.md)), the economic dimension of how work is budgeted in tokens and cost (covered in [docs/explanation/the-three-economies.md](./the-three-economies.md)), or the enforcement mechanisms that make governance hard to bypass (covered in [docs/explanation/governance-and-enforcement.md](./governance-and-enforcement.md)).

It also does not address team-level product strategy, backlog management, or stakeholder communication patterns — the methodology is a *development platform capability*, not an organisational methodology. It helps a team that already has a product direction move from that direction to reliable engineering execution. It does not replace the product thinking that produces the direction in the first place.

## Further reading

- [docs/explanation/workflow-governance.md](./workflow-governance.md) — how the 9-phase workflow lifecycle is enforced, phase by phase.
- [docs/explanation/governance-and-enforcement.md](./governance-and-enforcement.md) — why enforcement lives in the harness rather than in the prompt.
- [docs/explanation/the-three-economies.md](./the-three-economies.md) — how token, cost, and autonomy budgets govern execution within a business case.
- [docs/LEVELS.md](../LEVELS.md) — how the autonomy level determines how much of the business-driven lifecycle the platform runs automatically.
