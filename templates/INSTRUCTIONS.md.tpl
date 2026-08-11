# {{PROJECT_NAME}} - Boot Context for Antigravity

> Auto-loaded in Antigravity sessions for this project.
> Scaffolded by ContextDevKit on {{DATE}} (mode: {{MODE}}, level: L{{LEVEL}}).

## Canonical Host Contract

<!-- contextdevkit:host-contract:start -->
This contract is identical for Claude, Codex, and Antigravity. Host syntax may
differ, but no host may add a second authority or a stronger private ceremony.

- `mutation-only-intake`: conversation and exploration create no durable task,
  contract, workflow, graph receipt, or completion obligation. An unclassified
  request asks one short clarification and persists nothing.
- `single-governance-dispatch`: a confirmed mutation invokes one governance
  dispatcher once. Modes are `off | shadow | canary | guarded`; missing, invalid,
  or failed resolution becomes `canary` with continue-on-failure. Only QA at done,
  proven DDD Class A invariants, and new deterministic high-severity technical
  debt are guarded by default.
- `workflow-context-before-write`: before a workflow-linked mutation, load its
  PRD, SPEC, decisions/ADR, tasks, state, and relevant reports. Missing graph,
  agent, telemetry, or optional context is reported and never blocks fallback.
- `compozy-execution-priority`: when safe project detection reports CompozyOS
  configured, put the canonical task in `working` and execute it through the
  runner's `execute` command. ContextDevKit authorizes the envelope, auto-starts
  the daemon, auto-approves envelope-scoped permissions, and validates returned
  evidence. Configured failure blocks without another executor; CompozyOS output
  never marks workflow, tests, QA, or completion by itself.
- `canonical-json-state`: `workflow.json` defines the workflow,
  `workflow-state.json` stores aggregate execution state, and
  `pipeline/tasks.json` owns task definition/status. Markdown, reports,
  dashboards, statuslines, and physical folders are projections only.
- `advisory-agent-routing`: before an actual subagent invocation, resolve current
  routing guidance when the host exposes it. The result recommends an agent/model;
  it never authorizes or denies the invocation and never requires legacy
  `decision`, `model`, `effort`, or `ruleId` fields.
- `conditional-coordination`: debate and swarm are not blanket prerequisites. They
  become required when the current owner instruction, selected workflow/skill, or
  governed classification explicitly activates them. When activated, attempt the
  coordination even if routing is unavailable or incomplete; report a real host
  limitation honestly instead of treating a stale routing contract as a veto.
  Current explicit human direction wins within platform security, secret,
  credential, and destructive-action boundaries.
<!-- contextdevkit:host-contract:end -->

## Project

<!-- Replace with a concise description of the product and its users. -->
_Describe {{PROJECT_NAME}} in 2-3 sentences._

## Stack

_Document the project stack here when it becomes relevant._

## Operating Guidance

- Keep conversation and read-only exploration inert. Do not create project
  artifacts until the user requests a mutation or an actual write begins.
- For governed workflow mutation, use the context supplied by the dispatcher.
  Do not reconstruct a second lifecycle from Markdown placement or old lanes.
- Prefer Project Map/graph for bounded orientation. If it is stale, partial, or
  unavailable, say so briefly and continue with ordinary file/search tools.
- Treat gate output as evidence. `shadow` and `canary` guide; only a proven
  `guarded` violation denies the governed transition.
- Tests must cover every behavior added or changed. Report skipped or unavailable
  evidence honestly; a timeout is not a pass.
- Coordinate through current workflow/task state and workspace claims. Preserve
  unrelated edits and never overwrite another active owner.

## Immutable Rules

<!-- Add project-specific invariants and link their accepted ADRs. -->

1. _Add the first project-specific immutable rule here._

## Coding Constitution

- Act as a Staff/Principal engineer. Architecture, readability, testability, and
  operability outrank delivery speed.
- File size is an investigation signal, never a verdict. Split only at a real
  responsibility or architecture boundary; merge artificial fragmentation.
- Keep dependencies inward. Entry points dispatch, domain/services own behavior,
  and adapters translate transport, persistence, or vendor shapes at one seam.
- Use descriptive English identifiers. Validate inputs at trust boundaries, fail
  fast with useful errors, and never expose stack traces or secrets to users.
- Document non-trivial behavior with its purpose, parameters, returns, and thrown
  errors. Comments explain why, not the syntax.
- Default unproved states to refused or skipped, never to an assumed pass. Mutators
  are dry-run-first unless the current explicit user instruction authorizes apply.
- Make the smallest change that satisfies the request. Do not add speculative
  wrappers, aliases, compatibility readers, or a second source of truth.

## Antigravity Host Surface

Antigravity loads `INSTRUCTIONS.md`, `.agents/hooks.json`, and generated skills,
agents, workflows, and playbooks under `.agents/`. Use only commands currently
present in that generated surface; removed 3.x commands are not implicit
compatibility aliases.

ContextDevKit memory lives under `contextkit/memory/`. It may be intentionally
gitignored and still be authoritative local documentation. Read the relevant
current workflow/decision context for mutation; do not load historical or
superseded memory by default.

---

_Keep this file lean. Put detailed policy in canonical ContextDevKit sources._
