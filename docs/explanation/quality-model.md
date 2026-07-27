# Quality model

<!-- GENRE: Explanation (understanding-oriented) -->

How this project decides whether code is in good shape — what the architecture-debt
gate adjudicates across its twelve dimensions, why three of them can block a build,
and why the number of lines in a file is a prompt to look rather than a verdict.

## Background: the cheap signals are not the expensive problems

AI-assisted code fails in predictable ways, and the failures that sink a project are
rarely the ones a linter sees. Logic married to the database. A missing authorization
check. The same business rule copy-pasted into four screens and now disagreeing with
itself. State with two owners. Those are expensive because they spread, and because
by the time they hurt, they are load-bearing.

God files and vague names are real problems too. They are the cheap tier: local,
visible, and fixable in an afternoon. The trap is that the cheap tier is also the
easy tier to measure, so a naive quality system spends its authority there — blocking
merges over line counts while the dependency inversion nobody checked ships quietly
underneath.

So the model here is ordered by cost rather than by measurability. Severity is roughly
likelihood multiplied by blast radius multiplied by cost-to-fix-later. Architecture
and boundaries come first; module hygiene comes second; and the deterministic scanner,
which is strongest exactly where the stakes are lowest, is wired to inform rather than
to rule.

## Line count is a signal, not debt

This is the load-bearing rule, so it is stated plainly: **file size is not technical
debt, and no gate in this project can block on it.**

A small file is not automatically well designed. A three-hundred-line file of
constants or type declarations, flat and cohesive with no branching, is fine. A
ninety-line function with three responsibilities and five levels of nesting is rotten
while comfortably "under the limit". Length and quality are weakly correlated at best,
and treating them as the same thing produces two specific harms: abstractions created
only to satisfy a number, and mixed responsibilities preserved only to avoid a second
file.

The scanner emits two advisory bands, at 240 and 308 lines. They are investigation
prompts. Crossing one means "open this file and ask the real questions", and the real
questions are about responsibilities, boundaries, coupling, operability, and risk —
not about the count that opened the conversation.

That the bands cannot block is an invariant with four independent guards in the code,
not a default someone could flip. The configuration ships `lineSignals.blocking` as
false; the config resolver overwrites any supplied value with false regardless; the
emitted finding is created as advisory with a recommendation to observe; and even a
hostile per-rule override to blocking cannot promote it, because blocking requires
deterministic-tier evidence and a line count is classified as heuristic. Constructing
a blocking finding from heuristic evidence throws.

## Artificial fragmentation is also debt

The inverse smell is real and gets equal treatment. One coherent journey shredded
across a dozen tiny files — wrappers, pass-through helpers, indirection that adds
bouncing and nothing else — is debt as surely as a monolith is. A wrapper with a
single consumer, no logic of its own, and a habit of changing alongside the thing it
wraps is a candidate for removal, not a sign of good decomposition.

The practical consequence is symmetric burdens of proof. Split only when a real
responsibility or architectural boundary exists, and every extraction has to justify
its cost: does the abstraction reduce coupling, or only add a layer? Merge only when
the journey is genuinely one journey, and every merge has to show the boundaries it
crosses stay protected. If the honest answers point at neither, the right move is to
leave the code alone and record the observation. A change that only moves lines
around does not reduce debt; it relocates it.

The detector that reads both directions exists and is unit-tested, but it is not yet
wired into the gate's evaluation path. Today this rule is enforced by review and by
the rubric, not by a script.

## The twelve dimensions

The architecture-debt gate adjudicates across twelve dimensions. They are not equally
armed, and the gap between the taxonomy and the wiring is worth knowing before you
rely on it.

| Dimension | What it covers | Status today |
| --- | --- | --- |
| Architecture conformance | Dependency direction, layer boundaries, state authority | Blocking, when configured |
| Security and privacy | Regressions introduced on changed lines | Blocking floor |
| Reliability | Irreversible change without a rollback path | Blocking floor for that check |
| Testability | Critical behaviour left uncovered | Blocking floor |
| Data contracts | Public contract and domain-event preservation | Blocking |
| Complexity | Structural over-complexity; the line bands | Advisory only |
| Modularity | Change amplification, cohesion balance | Observation only |
| Cognitive coherence | Whether a unit can be held in one head | Observation only |
| Observability | Instrumentation adequacy | Taxonomy only, no checks |
| Performance | Hot-path cost | Taxonomy only, no checks |
| Operations and delivery | Operability, rollback, release safety | Taxonomy only, no checks |
| Dependencies | Provenance, pinning, licence posture | Taxonomy only, no checks |

Four dimensions carry no checks at all yet. The last four rows are not a claim that
those concerns are covered — they are the shape the model reserves for them.
Dependency and security concerns beyond the changed-line scan belong to the security
tooling, which is a separate domain with its own commands.

## The floors, and their honest reach

Three floors are meant to be the hard stop: a security regression, an irreversible
change without a rollback, and a critical behaviour left uncovered. Each is
implemented, each is unit-tested, and each emits a blocking finding when it fires.

Two qualifications belong in the same breath.

The floors receive no inputs on the current command-line path. The gate builds its
evaluation context from keys the config resolver does not produce, so under `--ci`
today the security floor scans an empty change set, reliability receives nothing, and
testability sees no behaviours. They are correct and dormant rather than active and
silent — which matters, because "the floors passed" and "the floors had nothing to
look at" are different statements, and only the second is true right now.

