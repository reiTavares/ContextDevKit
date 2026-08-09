# Architecture

ContextDevKit is a source-distributed, host-neutral **AI Software Engineering Governance Harness**. Its runtime hot path is plain ESM on Node.js 18+ with zero package dependencies.

The harness does not own the LLM execution loop. Claude Code, OpenAI Codex, Google Antigravity, Grok, or another supported host remains responsible for model execution, tool calls, shell/filesystem access, MCP transport, and its own platform safety boundary.

ContextDevKit provides the durable engineering layer around those hosts: intent classification, project intelligence, long-term memory, Business/Operation ownership, governed work state, engineering evidence, proportional policy evaluation, and continuity across sessions.

This boundary is intentional: execution hosts are replaceable while the project's governed intelligence remains portable.

## Architectural layers

```text
host / model / tools
        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│ Host adapters                                                │
│ Claude · Codex · Antigravity · Grok                         │
├──────────────────────────────────────────────────────────────┤
│ Interaction & Intake                                         │
│ conversation · exploration · mutation · unclassified         │
│ existing-work resolution · Intake Envelope                  │
├──────────────────────────────────────────────────────────────┤
│ Business-Driven Development                                  │
│ Business · Operation · none                                  │
│ direct · batch · workflow                                    │
├──────────────────────────────────────────────────────────────┤
│ Project intelligence & long-term memory                      │
│ graph · Project Map · ADRs · specs · reports · preferences   │
├──────────────────────────────────────────────────────────────┤
│ Work lifecycle                                               │
│ tasks · workflows · CAS · reports · continuation             │
├──────────────────────────────────────────────────────────────┤
│ Evidence-driven engineering loops                            │
│ implement · evaluate · correct · fresh evidence · done       │
├──────────────────────────────────────────────────────────────┤
│ Governance                                                   │
│ guarded quality floors · canary guidance · shadow analysis   │
└──────────────────────────────────────────────────────────────┘
```

## Source and projection boundaries

The repository ships canonical sources under `templates/` and installer logic under `tools/install/` plus `install.mjs`.

```text
templates/claude/commands/       canonical command sources
templates/claude/agents/         canonical agent sources
templates/contextkit/runtime/    shared runtime
templates/contextkit/tools/      installed CLI and offline migration tools
templates/contextkit/memory/     neutral initial memory assets
templates/antigravity/           generated host projections
templates/codex/                 generated host projections
tools/                           repository-only tests and release tooling
```

Host projections are declared in `host-projections.json`. Regeneration creates only declared files, removes managed orphans, and fails when a source is missing. An installed dogfood copy is never an additional source authority.

## Mutation-only interaction flow

The first architectural boundary is interaction intent.

`runtime/execution/interaction-classify.mjs` performs a cheap, side-effect-free classification before durable methodology work begins.

```text
host event
  -> classify interaction
     -> conversation: no governed work
     -> exploration: read-only
     -> unclassified: one short clarification
     -> mutation
          -> resolve existing work
          -> build intake signals
          -> choose work nature + execution shape
          -> governed execution
```

A real write attempt is authoritative and monotonically promotes the interaction to mutation. Conversation and exploration do not load work rubrics, allocate ids, resolve governed work, or create durable state.

This prevents the governance system itself from becoming the hot path for ordinary discussion.

## Intake Envelope

The **Intake Envelope** is the transient normalized view of signals produced after mutation is confirmed. It is a documentation concept, not another persisted state authority.

It can contain:

- interaction intent and reason codes;
- existing-work resolution (`explicit | inferred | ambiguous | new | none`);
- complexity/tier and domain context;
- work nature (`business | operation | none | unclassified`);
- execution shape (`direct | batch | workflow`);
- value intent and work kind;
- decision need / decision match;
- suggested Business relationship for an Operation;
- explainable reasons and evidence.

Different hosts can therefore reason from the same project facts without requiring a new receipt or mandatory artifact.

## Business-Driven Development

Work nature and execution shape are independent axes.

### Work nature

- `business` means a durable strategic capability, product, initiative, or decision is justified by evidence;
- `operation` means durable maintenance, incident, recovery, or improvement context is justified;
- `none` is the normal neutral result for ordinary engineering work;
- `unclassified` means competing evidence requires a short clarification.

The classifier never invents an Operation merely to hold a technical change.

For Operations, `business-matcher.mjs` can suggest a Business relationship through deterministic scoring. Weak matches remain unlinked, and `confirmed` is never set by the matcher itself.

### Execution shape

Execution topology is classified separately:

- `direct`: small cohesive work;
- `batch`: several related independent tasks;
- `workflow`: real waves, dependent groups, required ordering, multiple sessions, coordinated integration, cutover/rollback, or explicit workflow intent.

Business vocabulary, architecture terminology, ADR references, and compliance words do not force a Workflow by themselves.

## Governance event runtime

For governed host events, each host runs at most one ContextDevKit process for each lifecycle moment:

1. `prompt-preflight`
2. `write-preflight`
3. `postflight`
4. `completion`

