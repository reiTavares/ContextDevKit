# The deliberation council

_Why ContextDevKit convenes a relevant, cheaply-briefed panel of experts before a high-stakes choice — automatically, at the two moments it matters — and why that panel still never gets to write the decision._

## The problem this solves

ContextDevKit has always had a place to record *decisions* (ADRs) and their
trade-offs. What it lacked, until [ADR-0035](../../contextkit/memory/decisions/0035-deliberations-multi-agent-debate-artifact.md),
was an artifact for the **adversarial reasoning that should precede a decision** —
the argument where competing positions are weighed before one is chosen.
Single-pass reasoning has a known failure mode: it anchors on the first plausible
approach and then rationalizes it. ADR-0035 answered that with a multi-agent
*deliberation* — independent voices argue, a distinct synthesizer converges, and
the result feeds an ADR as pre-decision working material.

That design was correct but under-used. Three structural weaknesses kept the
deliberation from firing where it was needed:

1. **Manual-only.** A developer had to *remember* to run `/debate` before a hard
   call. In practice it was almost never invoked at the two moments it was built
   for — opening a new feature and recording an architectural decision — so
   high-stakes choices were still made by a single generalist voice with no
   adversarial check and no recorded rationale.
2. **A fixed, generic roster.** Every debate convened the same three unnamed
   voices regardless of the question. A database-migration debate and a UX-copy
   debate got the identical council, diluting relevance.
3. **Uniform model cost.** Every voice ran at the same (premium) tier, so
   *gathering evidence* — cheap, parallelizable, and exactly the work that makes a
   deliberation worth convening — cost the same as the reasoning itself. That tax
   discouraged the very legwork the mechanism depends on.

[ADR-0070](../../contextkit/memory/decisions/0070-auto-invoked-deliberation-and-tiered-council.md)
addresses all three without abandoning the ADR-0035 contract.

## Three moves

### 1. Auto-invoke at the two designed moments

Two new autonomy areas — `feature-deliberation` and `decision-deliberation` —
resolve to `debate` mode at **grade ≥ 3**, reusing the exact shape and fail-safe
that [ADR-0059](../../contextkit/memory/decisions/0059-ship-checkpoint-deliberation-at-grade-3.md)
gave the `/ship` checkpoint. The mode table reads
`['manual', 'manual', 'debate', 'debate']`: at grades 1–2 nothing auto-fires, at
grade 3 (the default install posture — [ADR-0058](../../contextkit/memory/decisions/0058-default-grade-3-and-grade-4-informed-consent.md))
and above the council convenes on its own. Starting a new feature (the
`/workflow` spec phase) or recording a decision (`/new-adr`) now pulls a council
together without anyone remembering to.

**The crucial nuance — state it plainly: the ADR *write* stays `manual` at every
grade.** The separate `adr` area is `['manual', 'manual', 'manual', 'manual']` —
an unmovable floor. The deliberation **precedes** the decision; it never
**authorizes** it. The council argues the forces and pre-fills the ADR's Context;
a human still signs the verdict. Auto-invocation buys you the adversarial pass for
free, not the commitment. This keeps the platform's founding posture intact:
governance is *enforced* by deterministic triggers, but the irreversible act — the
recorded decision — remains a human signature, exactly as it was before ADR-0070.

### 2. A dynamic, named, deterministic council

`deliberation-council.mjs` replaces the flat count of anonymous positions with a
roster that *fits the question* — and computes it deterministically, because the
kit distrusts AI goodwill (the same question must always yield the same council,
so roster selection is computed, not vibed).

The flow:

- **Classify the question into advisor lanes.** A keyword pass maps the framed
  question onto the six advisor lanes (`architecture`, `security`, `features`,
  `deepen`, `ux`, `growth`). The `architecture` lane is *always* seated — the
  architect is in every council, the protected spine.
- **Map each lane to a named specialist agent** through the project's
  `advisor.lanes` owners (architect / security / ux-designer / product-owner / …).
  A database-migration question seats the architect and security; a UX-copy
  question seats the architect and ux-designer. Relevance by construction.
- **Scale the size to the question** via `clamp(matchedLanes, council.min,
  council.max)` (defaults 3–6). Too few lanes matched? Pad up to `min` from a
  fixed perspective pool so there are always at least `min` independent voices.
  Too many? Trim past `max`, keeping the highest-priority lanes — architecture and
  security survive the cut.

