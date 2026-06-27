# AI-Assisted Coding Best Practices — The Rubric

> The principles `/analyze-code-ia-practices` checks against. Mirrors the
> constitution in `CLAUDE.md` — keep them in sync. Tune thresholds via
> `contextkit/config.json` (`l5.lineBudget`, etc.).
>
> **Paired with `review-protocol.md`** (severity vocabulary, scope, the
> protocol the auditor follows, and the scanner contract). This file says
> *what good looks like*; the protocol file says *how to apply it*.
>
> **Stack-agnostic by design.** ContextDevKit installs into any language and any
> stack — this rubric speaks in principles, not in framework names. If your
> project wants concrete stack-specific rules (e.g. ORM patterns, framework
> conventions, security controls particular to your stack), write them in a
> sibling `best-practices.local.md` your project owns. The kit will not
> invent domain content (constitution, rule 9).
>
> **Why this rubric exists.** AI-assisted code fails in predictable ways, and
> the *expensive* failures are not the ones a linter sees. Logic married to
> the database, authorization holes, duplicated domain rules, state with no
> single source of truth — that is what sinks a project. God files and bad
> names are real, but they are the *cheap* tier. The tiers below are ordered
> by what actually costs the project, not by what a regex can match.

## Risk model

A finding's weight is not "which rule." It is:

> **severity ≈ likelihood × blast radius × cost-to-fix-later**

- **likelihood** — how often this bites in practice.
- **blast radius** — how much breaks, or how much data leaks, when it does.
- **cost-to-fix-later** — cheap now, expensive once it has spread or shipped.

That is why the rubric is reviewed **top-down by tier**:

1. **System & architecture** — wrong here and everything downstream inherits it.
2. **Module & function hygiene** — real, but local and cheap to fix.

**Security is deliberately *not* a tier here.** The kit already has a
dedicated security ecosystem (`code-security`, `security`, `infra-security`
agents; `/audit`, `/deps-audit`, `/security-setup` commands). Duplicating
those rules in this rubric would create two places to maintain them and
violate the rubric's own §H3 (separation of concerns). For security
findings, dispatch the security-team — see *Adjacent concerns* at the foot
of this file.

## Rule shape

Every rule below has the same four blocks — **Principle / Smells / Fix /
Don't over-apply** — because an agent applies a rule well only when it knows
what triggers a look, what to propose, *and where to stay quiet.* The
over-apply clause is the calibration; a respected guardrail beats a flagged
false positive. (Severity, scope, and reporting format live in
`review-protocol.md`.)

---

# TIER 1 — System & architecture

The highest-leverage tier, and the one a line-counting linter is blind to.
The scanner gives the agent almost nothing here — read the code.

## S1 — Dependency direction

**Principle.** Dependencies point *inward*: UI and domain logic do not depend
on infrastructure. The persistence client, the HTTP transport, and the
framework live at the edges and depend on the core, not the reverse. The
domain should not know how it is stored or transported.

**Smells.** A `domain/` or business module importing the DB/ORM client, the
network library, the router, or generated persistence types. Generated row
types used as the domain model everywhere. "It's easier to just import the
client here."

**Fix.** Invert it: the core defines an interface (a repository/port); infra
implements it; the dependency is injected at the edge. The domain stays
ignorant of how things are persisted or transported.

**Don't over-apply.** A genuinely thin app — a CRUD admin panel with no real
domain — doesn't need a hexagonal cathedral. Match ceremony to complexity.
The *direction* rule still holds; the *depth* of layering is negotiable.

## S2 — Boundaries & encapsulation

**Principle.** Each module has a deliberate public surface; everything else
is internal. Callers depend on the contract, not the guts. The shape of a
module's public API is a *decision*, not a side effect of which files happen
to be re-exported.

**Smells.** Deep imports into a module's internals
(`feature/x/internal/helpers`). A barrel that re-exports everything, so
nothing is actually private. Two modules reaching into each other's state.
A consumer mutating a value the producer hands back.

