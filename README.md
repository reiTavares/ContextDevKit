# ContextDevKit

**AI Software Engineering Governance Harness for adaptive, evidence-driven development.**

ContextDevKit is a host-agnostic engineering harness that gives AI coding agents persistent project intelligence, long-term memory, governed work state, adaptive engineering guidance, and evidence-backed delivery across Claude Code, OpenAI Codex, Google Antigravity, Grok, and compatible execution hosts.

It does **not** replace your coding agent, model provider, tool runtime, or agent loop.

It sits around them as the durable engineering layer of the project.

> **Beginners get engineering guardrails. Senior engineers get leverage. Neither gets unnecessary ceremony.**

ContextDevKit is designed to help projects move from vibe coding to disciplined AI-native software engineering without turning methodology into bureaucracy.

**Documentation:** [English](docs/README.md) · [Português (Brasil)](docs/pt-BR/README.md) · [Español](docs/es-ES/README.md) · [Русский](docs/ru-RU/README.md) · [हिन्दी](docs/hi-IN/README.md) · [简体中文](docs/zh-CN/README.md) · [العربية](docs/ar/README.md) · [עברית](docs/he-IL/README.md) · [all locales](docs/LANGUAGES.md)

## Why ContextDevKit exists

AI coding agents are increasingly capable, but a coding session is not a software engineering system.

Without a durable project harness, agents can forget decisions made in previous sessions, ignore existing specifications and ADRs, solve the same problem twice, lose track of unfinished work, create architectural drift, declare work complete without sufficient evidence, apply the same amount of process to a typo and a system migration, or depend too heavily on the behavior of one model or one coding host.

ContextDevKit adds the project-level engineering system around the agent.

```text
                         CONTEXTDEVKIT
              AI SOFTWARE ENGINEERING HARNESS

 ┌──────────────────────────────────────────────────────────────┐
 │ Intent & Intake                                              │
 │ conversation · exploration · mutation · clarification        │
 ├──────────────────────────────────────────────────────────────┤
 │ Business-Driven Development                                  │
 │ Business · Operation · none                                  │
 │ direct · batch · workflow                                    │
 ├──────────────────────────────────────────────────────────────┤
 │ Project Intelligence                                         │
 │ Project Map · graph · ADRs · specs · decisions · reports     │
 ├──────────────────────────────────────────────────────────────┤
 │ Long-Term Memory                                             │
 │ work history · preferences · decisions · execution evidence  │
 ├──────────────────────────────────────────────────────────────┤
 │ Engineering Execution                                        │
 │ tasks · workflows · specialists · task compiler · compact    │
 ├──────────────────────────────────────────────────────────────┤
 │ Evidence-Driven Engineering Loops                            │
 │ implement → evaluate → find → fix → re-evaluate → deliver    │
 ├──────────────────────────────────────────────────────────────┤
 │ Governance                                                   │
 │ guarded quality floors · canary guidance · shadow analysis   │
 └──────────────────────────────┬───────────────────────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
         Claude Code           Codex        Other hosts
              │                 │                 │
              ▼                 ▼                 ▼
          model/tools       model/tools       model/tools
```

The coding host executes.

**ContextDevKit preserves the intelligence of the project.**

## From vibe coder to senior engineer

ContextDevKit is intentionally useful at different levels of engineering maturity.

| User | ContextDevKit adds |
| --- | --- |
| **Vibe coder** | Tests, review, quality floors, persistent memory and engineering structure the user may not know to request explicitly |
| **Developer** | Context, task state, reusable workflows, evidence, reports and continuity |
| **Senior engineer** | Faster execution, specialist delegation, architecture awareness and durable decisions without removing engineering authority |
| **Tech Lead** | Shared engineering memory, ADRs, quality policy, work ownership and cross-session consistency |
| **AI-native team** | A project intelligence layer that survives changing models, agents and coding hosts |

The objective is not to force every user into the same methodology.

> **Use enough engineering for the risk and complexity of the change — no more, no less.**

## The first decision: is there actually work to govern?

ContextDevKit 4 is deliberately quiet.

Before governance starts, the interaction is classified as `conversation`, `exploration`, `mutation`, or `unclassified`.

| Interaction | Behavior |
| --- | --- |
| **Conversation** | Answer normally. No task, workflow, receipt, or durable project state. |
| **Exploration** | Read and investigate without creating governed work. |
| **Mutation** | Activate intake and work classification. |
| **Unclassified** | Ask one short clarification instead of guessing. |

A real write attempt is authoritative and promotes the interaction to mutation. Once promoted, the interaction does not fall back to read-only classification during that revision.