Turning `council.autoSelect` off restores the original ADR-0035 behaviour: a flat
roster of `N` generic, unnamed positions. The new roster is an *upgrade* layered
over a preserved fallback, not a replacement that strands old configs.

### 3. A tiered research swarm

The third move attacks the cost tax directly, using the cost-tiered routing
policy of [ADR-0052](../../contextkit/memory/decisions/0052-cost-tiered-model-routing-for-kit-agents.md)
(*expensive models think, cheap models execute*). A deliberation now runs in
phases on deliberately different tiers:

- **Scouts gather evidence on the `fast` tier (Haiku).** Cheap, parallelizable
  agents assemble the evidence pack *before* anyone argues. This is the legwork
  that makes a deliberation worth convening — and now it is cheap enough to always
  do.
- **Voices reason on the `reasoning` tier (Opus).** The independent positions argue
  the briefed question.
- **Verification runs on the `powerful` tier (Sonnet)** for hard claims that need
  checking.

The contract — and the line ADR-0070 will not cross — is that **the voices and the
synthesizer are never downgraded.** The specialist agent supplies the
*perspective* (its lane), never a cheaper argument. Only the scout (evidence) and
verify phases run on cheaper tiers. Models resolve through `model-policy.mjs`; if
the routing policy is absent (low level or a host gap) the plan still returns its
tiers with `model: null` — it degrades, it never throws.

## The mental model

Think of the council as **convening the right experts, cheaply briefed, before a
high-stakes choice.** Cheap scouts do the reading and lay out the evidence; the
expensive specialists — chosen for *this* question, not a generic three — argue it;
a separate synthesizer converges (or records an honest `unresolved` tension). The
whole exchange is written down as a deliberation artifact that flows *into* the
ADR's Context. The council is the briefing and the debate; the ADR is the verdict;
the human is the signature. None of those three roles collapses into another — that
separation is the entire point.

This complements, rather than competes with, the kit's other multi-agent
machinery. Hierarchical fan-out (the QA and forge orchestrators, the
[squad pipeline](../SQUAD-PIPELINE-FORMAT.md)) routes work to specialists and
consolidates results. Deliberation is the kit's only *deliberative* orchestration:
independent voices arguing opposing positions toward a reasoned consensus. The
tier discipline it borrows is documented in the
[model-tier routing study](model-tier-routing-study.md); the parallel-workstream
cousin is the [swarm feasibility study](swarm-feasibility-study.md). The council is
one of three governance systems that landed together — the others enforce the
[workflow journey](workflow-governance.md) and route work through
[active squads](active-squads.md).

## Trade-offs

Nothing here is free, and ADR-0070 is explicit about the costs:

- **Added latency at the two gates.** Auto-invoking a council adds time to
  `/new-adr` and to the `/workflow` spec phase. *Mitigation:* the tiered-research
  design keeps the expensive phase small (cheap scouts do the bulk), and the gate
  is skippable below grade 3 — drop to grade 2 and it never auto-fires.
- **More orchestration surface.** A new council script, three new config blocks
  (`council`, `autoInvoke`, `research`), and four rewired entry points (`/debate`,
  `/new-adr`, `/workflow`, `/ship`). *Mitigation:* the council core is pure and
  zero-dependency (keyword classification + a clamp), it degrades to `model: null`
  rather than throwing, and the auto-invoke wiring + deterministic roster scaling +
  tier floors are pinned by `integration-test-deliberation.mjs` (20 checks) plus
  selfcheck gate cells — so a regression fails the build.
- **Ceremony on trivial decisions would be net-negative.** A council convened for
  a one-line change manufactures false confidence and burns calls. *Mitigation:*
  the triggers are narrow and deterministic — only the new-feature and new-decision
  moments — and the nudge hook only ever *suggests*; it never blocks an edit
  (immutable rule 2).

## The floor, restated

Two invariants survive every move above, and they are the reason the council is
safe to auto-invoke:

1. **The ADR write stays human at every grade.** Deliberation precedes the
   decision; it never authorizes it.
2. **Voices never downgrade below their tier.** The cheap tiers gather and verify;
   the reasoning never goes on sale.

Everything else — when the council fires, who sits on it, how big it is, how
cheaply it is briefed — is computed deterministically from the question and the
config, never improvised.