**Fix.** Export the contract from the module's entry point; keep the rest
unexported. If a caller genuinely needs an internal, that internal probably
wants promoting to the public API — on purpose, not by accident. Return
immutable values or copies across the boundary.

**Don't over-apply.** Don't add barrel/index ceremony to a two-file feature.
The point is intentional surface, not bureaucratic surface.

## S3 — Coupling & cycles

**Principle.** Low coupling between modules; no import cycles. Watch
**fan-in** (many things depend on this — change it carefully) and
**fan-out** (this depends on many things — it's probably doing too much).

**Smells.** Circular imports. A "god module" everything imports. A change
here forcing edits in five unrelated places. A module that pulls in half the
codebase to do its job.

**Fix.** Break the cycle by extracting the shared piece both sides depend on,
or by inverting one direction with an interface. High fan-out usually means a
missing decomposition: the module is orchestrating *and* doing the work; pull
the work into focused collaborators it calls.

**Don't over-apply.** Shared kernel utilities (types, pure helpers) having
high fan-in is normal and fine — that's what they're *for*. The smell is
high fan-in on something that *changes often*, not high fan-in on a stable
primitive.

## S4 — State location & single source of truth

**Principle.** Every piece of state has **one source of truth.** Server
state and client/UI state are different things and live in different places.
Domain rules live once. Derived data is computed, not stored.

**Smells.** The same server data fetched and cached in several places,
drifting out of sync. The same validation or business rule copy-pasted across
screens. Server data and UI-only state mashed into one blob. Two flags that
must always agree (and don't, on some path).

**Fix.** Server state → one query/cache layer (a query hook, a cache, a
loader, whatever your stack offers), read everywhere from that one place.
Client/UI state → local and minimal. A rule that appears twice → extract it
to one function. Derive, don't duplicate.

**Don't over-apply.** Not every local state is a sin. Genuinely ephemeral
UI state (a toggle, an input draft, a hover flag) belongs where it lives. The
target is *duplicated* and *drifting* state, not all state.

---

# TIER 2 — Module & function hygiene

Real and worth fixing — but local, cheap, and lower-leverage than Tier 1.
This is where the deterministic scanner does most of its work.

## H1 — Complexity & cohesion (line count is an advisory signal, not a verdict)

**Principle.** A unit is too big when it carries more than one reason to
change or exceeds what a reader can hold in their head. The constitution
sets a **280 useful lines** budget (tolerance ~308) — treat that line count
as an **advisory investigation signal** that *starts* the conversation, not
as the verdict. **File size is not technical debt.** A small file is not
automatically well-designed; a large file is not automatically a monolith.
The number only *triggers* a look at architecture, contracts, state,
dependencies, failures, and tests — it never decides on its own. Real debt
is adjudicated by the **Architecture & Technical Debt Governance Gate**
(`contextkit/tools/scripts/arch-debt/`, ADR-0122), which evaluates findings
across its twelve dimensions; the line bands below are never a CI blocker.

**Smells.** Scanner advisory bands: yellow at **240+**, RED-advisory at
**> 308** — a *louder investigation prompt*, not a hard block. The real
smells the agent has to spot beyond the line count: deep
nesting; a function doing two jobs; a name needing a conjunction
(`validateAndSave`, `fetchAndTransform`, or the Portuguese
`validarESalvar`, `buscarETransformar`); grab-bag modules (`utils.ts`,
`manager.ts`, `helpers.ts` that accrete unrelated functions); long parameter
lists; bodies that mix abstraction levels. **The inverse is a smell too:**
one coherent journey shredded across many tiny files — wrappers, pass-through
helpers, and indirection that only add bouncing — is *artificial
fragmentation*, and fragmentation is debt as surely as a god file is.

**Fix — refactor by responsibility, in order of preference:**

- **Extract a unit with one job** — a service/use-case, a pure helper
  module, a custom hook (UI state/effects), a sub-component (a `renderX()`
  becomes a real component), a validator/schema module, a mapper/adapter.
- **Promote inline render functions** (`renderHeader()`, `renderList()`) to
  real components.
- **Lift complex state** (`> 2 useState + ≥ 1 effect`) into a custom hook.
- **Separate layers** — leaked business logic in a transport handler moves
  to a service; *that's* the split, never an arbitrary line cut.
- **Name the orchestrator by its intent** (`processOrder`, not
  `validateAndSaveOrder`).

**Don't over-apply.** A 300-line dumb DTO/constants/types file is fine —
flat, cohesive, no branching. Document the cohesion in a header comment and
move on. Conversely, a 90-line function with three responsibilities and five
levels of nesting is rotten *under* the limit. Judge complexity, not length.
An orchestrator that composes single-purpose units is doing one job
(coordinating) — don't shatter cohesive logic to chase a number. **Never
create an abstraction, helper, wrapper, or file solely to satisfy a numeric
limit, and never preserve mixed responsibilities just to avoid multiple
files.** Split only when a real responsibility or architecture boundary
exists, and *every extraction must justify its cost*; merge or simplify when
one journey is artificially fragmented, and *every merge must prove the
boundaries it crosses stay protected*. **280 starts analysis; it is not a
guillotine.**

### Self-review before proposing a split, a merge, or "this file is too big"

Line count opened the question; these answer it. Run them on the unit before
recommending any structural change (they mirror ADR-0122 §28):

- **Responsibility** — what is this unit's *one* primary responsibility? How
  many independent reasons-to-change does it actually have?
- **Boundaries** — which architecture/domain boundaries does it cross? Is
  there a second authority for any state it owns?
- **Coupling** — does the abstraction I'm about to add *reduce* coupling, or
  only add a layer of bouncing? How many files must change for one behaviour
  change today — and after my proposal?
- **Operability** — can the result be tested, observed, operated, and rolled
  back at least as easily as the original?
- **Risk** — does the change carry any security, data-integrity, reliability,
  or compatibility risk?
- **Debt direction** — does this change *increase*, *preserve*, *reduce*, or
  *pay down* debt? A change that only moves lines around does none of those.

If the honest answers don't point to a real boundary (for a split) or a
genuinely coherent journey with its boundaries intact (for a merge), the
right move is to leave it and note the observation — not to refactor.

## H2 — Single Responsibility

**Principle.** Each function/module/component has **one reason to change.**

**Smells.** A name needing a conjunction signals two jobs. Grab-bag modules
that accrete unrelated functions. Bodies mixing abstraction levels (one line
of high-level intent followed by ten lines of low-level twiddling). Very
long parameter lists.

**Fix.** Extract the parts; give the caller an intention-revealing name. If
a module is a grab-bag, split it by domain. If a function takes 8
parameters, it probably wants an object — or it's actually two functions.

**Don't over-apply.** An orchestrator that *composes* single-purpose units
is doing one job — coordinating. SRP is about *reasons to change*, not
literal single statements. Don't shatter cohesive logic to chase the rule.

## H3 — Separation of concerns (unit level)

**Principle.** Visual logic ≠ business logic ≠ data access. Components stay
"dumb"; logic lives in hooks/services/helpers. Transport dispatches and
never holds business rules. Side effects (IO, network, clock, randomness)
are isolated and injectable.

**Smells.** Network calls inside view code (`fetch()` in JSX). Business math
in a route handler or controller. `new Date()`, `Math.random()`, or direct
env reads buried in business code that pretends to be pure.

**Fix.** Push logic out of components into hooks/services. Make controllers
*call* a service rather than contain one. Inject the clock/random/IO so
they're swappable and testable. Leaked business logic in a controller →
move it to a service; that's the split, not an arbitrary line cut.

**Don't over-apply.** Don't stand up a DI container or a repository layer
for a three-file script. Match the ceremony to the size of the project.
This is the unit-level companion to **S1**; depth scales with complexity.

## H4 — Errors

**Principle.** Validate at the boundary, fail fast with typed, descriptive
errors. Never swallow exceptions silently; never leak stack traces to end
users.

**Smells.** Empty `catch {}`. A `catch` that only `console.log`s and then
continues as if nothing happened. Returning `null`/`undefined` on failure
with no signal to the caller. Throwing bare strings. Rendering raw
`error.message` straight into the UI.

**Fix.** Validate inputs where they enter the system. Throw or return typed
errors with context. Log the technical detail with a correlation id, show
the user a clean generic message, and let unexpected errors propagate to a
boundary that handles them.

**Don't over-apply.** Deliberate best-effort handling is legitimate —
fire-and-forget analytics, optional cache warmups — *as long as the intent
is explicit and logged*. That's not swallowing.

## H5 — Naming

**Principle.** Names reveal intent and domain. Readability beats clever or
compact code — a good name is the first layer of documentation.

**Smells.** Meaningful identifiers wearing meaningless names: `data`,
`temp`, `obj`, `val`, `result`, `arr`, `foo`, `thing` (and equivalents in
any language — e.g. Portuguese `dados`, `valor`, `resultado`).
`manager`/`helper`/`util` as the actual thing carrying meaning.

**Fix.** Rename to the domain concept (`invoices` not `data`, `retryCount`
not `x`); booleans as predicates (`isLoading`); carry units in the name
(`timeoutMs`).

**Don't over-apply.** Short names are fine in tight scope — `i`/`j` in
loops, `x`/`y` in math or coordinates, `err` in a catch, `_` for an unused
arg, single letters in a one-line lambda. The ban is for identifiers that
*carry meaning*, not throwaways.

## H6 — Documentation

**Principle.** Doc-comment non-trivial business logic, hooks, and public
functions (`@param`/`@returns`/`@throws`). Comments explain the **why**,
not the obvious **what**.

**Smells.** Comments restating the code (`// increment i` above `i++`).
Stale comments contradicting the code. A public function that throws with
no `@throws`. A non-obvious workaround with no rationale.

**Fix.** Delete the redundant ones. Add the *why* for anything surprising.
Document the contract on public surfaces — what it promises, what it
guarantees, what it can throw.

**Don't over-apply.** Trivial one-liners and self-evident code don't need
JSDoc. Don't demand ceremony where the name already says it.

## H7 — Tests

**Principle.** Critical paths and failure modes earn tests that would
**actually catch the bug** — tests of *behavior*, not implementation
details.

**Smells.** Happy-path-only suites. Tests asserting internal calls or
object shape instead of observable outcome. Snapshot-only coverage. No test
for the error/edge cases the code clearly handles.

**Fix.** Test contracts and behavior; cover the failure modes; write the
test that fails if the bug returns. See the QA squad (`/test-plan`,
`/scaffold-tests`, `/qa-signoff`) for the wider testing plan.

**Don't over-apply.** Coverage % is not the goal; risk is. Don't pad with
trivial tests to hit a number.

---

# Adjacent concerns — what this rubric does *not* cover

The kit deliberately splits responsibilities across specialised
agents/commands. The rubric stays in its lane:

- **Security (AppSec, supply-chain, infra/cloud)** — `code-security`,
  `security`, `infra-security` agents; `/audit`, `/deps-audit`,
  `/security-setup`. Dispatch the security-team for findings of any of:
  trust-boundary validation, server-side authorization, secret/PII
  exposure, injection/unsafe sinks, dependency CVEs, IAM, IaC misconfig.
- **Accessibility** — `accessibility` agent (design-team).
- **Privacy (LGPD / regional)** — `privacy-lgpd` agent (compliance-team).
- **Architectural decisions (new designs, dependency adoption)** —
  `architect` agent + `/new-adr` + `/simulate-impact`. The rubric audits
  *existing* code's architecture (Tier 1); `architect` decides *new*
  shape.
- **QA / test strategy** — `qa-orchestrator` and the qa-* squad;
  `/test-plan`, `/scaffold-tests`, `/qa-signoff`. H7 in this rubric is a
  code-quality lens on tests; QA owns the deeper test strategy.

---

For severity vocabulary, scope (when Tier 2 is relaxed for spikes), the
review protocol the auditor follows, and the contract between scanner and
agent — see **[`review-protocol.md`](./review-protocol.md)**.