```text
User request
    │
    ▼
Interaction classifier
    │
    ├── conversation ──→ answer
    ├── exploration ───→ investigate
    ├── unclassified ──→ ask once
    └── mutation
            │
            ▼
         Intake
```

This matters because **governance should begin when real project state is about to change, not every time a human talks to an AI.**

## The Intake Envelope

Once a mutation is confirmed, ContextDevKit assembles a transient **Intake Envelope**.

The Intake Envelope is a mental model for the canonical signals the runtime already produces. It is **not another mandatory file, receipt, or ceremony**.

It answers:

- What is the user actually asking?
- Does this belong to existing unfinished work?
- What kind of durable owner, if any, does the work need?
- How complex and risky is it?
- What is the smallest useful execution shape?
- What existing decisions or Business context may be relevant?
- What evidence explains the classification?

Conceptually:

```text
Intake Envelope
├── interaction
│   └── conversation | exploration | mutation | unclassified
├── existing work
│   └── explicit | inferred | ambiguous | new | none
├── nature
│   └── business | operation | none | unclassified
├── execution shape
│   └── direct | batch | workflow
├── complexity / tier
├── domain / risk context
├── value intent
├── decision need / decision match
├── possible Business relationship
└── reasons + evidence
```

The important property is not the number of signals. It is that classification is explainable, reproducible, evidence-based, fail-open, and independent of one model's opinion.

## Business-Driven Development

ContextDevKit treats software work as more than a stream of disconnected coding tasks, without forcing every code change into a business hierarchy.

### Business

A `Business` (`BIZ-####`) represents a durable strategic capability, product, initiative, or decision whose outcome is worth remembering across multiple pieces of work.

Examples include a new product, a new market, a strategic platform capability, a multi-month initiative, or a durable compliance capability.

Business owns the durable **why**.

### Operation

An `Operation` (`OP-####`) represents durable operational, maintenance, incident, recovery, or improvement work around an existing capability.

Examples include production recovery, dependency modernization, a maintenance programme, reliability work, or a substantial set of related refactors.

Operation owns a durable operational **reason for work**.

### none

`none` is a first-class and normal result.

A focused feature, localized bug fix, documentation change, or technical improvement does **not** need a Business or Operation merely because ContextDevKit exists.

This prevents governance memory from becoming a junk drawer.

### Business and Operation are ownership, not execution shape

Work ownership and execution topology are independent decisions.

A Business does not automatically require a Workflow. An Operation does not automatically require a Workflow. Architecture terminology, ADRs, or compliance vocabulary do not automatically require a Workflow.

ContextDevKit chooses the smallest execution shape supported by the work:

- **direct** — usually one to three cohesive tasks;
- **batch** — usually four to twelve related tasks without strong ordering;
- **workflow** — real dependencies, waves, mandatory ordering, multi-session execution, coordinated integration, cutover/rollback, or an explicitly requested workflow.

```text
Nature                    Execution shape

Business ─────────┐       direct
Operation ────────┼────── batch
none ─────────────┘       workflow
```

These are two independent axes. That separation is one of the ways ContextDevKit avoids workflow inflation.

## Existing work before new work

Before creating new governed context, ContextDevKit can resolve whether the mutation belongs to something already in progress.

The result may be `explicit`, `inferred`, `ambiguous`, `new`, or `none`.

A completed item is not silently reopened. An ambiguous match is not silently selected. A weak Business relationship is not silently promoted into ownership.

For Operations that may contribute to a Business, the deterministic matcher can suggest a relationship from explicit ids, work kind, value intent, status, affinity, and textual overlap. The matcher never confirms strategic ownership by itself.

This helps prevent duplicate workflows, forgotten pending tasks, fragmented history, and incorrect ownership.

## Evidence-driven engineering loops

ContextDevKit is built for more than one-shot generation.

For meaningful engineering work, delivery is a loop:

```text
IMPLEMENT
    │
    ▼
EVALUATE
    │
    ├── no relevant findings ──────────────┐
    │                                      │
    └── findings                           │
           │                               │
           ▼                               │
         FIX                               │
           │                               │
           ▼                               │
      RE-EVALUATE                          │
           │                               │
           └─────────────── loop ──────────┘
                                           │
                                           ▼
                                      FRESH EVIDENCE
                                           │
                                           ▼
                                         DONE
```

A task rejected after testing can return to a fresh execution cycle. Current-cycle evidence is reset where required so an old green result does not automatically validate a changed implementation. A completed Workflow can reopen when later QA feedback invalidates the prior completion.

This makes `done` an engineering state backed by evidence rather than an assertion made by the model.

## Adaptive engineering depth

Not every change needs the same evaluators.

The active agent selects useful engineering depth from scope, complexity, blast radius, risk, affected contracts, domain importance, critical paths, owner instructions, and available evidence.

