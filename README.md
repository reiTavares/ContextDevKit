# ContextDevKit

ContextDevKit is a portable governance and project-memory layer for AI-assisted
development. It supports Claude Code, OpenAI Codex, Google Antigravity, and Grok
without putting an application framework or package dependency on the runtime
hook path.

The 4.0 model is deliberately quiet: governance starts when an interaction will
mutate files or governed state. Conversation and read-only exploration create
no task, workflow, ledger, receipt, or durable context.

Portuguese documentation: [instrucoes.md](instrucoes.md).

## The operating contract

An interaction is classified before governance work begins:

| Interaction | Durable effect |
| --- | --- |
| Conversation | None |
| Read-only exploration | None |
| Unclassified intent | One short clarification in the user's language; no persistence |
| Mutation | Resolve existing work, classify its nature, select an execution shape, then run the applicable governance |

A real write attempt promotes the interaction to mutation exactly once. This
applies to source, documentation, configuration, and memory files alike.

Mutation work uses the smallest fitting shape:

- **direct** — one to three cohesive tasks;
- **batch** — four to twelve related tasks without strong ordering;
- **workflow** — required ordering, dependencies, waves, multi-session work,
  cutover, or rollback.

`Business`, `Operation`, and `none` describe the nature of the work. `none` is
normal for a focused feature, bug fix, documentation edit, or technical change.
Business work needs a durable strategic outcome; Operation work needs a durable
maintenance or operational capability. Neither label is inferred merely from a
keyword.

## One dispatcher, bounded governance

Each host runs at most one ContextDevKit process for each governance event:

1. `prompt-preflight`
2. `write-preflight`
3. `postflight`
4. `completion`

The dispatcher owns deduplication, a time budget, re-entry protection, and a
circuit breaker. Internal failure follows `continue`: it is diagnostic, never a
fabricated pass and never a reason to break the user's real work.

Gate modes have precise meanings:

- **canary** evaluates and reports without denying;
- **shadow** observes without changing the outcome;
- **guarded** may deny only an applicable, deterministic, evidenced violation
  at its documented moment.

Only three domains are guarded by default:

| Gate | Blocking moment | Exact blocking condition |
| --- | --- | --- |
| `qa-signoff` | completion | a transition to `done` lacks deterministic QA evidence |
| `ddd-invariants` | write-preflight, completion | an applicable Class A domain invariant is deterministically violated |
| `technical-debt` | completion | the current diff introduces new high or critical debt |

All other gates, including graph, intake, journey, workflow presence,
simulation, deliberation, routing, subagent scope, economy, and context loading,
default to canary. `privacy-lgpd` is shadow.

The owner may provide a scoped human override for a guarded verdict. An override
records actor, reason, scope, policy version/hash, base revision, timestamp,
expiry, and outcome. It does not rewrite evidence or disable host/platform
safety controls.

## State authority

There is one writable authority for each kind of state:

| State | Authority |
| --- | --- |
| Workflow definition | `workflow.json` |
| Workflow lifecycle | `workflow-state.json` |
| Tasks and task status | `pipeline/tasks.json` |
| Transient pipeline execution | `memory/runs/<run-id>/state.json` |
| Owner preferences | `contextkit/memory/preferences/owner-preferences.json` |

Task statuses are `backlog`, `working`, `blocked`, `testing`, `done`, and
`cancelled`. Writes use validation, compare-and-swap revisions, a lock, and
atomic replacement. A status transition and its audit event are committed in
the same document.

Markdown files such as `tasks.md` and `index.md` are derived projections. They
are never parsed as runtime authority and may be repaired from JSON.

A workflow package contains:

```text
WF-####-slug/
├── workflow.json
├── workflow-state.json
├── prd.md
├── spec.md
├── decisions.md
├── CONTINUATION-PROMPT.md
├── context-manifest.json
├── pipeline/
│   ├── tasks.json
│   └── tasks.md              # generated projection
└── reports/
```

Direct and batch work use the same task document contract under their owning
context. A workflow is created as a complete sibling staging directory,
validated, and renamed into place atomically.

## Project personalization

ContextDevKit keeps durable project-specific guidance outside regenerated host
instructions:

- `contextkit/memory/preferences/personalization.md` contains explicit,
  user-owned project instructions;
- `contextkit/memory/preferences/owner-preferences.json` is the existing
  structured, recommendation-only preference store.

The installer creates both files only when absent and never overwrites them,
including under `--force`. `CLAUDE.md`, `AGENTS.md`, and `INSTRUCTIONS.md` each
receive one marker-bounded reference to both files. Updates replace only that
reference block atomically and preserve every byte of owner prose outside it.
The Markdown guidance is explicit project context, while the JSON can only
guide recommendations; neither outranks current system, developer, user, or
platform-safety instructions.

## Graph, routing, and agents

Project Map is the preferred first lookup because it can locate code and memory
with less context. If the graph is missing, stale, partial, or cannot answer the
query, broad search remains immediately available. Graph-first never blocks
`Grep`, `Glob`, `rg`, or equivalent fallback.

Model selection, specialist routing, swarm shape, economy hints, and owner
preferences are recommendations. They never grant authority and their absence
does not deny a write. A swarm is optional and is limited only by a real host
technical limit when the host exposes one.

LGPD routing is shadow-only. It may surface privacy observations but does not
become a mandatory-agent gate.

For destructive production work, force-push, or secret rotation, ContextDevKit
emits a non-blocking `riskAcknowledgement`. Confirmation still belongs to the
real host or platform boundary.

## Install

Requirements: Node.js 18 or newer. The hook hot path has zero runtime package
dependencies.

```bash
npx contextdevkit --target /path/to/project
```

For this repository checkout:

```bash
node install.mjs --target /path/to/project
```

The installer supports tracked, local-only, and non-Git projects. In a non-Git
directory it reports `NON-GIT` honestly and skips Git-only integration without
disabling the rest of the kit.

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

The current owner instruction determines what the agent may do. ContextDevKit
does not convert a level, model route, or preference into permission.

## Daily commands

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

Mutating commands are dry-run by default when the command exposes a write
switch. Read the printed receipt before applying a mutation.

## Upgrading from 3.x

There is no live compatibility fallback. Markdown lanes, v1 workflow plans,
autonomy grades, legacy hook chains, and old writers are accepted only by the
explicit offline migrator.

The safe sequence is inventory and dry-run, stage, freeze old writers, verify
parity and rollback readiness, cut over atomically, then retire v3 sources.
Rollback switches to an independently copied, byte-verified v4 generation; the
external workspace retains the inventoried v3 source bundle and manifest.

See [MIGRATION-3.x-TO-4.0.md](MIGRATION-3.x-TO-4.0.md) for commands, config-key
conversion, refusal conditions, parity checks, and rollback.

## Development and verification

```bash
npm run test:smoke
npm run test:selfcheck
npm run test:integration
npm test
npm run release:v4:gate
```

The suite runner is bounded, emits progress and heartbeats, and terminates a
timed-out process tree. Release packaging uses an allowlist and refuses legacy
runtime reachability, host-projection drift, test fixtures in the tarball, or an
unexercised migration rollback.

A release version is stamped only after all release gates are green.

## Documentation

- [Documentation index](docs/README.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Governance contract](docs/reference/governance-contract.md)
- [Configuration](docs/reference/config.md)
- [Workflow engine](docs/workflow-engine/README.md)
- [Security and privacy](docs/PRIVACY.md)
- [Migration from 3.x](MIGRATION-3.x-TO-4.0.md)

## License

[MIT](LICENSE)
