# ContextDevKit

[![CI — GitHub Actions full gate on the main branch: click for the current pass or fail state](https://github.com/reiTavares/ContextDevKit/actions/workflows/ci.yml/badge.svg)](https://github.com/reiTavares/ContextDevKit/actions/workflows/ci.yml)
[![npm — currently published version of the contextdevkit package](https://img.shields.io/npm/v/contextdevkit)](https://www.npmjs.com/package/contextdevkit)
![Node — requires version 18 or newer](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![License — MIT](https://img.shields.io/badge/license-MIT-blue)
![Runtime dependencies — zero on the hot path](https://img.shields.io/badge/runtime%20deps-0-success)

**ContextDevKit is a business-driven, governance-first development platform for coding
agents.** Work starts from business intent, gets classified by deterministic
scoring — not by asking a model — and is then driven through a ceremony the harness
*enforces* with hooks, receipts and specialist agents. Portable into any project, any
stack, three agent hosts.

Almost all of it runs automatically, and almost all of it can be driven end to end by
an agent. You decide how much, with a dial that never lowers the quality bar — only who
presses the button.

Every claim below is falsifiable. Start with this one — **no rule in this kit depends on
the model choosing to obey it.** Run it in any installed project:

```bash
node contextkit/tools/scripts/doctor.mjs
```

It prints the hooks wired at your level, the git hooks on disk, and the install mode,
then exits non-zero when the wiring disagrees with your configuration. A prompt-only kit
cannot produce that output, because there is nothing to inspect.

## The problem

A session ends. The reasoning behind the schema, the three approaches already rejected,
the reason that retry loop exists — gone. The next session starts from a blank slate and
rebuilds a worse version of a decision you already made.

Worse, the work has no *why* attached. Tickets arrive detached from the value they were
supposed to create, so nobody can tell whether a change was worth making, and the drift
goes unnoticed until someone re-litigates it in review.

A memory file helps, and only that far: **it is instruction.** Under context pressure the
model can skip it, and nothing detects that it did. You are left with confident output,
no accountable trail, and no way to tell a verified result from a plausible sentence.

## How work is structured

Three entity kinds, each with a real shape on disk. This is the spine — everything else
in the kit exists to keep it intact.

**Business (`BIZ-####`)** — a durable strategic capability. It carries the business case,
the investment decision, the approved plan and its own governance contract, and it owns
the workflows that deliver it.

```text
business/BIZ-0005-governed-agent-activation/
├── business-case.md            the problem and the value hypothesis
├── investment-decision.md      what is being committed, and by whom
├── approved-plan.md            the plan a human accepted
├── business.json               typed state — kind, value intents, relations
├── governance-contract.json    the ceremony and evidence this context owes
├── growth.md · architecture/   supporting analysis
├── workflows/                  the workflows this Business owns
└── done/ · reports/            terminal artifacts and evidence
```

**Operation (`OP-####`)** — maintaining, fixing or executing inside something that
already exists. Deliberately lighter than a Business.

```text
operations/OP-0010-documentation-restructure/
├── operation.json              typed state — kind, intents, decision coverage
├── reason.md                   why this Operation exists
├── tasks.md                    board cards linked to it
└── workflows/                  nested workflows, when the work needs them
```

**Workflow (`WF-####`)** — one delivery unit, always nested under the context that owns
it. A workflow is a checkpointed spec pack, not a ticket.

```text
workflows/WF-0096-docs-tooling-and-gates/
├── index.md          phase state — intake · prd · spec · adr · roadmap ·
│                     pipeline · ship · testing · conclusion
├── prd.md            problem, goals, users, non-goals, success metrics
├── spec.md           architecture read, design, contracts, test plan
├── decisions.md      the decision records that govern it
├── tasks.md          the board cards that implement it
├── memory.md         working notes that survive the session
└── reports/          completion evidence
```

Two invariants hold this together. A workflow with an owner **lives under that owner's
directory**, so no delivery floats free of its justification. And workflow numbering is a
single **global** sequence, not a per-owner counter — gaps are normal and must never be
renumbered, because the number is an identity.

Full model and vocabulary: [domain model](docs/explanation/domain-model.md) ·
[glossary](docs/reference/glossary.md).

## The classifiers are deterministic, not a prompt

Every request is classified before substantive work, by **weighted substring scoring over
a policy file** — no model call, same input always yields the same verdict, and the
tables are bilingual (English and Portuguese signals carry equal weight). Editing a row
is a governance act, not a tweak.

| Axis | What it decides | Vocabulary |
| --- | --- | --- |
| Nature | Business or Operation | `business` · `operation` |
| Business kind | The shape of a strategic capability | `TRANSFORMATION` · `INITIATIVE` · `PROGRAMME` · `FEATURE` · `ENABLER` |
| Value intent | Why the work has value | `CREATE` · `PROTECT` · `RECOVER` · `ENABLE` · `IMPROVE` · `LEARN` · `COMPLY` · `SERVE_MISSION` |
| Execution mode | How much ceremony the work earns | `direct` · `batch` · `workflow` |
| Ceremony shape | The concrete artifact set | `quick-fix` · `batch-operation` · `single-workflow-operation` · `decision-only` · `multi-workflow-program` |
| Journey branch | The ordered path the harness enforces | `operation-direct` · `operation-batch` · `operation-workflow` · `business-decision` · `business-workflow` |
| Relations | How contexts depend on each other | `supports` · `contributes-to` · `triggered-by` · `derived-from` · `blocks` · `blocked-by` · `protects` · `replaces` |

The nature classifier defaults to **Operation** and only escalates to Business when the
score clears a floor by a margin, above a confidence threshold. That asymmetry is
deliberate: over-classifying routine maintenance as strategic work is the expensive
mistake, so the cheap ceremony is the default and the expensive one must be earned.

Proportionality is a feature. A trivial fix does not pay for a full spec pack — the
classifier says so, and the journey for that branch is correspondingly short.

Two further scores drive implementation quality: a **code-mutation intent** score that
recognises when a request is really a write (an actual write attempt is an authoritative
override, not a guess), and a **domain-applicability** score that decides when a request
deserves explicit domain modelling instead of being treated as plumbing. Together they
select which specialists must be in the room before code is written.

See it decide, without mutating anything:

```bash
node contextkit/tools/scripts/work.mjs intake "<your objective>"
node contextkit/tools/scripts/domain.mjs "<your objective>"
```

Details: [business-driven development](docs/explanation/business-driven-development.md).

## Decisions are the authorization mechanism

Nothing material gets authorized by a conversation. A **decision record** is a typed,
validated artifact with its own lifecycle, and it is what authorizes a Business, an
Operation, a workflow, or any change to something that already exists.

Every request is checked for **decision coverage** before substantive work. When an
entity has no governing decision, the harness says so by name rather than proceeding
quietly:

```text
NEEDS_DECISION: "work entity" has no decisionRefs.
A governing accepted ADR is required before material work proceeds.
```

### The kinds, and what each authorizes

Eight kinds, a closed set — adding one is itself a decision.

| Kind | Authorizes |
| --- | --- |
| `BUSINESS_AUTHORIZATION` | Standing up or changing a Business context |
| `OPERATION_AUTHORIZATION` | Standing up or changing an Operation context |
| `ARCHITECTURE` | A structural or design choice |
| `POLICY` | A rule the platform will enforce afterwards |
| `ROUTINE_OPERATION_GOVERNANCE` | Pre-authorizing recurring, low-materiality operations, so routine work is not blocked waiting on ceremony |
| `EMERGENCY_GOVERNANCE` | Acting under time pressure, recorded as such rather than skipped |
| `COMPLIANCE` | An obligation imposed from outside |
| `LIFECYCLE` | Concluding, superseding or retiring something |

Each record also declares **how far it reaches** — `platform`, `business`, `operation` or
`workflow` — separately from **whose** decision it is. Scope and ownership are orthogonal
on purpose: a platform-wide policy can be owned by a single Operation.

### The lifecycle, and the one rule that cannot be configured away

```text
proposed ──→ accepted ──→ superseded
    └──────→ rejected
```

`accepted` and `superseded` and `rejected` are terminal in the directions shown; there is
no path back. And the invariant the whole model rests on:

> **`accepted` implies the approving actor was human.**

That is not a policy setting. The accept verb **refuses** when the actor is anything other
than a human, and it names the schema rule in the refusal. The agent may draft a decision,
argue for it, and fill in every field — it cannot stamp it. No autonomy grade, including
the highest, changes this.

### Authorizing something, end to end

Mutators are dry-run by default. Run each command without `--apply` first and read the
receipt; add `--apply` when the plan is what you wanted.

```bash
# 1. does this objective even need a decision, and is one already covering it?
node contextkit/tools/scripts/decision.mjs need "<your objective>"
node contextkit/tools/scripts/decision.mjs search "<your objective>"

# 2. draft it — kind, scope and owning context are declared up front
node contextkit/tools/scripts/decision.mjs create \
  --kind OPERATION_AUTHORIZATION --title "<the decision>" \
  --primary-context OP-0010 --apply

# 3. bind it to the entity it governs
node contextkit/tools/scripts/decision.mjs link --id ADR-0153 --apply

# 4. a human accepts it. this step refuses any other actor
node contextkit/tools/scripts/decision.mjs accept --id ADR-0153 --actor human --apply
```

Changing something already accepted is not an edit. It is a **supersede**: the old record
keeps its history and points forward, the new one points back, and that transition is
also human-gated.

```bash
node contextkit/tools/scripts/decision.mjs supersede --id ADR-0153 --actor human --apply
```

Read the whole corpus at any time, and validate it:

```bash
node contextkit/tools/scripts/decision.mjs render      # the catalog
node contextkit/tools/scripts/decision.mjs validate    # front matter across every record
```

Hard calls get a **deliberation** first: independent specialist voices argue the question
blind to each other, a separate synthesizer converges, and the result feeds the decision's
context. An unresolved deliberation is a valid outcome — it hands you the tradeoff to
break instead of manufacturing agreement.

```bash
/debate "<the decision question>"
```

Full model: [record a decision](docs/how-to/record-a-decision.md) ·
[deliberation council](docs/explanation/deliberation-council.md) ·
[governance contract](docs/reference/governance-contract.md).

## Almost everything is automatic

The kit is designed so an agent can drive the lifecycle, and a human supervises the
result rather than each step.

| Runs on its own | Driven by an agent on request | Always yours |
| --- | --- | --- |
| Boot context at session start | Full feature pipeline (`/ship`) | Accepting a decision record |
| Edit ledger and drift detection | Parallel workstreams in isolated worktrees (`/swarm`) | Anything touching secrets |
| Request classification and squad routing | Multi-agent deliberation on a hard call (`/debate`) | Force-push |
| Structural graph refresh, detached from boot | Test plan, scaffolding, QA sign-off | Editing the gates themselves |
| Gate evaluation and receipt checks | Business and Operation ceremony (`/work`) | Raising the autonomy grade |
| Session-end sweep of concluded workflows | Session registration and changelog entry | |

The **autonomy dial** (grades 1 to 4) decides how much of the middle column happens
without a confirmation: manual, suggest-and-wait, auto-except-decisions, and full-auto on
feature branches. Lowering the grade turns automatic behaviour back into a prompt. It
never lowers quality — the same gates, receipts and specialists apply at every grade. The
right-hand column is a floor that no configuration removes, including at grade 4.

```bash
node contextkit/tools/scripts/autonomy.mjs      # the grade in force and what it refuses
```

## Specialist agents that govern quality

36 agents across 9 squads, each with a lead and a set of paths it owns. Routing is
**path- and signal-based**, so the squad whose surface a change provably touches is the
one that engages — and a squad with nothing to say emits nothing.

| Squad | Lead | Engages on |
| --- | --- | --- |
| devteam | architect | Core library, utilities, services — plus implementation, review and domain modelling |
| qa-team | qa-orchestrator | Tests and specs; routes to unit, integration, end-to-end, performance and adversarial specialists |
| security-team | security | Auth, middleware, trust boundaries, dependencies, infrastructure |
| design-team | ux-designer | Components, pages, flows, accessibility, conversion surfaces |
| product-team | product-owner | Roadmap and requirements |
| ops-team | devops | Pipelines, deploys, environments, observability |
| growth-team | growth | Analytics, funnels, retention, discoverability |
| compliance-team | privacy-lgpd | Personal-data handling and regional obligations |
| agent-forge | forge-orchestrator | Forging portable agent packages |

What this buys you concretely: a change to an auth path pulls in the security lead
whether or not you remembered to ask; a code change cannot reach completion without the
reviewer having looked; and quality is judged against **domain conformance** — dependency
direction, context boundaries, cross-context access — rather than against a line count.

File size is an **advisory investigation signal and never a blocker.** A small file can
be badly designed and a large one can be clean, and artificial fragmentation is debt too.
See [quality model](docs/explanation/quality-model.md).

Roster and triggers: [agents reference](docs/reference/agents.md) ·
[active squads](docs/explanation/active-squads.md).

## The engineering rubric it ships with

Every install receives four documents that are loaded into agent context, not merely
filed: the rubric, the review protocol, behavioral discipline, and worked before/after
examples. They are what the specialist agents judge against, so the standard the reviewer
applies is the standard you can read.

The rubric is ordered by what actually costs the project, not by what a linter can match:

```text
severity ≈ likelihood × blast radius × cost-to-fix-later
```

### Tier 1 — system and architecture

The high-leverage tier, and the one a line-counting linter is blind to.

| Rule | Principle |
| --- | --- |
| S1 Dependency direction | Dependencies point inward; the domain does not know how it is stored or transported |
| S2 Boundaries and encapsulation | Each module has a deliberate public surface; callers depend on the contract, not the guts |
| S3 Coupling and cycles | No import cycles; watch high fan-in on things that change often and high fan-out as a missing decomposition |
| S4 State location | Every piece of state has one source of truth; derived data is computed, not stored |
| S5 Bounded contexts and ubiquitous language | A model is valid only inside a boundary; the same word in two contexts is two models, and the words in the code are the words in the conversation |
| S6 Aggregates, invariants, transactional boundaries | Where an invariant exists, one owner enforces it in one transaction. **No invariant means no aggregate** |
| S7 Seam contracts and anti-corruption | Every seam has an explicit contract; foreign shapes are translated at the edge instead of spreading inward |

**The domain lane is profile-gated, and that is the point.** S5 through S7 apply only once
the resolved implementation profile carries domain weight. On a simple or modular profile
they are **not findings at all** — reporting them there is a manufactured finding, and the
review says "not assessed" instead. A breach of a *declared* domain boundary is a merge
blocker; the same observation against an auto-seeded, unreviewed map is at most a
candidate — propose the boundary, do not sentence the code for missing one.

The classifier decides, and it is the same signal that puts the domain-modeling specialist
in the room, so review and build judge the work against one bar:

```bash
node contextkit/tools/scripts/domain.mjs "<your objective>"
```

### Tier 2 — module and function hygiene

Real and worth fixing, but local and cheap: complexity and cohesion, single
responsibility, separation of concerns, errors, naming, documentation, tests — and waste.

**Lean code is an explicit rule, not a slogan.** The cheapest code is the code you did not
write, every line is inventory someone must read and carry, and **removing code is a
first-class contribution.** Six named forms of waste: speculative generality (an
abstraction with exactly one implementation, written for a second consumer that never
arrived), dead and unreachable code, pass-through layers that add a hop and no meaning,
duplicated business rules, defensive code for impossible states, and premature
optimization with no measured hot path.

The calibration matters as much as the rule: lean is not terse. Names, guard clauses at
real boundaries and tests that catch bugs are the work, not waste. And pre-existing dead
code is routed to its own scoped task — never demanded inside an unrelated change.

### Severity, and what can actually block

| Label | Meaning |
| --- | --- |
| Blocker | Fix before merge. Fails the debt gate — a real debt floor, never file size alone |
| Hard | Clear violation with no cohesion excuse |
| Candidate | Judgment call; may be justified. Explain the tradeoff |
| Nit | Mention once, do not litigate |

Two properties keep this from becoming bureaucracy. **Line count is always advisory** — an
elevated reading is a louder investigation prompt, never a blocker; the finding earns its
severity from the real defect the investigation uncovers, or it stays advisory. And
**every rule carries a "don't over-apply" clause**, because a respected guardrail beats a
flagged false positive: a single-context application has one bounded context and that is
the correct answer; CRUD with no invariants needs no aggregate; a three-file script does
not need a hexagonal architecture.

Rigor scales to stakes: the full rubric applies to production paths, while spikes and
throwaway code relax the hygiene and test bar deliberately.

```bash
/analyze-code-ia-practices     # run the rubric and get proposals, not random splits
```

Full rubric and protocol: [quality model](docs/explanation/quality-model.md) ·
[audit and test](docs/how-to/audit-and-test.md) ·
[domain engineering](docs/how-to/use-domain-engineering.md).

## The capability pillars

The kit's own governance record, each pillar a program with its decisions and workflows
on disk. This is what the platform is made of.

| Pillar | What it delivers |
| --- | --- |
| Business-driven development and decision governance (`BIZ-0001`) | The spine above: business intent, the deterministic classifiers, the journey the harness enforces, and the rule that the agent may propose a decision but never accept it |
| Domain engineering and deterministic implementation (`BIZ-0003`) | The implementation profile — domain modelling, ubiquitous language, bounded contexts, state authority — plus the scores that decide when it applies |
| Structural knowledge graph and code intelligence (`BIZ-0004`) | A queryable graph of the codebase, so an agent answers structural questions from an index instead of re-reading the tree |
| Governed agent activation and quality (`BIZ-0005`) | The two-tier dispatch gate, agent evidence, the reviewer gate on every material change, graph-driven cross-squad selection, and retiring the line-count nag |
| Methodology plane integrity and self-governance (`BIZ-0006`) | The methodology governing itself: canonical ceremony shapes, finalization integrity, lifecycle verbs, drift guards, and a cross-host canonical journey |

One more program, the governed agent runtime and execution platform (`BIZ-0002`), is
**proposed direction, not shipped capability** — it is named here for honesty about the
roadmap, and nothing in the kit today depends on it.

## Instruction versus enforcement

Four mechanisms carry the difference. None run at the model's discretion.

**Hooks that block, not ask.** Boot context loads before the first message. Every edit
lands in an append-only ledger. A session cannot close silently with unregistered work.
From level 5, a blast-radius gate blocks edits to paths you flagged high-risk until an
impact record exists.

Said precisely, because it matters in review: hooks are a **governance** control, not a
security control. They exit 0 and stay quiet on their own errors by design, so a broken
hook can never break real work.

**Receipts, not assertions.** A gate is satisfied by script output alone. "The tests
passed" as prose is not evidence, and neither is a stale, wrong-branch or bypassed
receipt. When a check cannot run the result is `skipped` — **never** a pass. Absent data
never counts in your favour.

**The agent cannot approve its own work.** Proposals move draft → approve → revise →
reject, and the approving actor is never the one that drafted.

**Graceful degradation instead of false blocking.** The enforcement gate ships guarded by
default and is safe to ship active precisely because it **degrades to advisory whenever it
cannot evaluate safely** — a fresh install is never falsely blocked, and a refusal always
names the exact corrective command.

Full behaviour, per gate: [governance and
enforcement](docs/explanation/governance-and-enforcement.md) ·
[governance contract](docs/reference/governance-contract.md).

## Proof you can run

Every row is a command that exists on disk and prints the claim instead of restating it.

| Command | What it proves |
| --- | --- |
| `doctor.mjs` | Hook wiring matches the configured level; git hooks present; install mode |
| `work.mjs intake "<objective>"` | The classifier's verdict for a real request, read-only |
| `work.mjs status` | Business and Operation contexts, and their decision coverage |
| `workflow-assist.mjs --list` | Active workflows and the phase each is parked at |
| `domain.mjs "<objective>"` | Which implementation profile and specialists a request selects |
| `project-map.mjs --find <symbol>` | A symbol resolves to a file without a repository-wide search |
| `graph-query.mjs` | The structural graph is readable, or honestly reports `available: false` |
| `autonomy.mjs` | The autonomy grade in force, and what it still refuses |
| `token-report.mjs` | Token spend measured in your repo, not estimated here |

All live under `contextkit/tools/scripts/` in an installed project.

Measured in this repository on 2026-07-27: **83 slash commands, 36 agents, 83 skills,
3 native hosts**, and a structural graph of **24,157 nodes over 46,949 edges**. Those are
this repo's numbers on that date — the commands above print yours.

## Install

```bash
# from npm — level 3 for an empty folder, level 7 when the folder already has code
npx contextdevkit --target . --yes

# or straight from GitHub, no npm account needed
npx github:reiTavares/ContextDevKit --target . --yes
```

Pick how the kit lives in git. Switching later is non-destructive — it toggles a managed
local exclude block, never your index.

| Mode | Choose it when | Effect |
| --- | --- | --- |
| Local-only (default) | Solo work, an experiment, evaluating the kit | Kit artifacts stay out of git history; updates never flood your commits. Teammates and CI do not see it. |
| Tracked (`--tracked`) | A team, several machines, or CI | No exclude block, so you can commit the kit and everyone who clones inherits the same memory, agents and governance. |

An empty folder is scaffolded end to end. An existing project has its stack detected, and
your own boot file is never clobbered — the kit writes a companion file for you to merge.
Pre-existing git hooks are preserved and backed up.

This is a code-execution tool. Install it with the care you give any dependency you run:
it writes git hooks from level 3 upward and host hooks that run `node` on each session,
commit and push. Pin a tag for a reproducible install. Full inventory of what lands on
disk, and how to remove it: [footprint](docs/reference/footprint.md).

Then open the project in your host and run one thing:

```text
/setupcontextdevkit
```

It inspects the project, tunes the configuration to your stack, scaffolds the domain
sub-agents, records a baseline decision and logs the session — from "kit installed" to
"kit fitted to this project" in one pass.

## Levels

The **level** decides which capabilities exist; the **autonomy grade** decides how much
of them runs without you. Independent dials. Every level keeps everything below it.

| Level | What it adds |
| --- | --- |
| 1 Memory | Boot context, session log, decision records, changelog |
| 2 Ledger | Drift detection — edit tracking plus a session-end nudge |
| 3 Multi | Claims, worktrees, derived indices, git hooks (default for a new project) |
| 4 Squads | Specialist sub-agents, structural graph, domain gates |
| 5 Proactive | Blast-radius gate, journey enforcement, completion evidence, sub-agent scoping |
| 6 Autonomy and insight | Ship pipeline, learning loop, measured metrics |
| 7 Ecosystem and scale | Multi-repo fleet, agent tuning, visual tests, playbooks, token and cost insight (default for an existing codebase) |

```bash
node contextkit/tools/scripts/context-level.mjs      # show, or pass 1-7 to move
```

Choosing: [install and choose a level](docs/how-to/install-and-choose-a-level.md) ·
[levels reference](docs/reference/levels.md).

## Three native hosts

The same engine, the same scripts, three first-class front ends.

| Host | Surface | Runner |
| --- | --- | --- |
| Claude Code | Slash commands, sub-agents, hooks | native |
| Antigravity | Skills, personas, playbooks | `node ctx.mjs <command>` |
| Codex | Skills plus subagent definitions | `node cdx.mjs <command>` |

Other editors reach the same memory through opt-in context bridges, which project context
without the native hook layer — they inform the agent and enforce nothing. See
[work across hosts and bridges](docs/how-to/work-across-hosts-and-bridges.md).

## Where to go next

**Get running.** [Install and choose a level](docs/how-to/install-and-choose-a-level.md) ·
[Configure](docs/how-to/configure-contextkit.md) ·
[Configuration reference](docs/reference/config.md) ·
[Upgrade](docs/how-to/upgrade-and-update.md) ·
[Troubleshoot](docs/how-to/troubleshoot.md)

**Learn the method.** [First business case](docs/tutorials/first-business-case.md) ·
[Run a business case](docs/how-to/run-a-business-case.md) ·
[Run a workflow](docs/how-to/run-a-workflow.md) ·
[Anatomy of a business, operation and
workflow](docs/how-to/anatomy-of-business-operation-workflow.md)

**Understand the model.** [Business-driven
development](docs/explanation/business-driven-development.md) ·
[Governance and enforcement](docs/explanation/governance-and-enforcement.md) ·
[Quality model](docs/explanation/quality-model.md) ·
[Domain model](docs/explanation/domain-model.md) ·
[The three economies](docs/explanation/the-three-economies.md) ·
[Glossary](docs/reference/glossary.md)

**Go deeper.** [Knowledge graph](docs/how-to/use-the-knowledge-graph.md) ·
[Domain engineering](docs/how-to/use-domain-engineering.md) ·
[Forge an agent package](docs/how-to/forge-an-agent-package.md) ·
[Connect MCP servers](docs/how-to/connect-mcp-servers.md) ·
[Parallel swarm](docs/how-to/run-a-parallel-swarm.md) ·
[Reduce token cost](docs/how-to/reduce-token-cost.md)

**Trust and review.** [Footprint](docs/reference/footprint.md) ·
[Data posture](docs/reference/data-posture.md) · [Privacy](docs/PRIVACY.md) ·
[Security policy](SECURITY.md) ·
[Memory model](docs/reference/memory-model.md)

Full index, organized by [Diátaxis](https://diataxis.fr/), in
[docs/README.md](docs/README.md). Guia em português: [instrucoes.md](instrucoes.md).

## FAQ

**What leaves my machine?** No telemetry, no account, no endpoint belonging to this
project. Memory, ledger and metrics are plain files in your repository. Two calls in a
stock install reach your *own* git remote. Adding an MCP server is the one opt-in path
that grants a third party read access to the repo. Details:
[data posture](docs/reference/data-posture.md).

**Does it need an API key?** Not for the kit. Your agent brings its own authentication;
the kit is plain Node scripts and host configuration.

**Does the ceremony slow down small changes?** No, and that is enforced rather than
promised: the classifier resolves a trivial fix to the shortest branch, and the artifacts
that branch owes are correspondingly few. The expensive ceremony has to be earned by
score.

**What does it cost in tokens?** Not a number this page can honestly give you; it depends
on repo size, level and accumulated memory. It is measurable rather than estimated —
`token-report.mjs` attributes spend per session and per command in your own project.

**Does it work outside my stack?** The engine is stack-agnostic — plain Node with zero
runtime dependencies on the hot path, so levels 1 to 3 run in a project with nothing
installed. Stack detection tunes paths and gates to what you already use, and never
installs a second test framework or formatter.

**What breaks if I uninstall?** Nothing in your source. Uninstalling unwires the hooks
and leaves your memory and boot file in place; `--purge` also removes the engine
directory. Pre-existing git hooks are restored from their backups.

## Contributing

Source lives under `templates/` and `tools/` — never in an installed `contextkit/` copy.
[CONTRIBUTING.md](CONTRIBUTING.md) has the immutable rules: zero hot-path dependencies,
hooks never break real work, every addition ships with a test.

## License

MIT — see [LICENSE](LICENSE).