A typo may need focused validation. A material feature may need tests and code review. A critical system change may justify full QA, DDD evaluation, architecture analysis, technical debt, security, integration/E2E, or performance checks where applicable.

This is guidance, not a rigid escalation table.

If the owner explicitly says, for example, "do not finish until QA, DDD, architecture, technical debt, review, and all tests are clean," those checks become part of the requested outcome.

## Governance: quality floors without platform sovereignty

ContextDevKit separates engineering observations from blocking quality floors.

Gate modes are `off`, `shadow`, `canary`, and `guarded`.

### guarded

A guarded evaluator may deny a specific transition only when its documented deterministic predicate is satisfied.

ContextDevKit ships only three guarded domains by default:

| Quality floor | Default | What it protects |
| --- | --- | --- |
| **QA sign-off** | guarded | Completion without sufficient deterministic QA evidence |
| **DDD invariants** | guarded | Proven violations of applicable declared Class A domain invariants |
| **Technical debt** | guarded | New high/critical debt deterministically introduced by the current diff |

These are quality floors, not ownership of the project. The owner can configure their modes and may provide a scoped, auditable override without pretending the evidence passed.

### canary

Canary evaluates and reports but does not deny.

Architecture Debt, graph-first guidance, routing, workflow presence, journey guidance, simulations, deliberation, economy, and context-pack observations are canary by default.

Architecture Debt is intentionally separate from Technical Debt. It can discover structural risk and produce evidence, but it cannot silently become a fourth guarded domain. Evidence from architecture analysis may later be relevant to the guarded Technical Debt predicate if it proves new high/critical debt introduced by the current diff.

### shadow

Shadow observes without changing the execution result.

Privacy/LGPD is shadow by default because repository code cannot prove the absence of contracts, legal bases, DPAs, or organizational controls that may exist outside the codebase.

## Owner sovereignty

ContextDevKit exists to govern the project, not to outrank its owner.

The stock runtime uses `humanAuthority: owner-wins` for governance decisions while preserving the real safety boundaries of the execution host or platform.

The harness can surface evidence, enforce configured quality floors, preserve decisions, recommend specialists, refuse to fabricate a pass, and record explicit overrides.

It should not infer permission from a model score, require a specific subagent before useful work can happen, turn a swarm recommendation into authorization, or make optional methodology a hidden prerequisite.

## Specialists are tools, not bureaucracy

ContextDevKit ships specialized agents for architecture, implementation, code review, domain modelling, QA, security, accessibility, DevOps, product, design, growth, and other domains.

Routing is advisory.

For example, `code-reviewer` is a strong recommendation for a material diff and is an explicit stage of the full `/ship` pipeline. If a specialist is unavailable, the active agent continues and performs the responsibility itself. Agent presence is not proof of quality.

## Project intelligence and long-term memory

ContextDevKit makes project knowledge durable across sessions, context windows, models, and hosts.

Memory can preserve Business contexts, Operations, Workflows, tasks, ADRs, specifications, decisions, reports, sessions, owner preferences, project-specific instructions, and execution evidence.

A Workflow package contains a complete engineering context:

```text
WF-####-slug/
├── workflow.json
├── workflow-state.json
├── prd.md
├── spec.md
├── decisions.md
├── context-manifest.json
├── CONTINUATION-PROMPT.md
├── pipeline/
│   ├── tasks.json
│   └── tasks.md
└── reports/
```

Canonical machine state stays in JSON. Markdown is authored engineering context or a human-facing projection. Reports preserve factual execution evidence.

## One state authority

ContextDevKit 4 has one writable authority for each kind of state.

| State | Authority |
| --- | --- |
| Workflow definition | `workflow.json` |
| Workflow lifecycle | `workflow-state.json` |
| Tasks and task status | `pipeline/tasks.json` |
| Transient execution run | `memory/runs/<run-id>/state.json` |
| Owner recommendations | `memory/preferences/owner-preferences.json` |

Task transitions use validation, revision compare-and-swap, locking, and atomic replacement. Status is not inferred from Markdown or a directory name.

## Project Map and structural graph

Project Map is the preferred fast path for structural discovery. It indexes source plus configured memory roots, including governed memory that may intentionally be ignored by Git.

If the graph is missing, stale, partial, unavailable, or unable to answer the query, the agent immediately falls back to ordinary repository search. Graph-first means **preferred optimization**, not **search prohibition**.

A provider boundary also allows integration with other graph implementations.

## Continuity across long sessions

ContextDevKit is designed for work that outlives one context window.

Capabilities include persistent tasks and Workflow state, reports and evidence, context manifests, long-term project memory, continuation prompts, `run-compact`, compact test output, task compilation, session/run state, owner preferences, and project personalization.

