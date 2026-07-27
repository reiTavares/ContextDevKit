# Reference: Glossary

The normative vocabulary of the platform. Every domain term used in the public
documentation appears here, mapped to the identifier that carries it in the code.
If a term is not in this table, it is not part of the vocabulary — and a concept is
never renamed to read better.

## How to read this glossary

Each row has four columns.

| Column | Meaning |
| --- | --- |
| Term | The public name. This exact spelling is what the docs use. |
| Definition | What the thing is, in one or two sentences. |
| Code identifier | Where the term lives in the code: a file, a field, a function, or an enum value. |
| Identity | `ENTITY` or `VALUE` — see below. |

`ENTITY` means the thing has an allocated identifier and is listed in a registry or
index. It exists on disk, it can be referenced from elsewhere, and something owns it.

`VALUE` means the thing carries no allocated identifier: it is a resolved fact (the
outcome of a classification), a derived projection, or a mechanism. A value is
recomputed rather than looked up. Two runs of a classifier can produce the same
value; two entities are never the same entity.

A synonym is only valid vocabulary when it is declared as an alias in
[Aliases and rejected names](#aliases-and-rejected-names). Any other second name
for a concept is drift, not a synonym.

## Work entities

The four kinds of work context, plus the unit of execution inside them.

| Term | Definition | Code identifier | Identity |
| --- | --- | --- | --- |
| Business | A durable strategic capability: a new product, market, segment, or platform capability with its own outcome review. Owns Operations and Workflows. | `business.json`; id `BIZ-####`; directory `contextkit/memory/business/BIZ-####-<slug>/`; allocator `nextBusinessId()` | ENTITY |
| Root Business | The Business that governs intake for the whole project — the parent every other work context ultimately answers to. | field `intake.rootBusiness` in `business.json` | ENTITY |
| Operation | Bounded work inside something that already exists: a fix, an incident, maintenance, a localized refactor. May be linked to a Business, or stand alone. | `operation.json`; id `OP-####`; directory `contextkit/memory/operations/OP-####-<slug>/`; allocator `nextOperationId()` | ENTITY |
| Workflow | A multi-phase delivery unit with its own specification, plan, and state. Runs under an owning Business or Operation. | ids `WF-####`; `workflow-state.json` (state authority) and `workflow-plan.json` (waves, tasks, gates); allocators `nextWorkflowNumber()` / `allocateWorkflowId()` | ENTITY |
| Decision record | The written record of one material decision: context, decision, consequences, and who accepted it. Immutable once accepted; a later record supersedes it. | files matching `ADR-NNNN-<slug>.md` under `contextkit/memory/decisions/`; fields `status`, `supersedes`, `supersededBy`, `approvalSource`; allocator `nextAdrNumber()` | ENTITY |
| Task | The unit of execution inside exactly one owner. Its status is folded from an append-only event journal, not written freehand. | `tasks.json`; `TASK_STATES` = `not_started` `working` `blocked` `testing` `done`; `OWNER_KINDS` = `WF` `OP` `BIZ` | ENTITY |
| Deliberation | A recorded multi-voice debate over a hard question: independent positions, then a converged synthesis that can feed a decision record. | files under `contextkit/memory/deliberations/` named `<YYYY-MM-DD>-<NN>-<slug>.md`; planner `deliberation-council.mjs`; config section `deliberations` | ENTITY |
| Spec pack | The file form of a Workflow: the specification documents that sit beside its state and plan. Carries no id of its own — the id belongs to the Workflow. | `index.md`, `prd.md`, `spec.md`, `decisions.md`, `tasks.md`, `memory.md`, `reports/` inside the workflow directory | VALUE |
| Wave | A delivery stage inside a Workflow's plan, with the waves it waits on and the gates that must pass before it closes. | `waves[]` in `workflow-plan.json` (`id`, `dependsOn`, `tasks`); verb `workflow.mjs close-wave` | ENTITY |

A wave's `id` is unique inside its own plan. It is not allocated from a global
sequence and appears in no cross-project registry, which is why a wave is only ever
referenced together with its Workflow.

## Classification values

What intake resolves before substantive work starts, plus the two dials a project
sets deliberately. All of these are values: they are computed or configured, never
allocated.

| Term | Definition | Code identifier | Identity |
| --- | --- | --- | --- |
| Intake | The classification step that turns a request into signals — nature, tier, ceremony, business match, decision need — before any code is written. | `work.mjs intake`; handler `work-intake.mjs`; classifier `runtime/execution/task-intake.mjs` | VALUE |
| Work nature | Whether the request creates or changes a durable strategic capability (Business) or executes inside something that exists (Operation). | `nature`, values `business` / `operation`; persisted as `intake.workNature`; classifier `classifyNature()` | VALUE |
| Ceremony | How much process the work carries. Resolved from ceremony points and hard triggers. | `executionMode`, values `direct` / `batch` / `workflow`; classifier `classifyExecutionMode()`; `EXECUTION_MODES` in `tasks-schema.mjs` | VALUE |
| Journey branch | The nature-and-ceremony pair, naming the exact ordered stage list the work must walk. | `branches` in `contextkit/policy/journey.json`: `operation-direct`, `operation-batch`, `operation-workflow`, `business-decision`, `business-workflow` | VALUE |
| Tier | How complex the request is, which decides whether the ceremony applies at all. | `tier`, values `trivial` / `feature` / `architectural`; table `contextkit/policy/complexity-rubric.json` | VALUE |
| Level | The activation tier of the platform in a project: how many layers of memory, gating, and tooling are switched on. | `level` in `contextkit/config.json`, `1`–`7`; bounds `MIN_LEVEL` / `MAX_LEVEL` and labels in `runtime/config/levels.mjs` | VALUE |
| Autonomy grade | How much the agent may do without asking. Orthogonal to level: level is capability, grade is consent. | `autonomy.grade` in `contextkit/config.json`, `1`–`4`; writer `autonomy.mjs` | VALUE |
| Enforcement mode | How a gate behaves when a required capability is missing: warn only, block at write and completion, or block at every moment. | `advisory` / `guarded` / `strict`; resolver `resolveEnforcementMode()` in `runtime/execution/enforcement-modes.mjs`; `enforcement.mode` in `journey.json` | VALUE |

The ceremony vocabulary differs by nature, and the difference is enforced rather
than stylistic. An Operation resolves to `direct`, `batch`, or `workflow`. A Business
accepts only `decision` or `workflow` — see the rejected token in
[Aliases and rejected names](#aliases-and-rejected-names).

## Governance mechanics

How the platform decides whether work may proceed.

| Term | Definition | Code identifier | Identity |
| --- | --- | --- | --- |
| Journey | The canonical ordered map of stages the work must walk, with machine-checkable preconditions per stage. One journey, branching by nature and ceremony. | `contextkit/policy/journey.json`; stage order for code work in `canonicalWorkJourney.order`: `graph`, `economy`, `ddd-governance`, `implementation`, `qa` | VALUE |
| Gate | A checkpoint that inspects evidence and either permits, warns, or refuses. Session gates are hook scripts; workflow gates are declared items in a plan. | hooks `journey-gate.mjs`, `execution-gate.mjs`, `completion-gate.mjs` under `runtime/hooks/`; workflow gates are `machine` or `human`, verbs `workflow.mjs check-gate` / `approve-gate` | VALUE |
| Receipt | The structured output a script emits to record what it did: which command, dry run or applied, which files, which detail. The only evidence a gate accepts. | `makeReceipt()` in `work-io.mjs`, shape `{ command, applied, mode, writes, detail }`, `mode` = `dry-run` / `apply` | VALUE |
| Drift | The condition where important files changed but no session was registered. Surfaces as a nudge, never a block. | Stop hook `runtime/hooks/check-registration.mjs`; the watched path list is `ledger.important` in `contextkit/config.json` | VALUE |

Prose does not satisfy a gate. A sentence claiming the suite passed is not a receipt;
the receipt is what the test command emitted. Where evidence cannot be read at all,
the outcome is `skipped` — never a pass.

## Memory and platform artifacts

Derived knowledge the agent reads instead of re-exploring, and the shared state
parallel sessions coordinate through.

| Term | Definition | Code identifier | Identity |
| --- | --- | --- | --- |
| Project map | A deterministic structural map of the repository — modules, roles, file and symbol inventory — regenerated from disk. | generator `project-map.mjs`; output directory `contextkit/memory/project-map/` including `manifest.json`; config section `projectMap` | VALUE |
| Graph | A symbol-level knowledge graph over the code, with reverse-consumer queries. Extraction is regex-tier and the capability ships marked experimental. | config `projectMap.graph.enabled`; projection `contextkit/memory/project-map/graph/graph.json`; CLI `graph.mjs` | VALUE |
| Economy | The three tracked resource dimensions of AI-assisted work: tokens consumed, money spent, and autonomy exercised. Reported per session, advisory by default. | config sections `economy` and `tokens`; script directories `contextkit/tools/scripts/economy/` and `contextkit/tools/scripts/economics/`; report `token-report.mjs` | VALUE |
| Domain map | The declared bounded contexts of a project and what each one owns. Generated only for profiles that warrant it, never for simple work. | artifact `domain-map.json`; contract in `contextkit/policy/domain-artifacts/artifact-schemas.json` | VALUE |
| Bounded context | One region of the domain map with its own responsibilities and the state it alone owns. Cross-context access is what conformance checks look at. | `contexts[]` entries in `domain-map.json` (`name`, `responsibilities`, `ownedStates`) | VALUE |
| Ledger | The per-session record of what was edited, in order. Local state, one file per host session. | `.claude/.sessions/<sessionId>.json`; reader `runtime/hooks/ledger.mjs` | VALUE |
| Claim | A path reservation held by one session so a parallel session gets a cross-claim warning instead of a silent collision. | `claims[]` in `.claude/.workspace/<sessionId>.json`; commands `claim.mjs` and `release.mjs` | VALUE |
| Worktree | A separate checkout of the same repository on its own branch, so a parallel session gets its own working tree and its own session state. | `worktree-new.mjs` | VALUE |

## Agents and extensions

The units of specialization, and the surfaces the platform runs on.

| Term | Definition | Code identifier | Identity |
| --- | --- | --- | --- |
| Squad | A named group of specialist agents with the paths and keywords that route work to them. | `contextkit/policy/squads-registry.json` (fields `squad`, `agent`, `playbook`, `paths`, `keywords`); agent briefings in `.claude/agents/*.md` | ENTITY |
| Playbook | A reusable procedure bound to phases, squads, and intents — the repeatable how, separate from the agent who runs it. | files in `contextkit/workflows/playbooks/`; index `contextkit/policy/playbook-registry.json` (`id`, `owningSquad`, `intents`, `workflowPhases`); runner `playbook.mjs` | ENTITY |
| Skill | A focused discipline an agent loads for one kind of work, declaring which artifacts it produces. | `contextkit/skills/<id>/SKILL.md`; index `contextkit/policy/devteam/skills-registry.json` | ENTITY |
| Host | An editor or agent runtime the platform runs on natively, with full governance: hooks, gates, and ledger. | native hosts `claude`, `codex`, `antigravity`; resolver `hookHost()` in `runtime/hooks/host-adapter.mjs`; per-host directories `.claude/`, `.codex/`, `.antigravity/` | ENTITY |
| Bridge | A third-party tool that receives the generated context layer only, with no enforcement. A bridge is not a governed host. | `BRIDGE_HOSTS` in `runtime/hooks/host-adapter.mjs`, each entry carrying `enforced: false`; opt in per tool via `bridges.enabled` | ENTITY |

There are three native hosts. Everything else that reads project context is a bridge,
and the distinction is recorded in the data (`enforced: false`) precisely so a bridge
is never mistaken for a governed host.

## Aliases and rejected names

Declared aliases. Each is an accepted second name for the term it points at.

| Alias | Canonical term | Why the alias exists |
| --- | --- | --- |
| ADR | Decision record | The historical file prefix, still the filename pattern `ADR-NNNN-<slug>.md`. |
| Execution ceremony | Ceremony | The long form used when the sentence also mentions work nature. |
| `executionMode` | Ceremony | The field name in code and in persisted work contexts. |
| `agy` | Antigravity | The host's wire key in hook arguments and composed commands. |

Rejected names. These appear in the code or in older notes and are **not** vocabulary.

| Rejected | Use instead | Reason |
| --- | --- | --- |
| `direct-business` | `decision` or `workflow` | The token exists in the create contract only to be refused: passing it raises an error telling the caller to choose a public Business ceremony. A Business has no direct branch. |
| Level 1–6 | Level 1–7 | The range ends at `MAX_LEVEL`, which is 7. |
| Architecture decision record | Decision record | Decisions cover more than architecture: policy, product, and process decisions use the same record. |

## See also

- [The work domain model](../explanation/domain-model.md) — the boundaries, the
  ownership relations, and the four invariants behind these terms.
- [Memory model](memory-model.md) — where each entity lives on disk, and which
  files are generated.
- [Native hosts](hosts.md) — the generated host matrix.
- [Agents](agents.md) — the agent roster.
