# Architecture

ContextDevKit is a source-distributed, host-neutral **AI Software Engineering
Governance Harness**. Its runtime hot path is plain ESM on Node.js 18+ with zero
package dependencies.

The harness does not own the LLM execution loop. Claude Code, OpenAI Codex,
Google Antigravity, Grok, or another supported host remains responsible for
model execution, tool calls, shell/filesystem access, MCP transport, and its own
platform safety boundary. ContextDevKit provides the durable layer around those
hosts: project intelligence, long-term memory, context orchestration, governed
work lifecycle, policy evaluation, evidence, and execution continuity.

This boundary is intentional: execution hosts are replaceable, while the
project's governed intelligence and operational memory remain portable.

## Source and projection boundaries

The repository ships canonical sources under `templates/` and installer logic
under `tools/install/` plus `install.mjs`.

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

Host projections are declared in `host-projections.json`. Regeneration creates
only declared files, removes orphans, and fails when a source is missing. An
installed dogfood copy is never an additional source authority.

## Mutation-only interaction flow

```text
host event
  -> one governance entrypoint
  -> event runtime
     -> classify interaction
     -> no-op for conversation/exploration
     -> resolve gate plan once for mutation
     -> run bounded evaluators
     -> host adapter emits one result
```

There are four entrypoints: prompt preflight, write preflight, postflight, and
completion. Each host registers one ContextDevKit process for each event. The
entrypoints normalize the host payload and delegate; they do not contain domain
logic or persist an alternate ledger.

The event runtime owns re-entry protection, deduplication, timeouts, total
budget, and circuit breaking. It returns structured diagnostics and follows
`failurePolicy: continue` on internal failure.

## Governance policy

`runtime/governance/gate-registry.mjs` is the immutable gate registry.
`runtime/governance/gate-mode.mjs` is the only policy resolver and verdict
adapter. Missing or invalid configuration resolves to canary.

Only QA sign-off at `done`, applicable deterministic Class A DDD invariants,
and new high/critical technical debt introduced by the current diff can deny.
All other policy surfaces are canary or shadow. Owner overrides are scoped,
revision-bound, expiring audit metadata.

## State authorities

State is separated by aggregate:

| Aggregate | Writable authority | Derived output |
| --- | --- | --- |
| Workflow definition/topology | `workflow.json` | `index.md` |
| Workflow lifecycle | `workflow-state.json` | `index.md` |
| Tasks/status/events | `pipeline/tasks.json` | `pipeline/tasks.md` |
| Pipeline execution run | `memory/runs/<id>/state.json` | status/dashboard views |
| Owner recommendations | `memory/preferences/owner-preferences.json` | routing/display hints |

Task updates validate the complete document, acquire a sibling lock, compare
the expected revision, pair status and audit event, write a temporary file, and
rename atomically. Projection repair happens after the authority commit and is
reported separately if it fails.

The runtime never derives status from a Markdown lane, frontmatter, event fold,
workflow directory placement, `done/`, or a v1 plan. Those inputs exist only in
the explicit offline 3.x migrator.

## Workflow packages

A workflow is a complete version-2 aggregate:

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

Creation occurs in a sibling staging directory. The creator writes every
required artifact, renders projections, validates the whole pack, and renames
it to the target atomically. Failure removes staging. Explicit repair is dry-run
by default and refuses any directory without `workflow.json`.

The workflow loader reads required authored and canonical content plus referenced
reports before mutation. It is shared by hosts and consumers and performs no
write.

## Consumers

CLI, MCP read resources, dashboard, statusline, boot context, and workflow
context use one v4 authority reader. MCP exposes read resources for governed
state; mutation stays in canonical writers reached by the normal host/CLI
boundary.

## Project Map

Project Map indexes source plus configured memory roots. A provider interface
allows the native graph or another graph implementation. Graph lookup is a
preferred optimization: unavailable, stale, partial, or unanswered data falls
back immediately to ordinary search. Refresh does not block the first action.

## Routing and risk

Model routing, agent selection, swarms, economy hints, and owner preferences are
recommendations. They have no write authority. LGPD is shadow. High-risk real
actions emit acknowledgement metadata and remain subject to the host/platform
confirmation boundary.

Explicit project-specific guidance lives separately in the user-owned
`memory/preferences/personalization.md`. Native host roots contain only one
atomic managed pointer to that Markdown and the recommendation-only JSON; the
installer never copies personalized prose into regenerated base instructions.

## Installation and portability

The installer supports tracked, local-only, and non-Git targets. Git enriches
metadata and hooks only when present; it never determines base artifact content.
Paths are resolved with `node:path`, JSON readers strip a BOM, and generators do
not depend on Bash or invisible Git ignore state.

## Upgrade boundary

The v3-to-v4 importer lives only in
`contextkit/tools/migrations/v3-to-v4/`. Boot, normal CLI, hooks, MCP,
dashboard, statusline, and host adapters never import it. Cutover requires a
validated stage, status parity, exercised rollback, frozen v3 writers, and a
marker CAS. Legacy sources are retired to an external audit bundle afterward.

## Release boundary

Repository tests are not installed in user projects. The package is built from
an allowlist and refuses selftests, fixtures, golden data, dogfood memory,
orphaned projections, and reachable legacy modules. A release version is
stamped only after the complete release gate passes.