Changing session, context window, model, or host should not erase what the project already knows.

## Full delivery pipeline

For a full autonomous engineering pass, `/ship --auto` provides an evidence-driven delivery pipeline:

```text
scope
  ↓
design
  ↓
plan tests
  ↓
implement
  ↓
self-review
  ↓
test / QA
  ↓
quality analysis
  ↓
record decisions and evidence
  ↓
report
```

Red evidence is repaired when it belongs to the requested scope. If it cannot be resolved honestly, it is surfaced as unresolved instead of being hidden behind a fabricated pass.

## Native hosts

ContextDevKit maintains canonical sources and generates native projections for supported hosts, including Claude Code, OpenAI Codex, Google Antigravity, and Grok.

The host may change. The project memory, work model, and governance contract remain.

## Install

Requires Node.js 18 or newer. The governance hot path has zero runtime package dependencies.

```bash
npx contextdevkit --target /path/to/project
```

From a repository checkout:

```bash
node install.mjs --target /path/to/project
```

The installer supports tracked, local-only, and non-Git projects. In a non-Git directory it reports `NON-GIT` honestly and skips Git-only integration without disabling the rest of the kit.

Activation levels select available capabilities; they are not consent grades:

| Level | Capability set |
| --- | --- |
| 1 | durable project memory |
| 2 | host governance dispatchers and diagnostics |
| 3 | multi-session coordination and claims |
| 4 | specialist agents and QA roles |
| 5 | impact, architecture, and quality analysis |
| 6 | autonomous pipeline commands and learning loops |
| 7 | fleet, ecosystem, visual QA, and advanced observability |

The current owner instruction determines what the agent may do. ContextDevKit does not convert a level, model route, or preference into permission.

## Common commands

Run the host-neutral CLI through `cdx.mjs` (Codex) or `ctx.mjs` (other hosts):

```bash
node cdx.mjs state
node cdx.mjs project-map --find <symbol-or-path>
node cdx.mjs dev-start <objective>
node cdx.mjs pipeline
node cdx.mjs workflow new <slug>
node cdx.mjs qa-signoff
node cdx.mjs log-session
```

When a mutating command exposes a write switch, use its documented dry-run/apply behavior. Read the returned receipt as evidence of what the command actually did.

## Design principles

1. **Delivery over bureaucracy.** Process exists to improve delivery, not replace it.
2. **Evidence over ceremony.** A test result is stronger than a receipt saying somebody ran a test.
3. **Governance starts with mutation.** Conversation and exploration are not work items.
4. **Determinism proves facts.** Use deterministic systems for facts they can actually prove.
5. **Intelligence interprets evidence.** Agents remain responsible for engineering judgment.
6. **Owner intent outranks methodology.** ContextDevKit is a project harness, not the owner of the project.
7. **Small work stays small.** A typo should not become a workflow.
8. **Durable work deserves durable memory.** Strategic decisions, Operations, Workflows, and evidence should survive the session that created them.
9. **One state, one authority.** Derived views never become competing writers.
10. **Failure must be honest.** Unknown, skipped, stale, or unavailable evidence is never silently renamed to PASS.

## Upgrading from 3.x

ContextDevKit 4 does not run a live 3.x compatibility layer. Legacy lane directories, Workflow v1 plans, autonomy grades, rigid required-agent contracts, and old hook chains are handled only by the explicit offline migration boundary.

Normal runtime does not dual-read or dual-write legacy state.

See [MIGRATION-3.x-TO-4.0.md](MIGRATION-3.x-TO-4.0.md).

## Development and verification

```bash
npm run test:smoke
npm run test:selfcheck
npm run test:integration
npm test
npm run release:v4:gate
```

The suite runner is bounded, emits progress and heartbeats, and terminates timed-out process trees. Release packaging uses an allowlist and refuses legacy runtime reachability, host-projection drift, test fixtures in the tarball, or an unexercised migration rollback.

## Documentation

Start with:

- [Documentation index](docs/README.md)
- [Documentation languages](docs/LANGUAGES.md)
- [Português (Brasil)](docs/pt-BR/README.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Business-Driven Development](docs/explanation/business-driven-development.md)
- [Evidence-Driven Loop Engineering](docs/explanation/loop-engineering.md)
- [Governance and enforcement](docs/explanation/governance-and-enforcement.md)
- [Quality model](docs/explanation/quality-model.md)
- [Governance contract](docs/reference/governance-contract.md)
- [Memory model](docs/reference/memory-model.md)
- [Agents](docs/reference/agents.md)
- [Workflow engine](docs/workflow-engine/README.md)
- [Migration from 3.x](MIGRATION-3.x-TO-4.0.md)

## License

[MIT](LICENSE)