The event runtime owns re-entry protection, cross-event deduplication, bounded timeouts, a total event budget, and circuit breaking. Internal failure follows `failurePolicy: continue`: failure is reported, never converted into a fabricated PASS, and never creates a second legacy resolver.

## Governance policy

`runtime/governance/gate-registry.mjs` is the immutable gate registry. `runtime/governance/gate-mode.mjs` is the sole mode resolver and verdict adapter.

Modes are `off`, `shadow`, `canary`, and `guarded`. Missing or invalid configuration degrades to `canary/continue`.

Only three domains are guarded by default:

1. QA sign-off for completion;
2. applicable deterministic Class A DDD invariants;
3. new high/critical technical debt introduced by the current diff.

Architecture Debt remains canary. It may produce structural evidence and findings, but it does not silently become a fourth guarded domain. Privacy/LGPD is shadow by default.

The governance runtime uses `humanAuthority: owner-wins`. Scoped owner overrides are revision-bound, expiring audit metadata; they do not rewrite failed evidence into passed evidence or bypass host/platform safety boundaries.

## Evidence-driven engineering loop

ContextDevKit separates the host's agent loop from the project's engineering loop.

The host owns:

```text
reason -> tool call -> observation -> reason
```

ContextDevKit preserves the project-level cycle:

```text
objective
  -> context
  -> implementation
  -> evaluation
  -> findings
  -> correction
  -> fresh evaluation
  -> evidence-backed completion
```

The task store supports a fresh QA cycle. `qa-reject` can move `testing` or `done` back to `backlog`; stale current-cycle evidence is cleared while historical events remain. When the task belongs to a completed Workflow, the aggregate can reopen before the fresh task cycle begins.

This lets an engineering loop survive context loss, compaction, session changes, or a different execution host.

## State authorities

State is separated by aggregate:

| Aggregate | Writable authority | Derived output |
| --- | --- | --- |
| Workflow definition/topology | `workflow.json` | `index.md` |
| Workflow lifecycle | `workflow-state.json` | `index.md` |
| Tasks/status/events | `pipeline/tasks.json` | `pipeline/tasks.md` |
| Pipeline execution run | `memory/runs/<id>/state.json` | status/dashboard views |
| Owner recommendations | `memory/preferences/owner-preferences.json` | routing/display hints |

Task updates validate the complete document, acquire a sibling lock, compare the expected revision, pair status and audit event, write a temporary file, and rename atomically. Projection repair happens after the authority commit and is reported separately if it fails.

The runtime never derives status from Markdown lanes, frontmatter, event folding, or a v1 plan. Completed Workflow placement under `done/` is human navigation; JSON remains lifecycle authority.

## Workflow packages

A Workflow is a complete version-2 aggregate:

```text
WF-####-slug/
├── workflow.json
├── workflow-state.json
├── context-manifest.json
├── prd.md
├── spec.md
├── decisions.md
├── index.md                    generated
├── CONTINUATION-PROMPT.md      optional generated guidance
├── pipeline/
│   ├── tasks.json
│   └── tasks.md                generated
└── reports/
```

Creation occurs in a sibling staging directory. The creator writes every required artifact, renders projections, validates the complete pack, and renames it into place atomically.

The Workflow loader reads required authored and canonical content plus reports before mutation. Agents executing governed work therefore have one reusable context-loading boundary rather than relying on memory of prior prompts.

## Specialists and adaptive depth

Model routing, agent selection, swarms, economy hints, and owner preferences are recommendations.

A material diff can justify `code-reviewer`; domain-heavy work can justify `domain-modeler`; security-sensitive work can justify security specialists; full QA can fan out to unit, integration, fuzz, E2E, or performance roles.

The invariant is the engineering responsibility, not the presence of a named subagent. If a specialist cannot be spawned, the active agent continues with the responsibility itself.

## Project Map

Project Map indexes source plus configured memory roots. A provider interface allows the native graph or another graph implementation.

Graph lookup is a preferred optimization. Missing, stale, partial, or unanswered graph data falls back immediately to ordinary repository search. Refresh never blocks the first useful action.

## Project personalization

Explicit project-specific guidance lives in `memory/preferences/personalization.md`. Structured recommendation-only preferences live in `memory/preferences/owner-preferences.json`.

Native host roots contain managed pointers to those sources. Updates preserve owner-authored project guidance instead of copying it into regenerated base instructions.

## Installation and portability

The installer supports tracked, local-only, and non-Git targets. Git enriches metadata and hooks only when present; it never determines base artifact content.

Paths use `node:path`, JSON readers strip a BOM, and generators do not depend on Bash or invisible Git ignore state.

## Upgrade boundary

The v3-to-v4 importer lives only in `contextkit/tools/migrations/v3-to-v4/`. Boot, normal CLI, hooks, MCP, dashboard, statusline, and host adapters never import it.

Cutover requires a validated stage, status parity, exercised rollback, frozen v3 writers, and an authority marker CAS. Legacy source data is retired outside the active runtime afterward.

## Release boundary

Repository tests are not installed in user projects. The package is built from an allowlist and refuses selftests, fixtures, golden data, dogfood memory, orphaned projections, and reachable legacy modules.

A release version is stamped only after the complete release gate passes.
