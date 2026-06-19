# Universal Wave-Based Workflow Engine

One wave-based execution model for every workflow size — from a one-wave Basic
fix to a multi-week Program — layered over the existing ADR-0057 governance
journey. Execution topology lives in `workflow-plan.json` (machine contract,
human-seeded) and execution state in `workflow-state.json` (machine-owned,
never hand-edited); the human-readable `tasks.md`, `index.md` status, and
`CONTINUATION-PROMPT.md` are **generated projections** of that JSON plus repo
truth. A pure DAG + scheduler computes readiness, capacity, ownership conflicts,
and required human actions without ever launching an agent. Behavior is driven
by four versioned JSON registries (profiles, patterns, files, add-ons), so the
CLI stays thin and explainable. The full rationale is in the ADR — these guides
are the practical reference.

> Canonical decision: [ADR-0101](../../contextkit/memory/decisions/0101-universal-wave-based-workflow-engine.md)
> · Spec: [WF0035 spec.md](../../contextkit/memory/workflows/0035-universal-wave-workflow-engine/spec.md)

## Guides

| Guide | Read it for |
| --- | --- |
| [workflow-guide.md](./workflow-guide.md) | End-to-end usage: picking a profile, creating a workflow, journey vs. waves, source-of-truth matrix. |
| [profile-guide.md](./profile-guide.md) | The 5 profiles — required/optional files, default pattern, gates, parallelism. |
| [file-catalog-guide.md](./file-catalog-guide.md) | Every artifact: purpose, author, single source of truth, what it must not duplicate. |
| [cli-reference.md](./cli-reference.md) | Every `workflow` command + flags, with one example each and which write state. |
| [migration-guide.md](./migration-guide.md) | The non-destructive migration pipeline and the opt-in rollout stages. |

## Terminology (ADR-0101 §7)

- **Wave** — a logical delivery stage with `dependsOn` (other waves it waits on)
  and a gate. Its status is **not** stored in the plan; it is a projection from
  state.
- **Run** — a scheduler-generated dispatch batch (e.g. `RUN-006-A`). Runs are
  computed by the scheduler, never hardcoded into the plan.
- **Task** — one accountable unit of work with exactly one owner. Its execution
  mode is `agent | deterministic | orchestrator | human`. Two independent
  reviews are two tasks, never two agents on one task.
- **Agent slot** — one unit of parallel capacity (e.g. `RUN-006-A01`). Capacity
  (`maxConcurrentWaves/Runs`, `maxAgentsPerRun`, `maxTotalAgents`) is a ceiling,
  not a quota: 6 ready agent-tasks with 5 slots ⇒ 5 dispatched now, 1 deferred.
  Only `agent`-mode tasks consume a slot.
- **Gate** — a first-class checkpoint, `machine` or `human`. A wave cannot close
  while its gate is incomplete; human approval is **explicit only**, never
  inferred or auto-passed.
- **Profile** — the complexity dial: `pipeline-only | basic | standard |
  advanced | program`. It selects required/optional files, default pattern,
  minimum gates, and parallelism guidance. See [profile-guide.md](./profile-guide.md).
- **Pattern** — a named wave skeleton (e.g. `discovery-build-validate`) that
  seeds waves, default dependencies, and default gates. Each profile has a
  default pattern; `--pattern` overrides it.
- **Add-on** — an optional capability bundle (e.g. `security`, `benchmark`) that
  adds required files, validations, and gates on top of the profile.

## Non-goals (hard boundary)

The scheduler is **pure**: it computes a dispatch plan but never invokes Claude,
spawns agents, or edits source. There is **no autonomous agent launcher and no
remote scheduler**. The orchestrator (Claude) or a human executes the plan.