The security floor is pattern-based. It matches introduced injection sinks,
fail-open defaults, secret and personal-data exposure, and removed authorization
checks against changed lines. That is regular-expression tier analysis, not data-flow
analysis, and the module says so itself. It will miss things a real analyzer catches.
Treat it as a tripwire on obvious regressions.

There is also a configuration key that reads like it controls the floors and does
not. `architectureDebtGate.floors` is passed through the resolver but never read; the
enforcement level of each floor is fixed in the rule catalogue. Setting a floor to
advisory there changes nothing.

## Unknown evidence is not approval

When the gate cannot get the evidence a rule needs, the finding's status is `UNKNOWN`
and the run's outcome is `UNKNOWN`. That outcome is not in the approving set, so
`--ci` exits non-zero. Missing evidence fails the check; it never passes it.

This shows up in several places by design. A conformance rule with no graph
projection to read emits an unknown finding rather than a clean one. The testability
floor, when the test-impact selector is unavailable, emits an explicit
evidence-missing finding rather than assuming coverage. A floor that throws produces a
synthetic review-required finding rather than a pass.

The approving outcomes are `PASS`, `PASS_WITH_OBSERVATION`, `DEBT_REDUCED` and
`DEBT_ACCEPTED`. Everything else — review required, remediation required, blocked,
unknown, skipped — fails. Worth noting the configuration key named `unknownEvidence`
currently has no consumer: the behaviour is fixed in code, and the key's shipped value
does not describe the outcome the gate actually emits.

## The ratchet: judge the delta, not the total

An absolute quality score is useless on a codebase with history. It either fails
everything on day one or is set so low it never fires. So the gate compares against a
baseline and reasons about direction.

Each finding is identified by rule, path, and symbol — deliberately not by line
number, so that moving code does not read as new debt. Against the baseline a finding
is classified as introduced, transferred to a new path, worsened, pre-existing, or —
when it is gone — reduced or paid off. Introduced and worsened findings are the ones
that can block. Pre-existing debt outside the change set is demoted to a report, which
is the rule that keeps inherited debt from blocking unrelated work.

Two things temper this. The baseline is not a single artifact: the conformance rules
read a graph baseline from configuration, while the ratchet expects a findings list,
and the command-line path currently hands the ratchet the wrong shape — so on that
path every finding classifies as introduced and the debt-reduced outcome is not
reachable. And the change set comes from a diff against `HEAD`, which sees uncommitted
working-tree changes; on a clean checkout it is empty, scope narrowing is inactive, and
nothing gets demoted.

## Conformance is opt-in, and refuses to guess

Three conformance rules carry the strongest authority in the gate: no new dependency
cycle, no import across a forbidden layer boundary, and no second writer for a piece
of state that has a declared owner. All three are relative to a baseline, so only new
violations surface.

None of them fire until the project declares its own layers, its state ownership, and
its write authorities. There is no auto-seeded domain map and no inferred architecture.
When nothing is declared, the three rules are forced to disabled and dropped from the
verdict — dropped, not passed. The shipped configuration carries a commented example
block a project renames and adapts to its own layers.

That refusal to guess is the point. A layer map invented by the tool would produce
confident findings about an architecture nobody agreed to, and the first false block
would teach the team to disable the gate.

## How the verdict is reached

The engine evaluates in a fixed order, and the first thing that fires wins. Disabled
rules are dropped. A tripped floor with a deterministic violation blocks immediately.
Any other blocking deterministic violation blocks next. Then review-required findings,
then unknowns, then the positive signals, then observations, and a clean run passes.

Two properties of that ordering matter more than the sequence. Findings that already
passed or were skipped are dropped before bucketing, so they cannot quietly downgrade a
clean pass. And blocking requires all three of a blocking rule mode, a violation
status, and deterministic-tier evidence — schema-derived, deterministic, graph-derived,
or test-derived. Heuristic evidence cannot block, whatever it is configured as. That
single condition is what keeps the line bands, the fragmentation signals, and the
cognitive-coherence observations permanently non-blocking.

## Running it

```shell
node contextkit/tools/scripts/architecture-debt-gate.mjs        # report, always exits 0
node contextkit/tools/scripts/architecture-debt-gate.mjs --ci   # non-approving outcome exits 1
node contextkit/tools/scripts/architecture-debt-gate.mjs --json  # machine-readable outcome
node contextkit/tools/scripts/tech-debt-scan.mjs                # the deterministic scan alone
node contextkit/tools/scripts/doctor.mjs                        # whether the gate is wired here
```

Without `--ci` the gate always exits zero, so it is safe to run for information at any
time. Only `--ci` and `--json` are parsed; there is no help flag.

## What this page does not cover

This is the reasoning behind the quality verdict, not the per-gate contract. For
required inputs, absent-input behaviour, and per-mode behaviour gate by gate, see the
governance contract reference. For why enforcement lives in the harness at all, and
what a receipt is, see governance and enforcement.

Security beyond the changed-line pattern scan, dependency and supply-chain risk,
accessibility, and privacy obligations are separate domains with their own agents and
commands. Nothing here substitutes for them. Test strategy proper — what to test and
at which layer — belongs to the QA tooling; this page only covers the coverage floor.

## Related

- [Governance contract](../reference/governance-contract.md) — per-gate inputs and behaviour.
- [Governance and enforcement](./governance-and-enforcement.md) — modes, receipts, degradation.
- [Configuration](../reference/config.md) — the debt-gate keys and their defaults.
- [Audit and test](../how-to/audit-and-test.md) — running the scans in practice.
- [Domain model](./domain-model.md) — declaring the layers conformance needs.
- [Troubleshoot an install](../how-to/troubleshoot.md) — when a check fails unexpectedly.
