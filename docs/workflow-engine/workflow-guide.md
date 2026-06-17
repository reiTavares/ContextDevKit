# Workflow Guide

How to use the wave engine end-to-end. See the [README](./README.md) for
terminology and the [CLI reference](./cli-reference.md) for exact flags.

## When to use which profile

Pick the smallest profile that fits — the engine never forces a full program
pack onto a one-wave change. Defaults are defaults, not hard limits.

| Situation | Profile | Why |
| --- | --- | --- |
| Trivial chore / typo / config tweak | `pipeline-only` | **No pack** — a single DevPipeline card covers it. No waves, no JSON. |
| A relevant bug or a small, cohesive feature | `basic` | 1 wave (`single-delivery`). Keep small work small. |
| A non-trivial feature or a localized architecture change | `standard` | 3–4 waves (`discovery-build-validate`, W0–W3). |
| Cross-cutting architecture with several integrations | `advanced` | 5–7 waves (`architecture-foundation-integration`). |
| Multi-week, multi-session, parallel swarms over a DAG | `program` | Arbitrary DAG of waves/tasks/gates (`large-program`). |

Full per-profile files and gates: [profile-guide.md](./profile-guide.md).

## Creating a workflow

The legacy journey-only workflow is still the default — `workflow new <slug>`
creates an ADR-0057 pack and prints `Next phase: intake`. To opt into the wave
engine, pass `--profile`:

```
workflow new <slug> --profile <profile> [--pattern <pattern>] [--addon <a>]... [--plan <file>]
```

- `--profile` (required to get a wave pack) — one of the five profiles.
- `--pattern` — overrides the profile's default pattern (seeds the wave
  skeleton, default dependencies, default gates). Omit to use the default.
- `--addon` — repeatable; each add-on adds required files, validations, gates.
- `--plan` — supply a hand-authored `workflow-plan.json` (the `program` path).

What creation writes: `index.md`, the profile's required human/seed files,
`reports/`, and `workflow-plan.json`. **`workflow-state.json` is NOT created at
this point — state is born on first execution** (e.g. the first
`record-agent-result`). An existing target folder is never clobbered.

## Journey vs. waves — two orthogonal axes

These answer different questions and never replace each other:

- **Journey** (governance phase) — `intake → prd → spec → adr → roadmap →
  pipeline → ship → testing → conclusion` (ADR-0057, unchanged). It answers
  *"which governance phase is this workflow in?"* The authority is `index.md`
  frontmatter + the journey gate (ADR-0071). Driven by `advance` / `check`.
  `workflow-plan.json` carries a `journey.currentPhase` mirror for machine
  reads, but `index.md` remains canonical.
- **Waves** (execution topology) — answer *"how is the approved work
  executed?"* Driven by the wave verbs (`next-run`, `record-agent-result`,
  `check-gate`, `approve-gate`, `close-wave`, `refresh`).

No phase is added, removed, or reordered by the wave engine.

## Source-of-truth matrix

No factual execution state may have multiple hand-maintained sources. JSON is
the machine contract; Markdown is the human interface; generated Markdown is a
**projection** wrapped in idempotent managed blocks (hand-written content
outside the block is always preserved).

| Information | Canonical source | Authorship |
| --- | --- | --- |
| Problem & value | `prd.md` | human |
| Technical design & contracts | `spec.md` | human |
| Local implementation decisions | `decisions.md` | human |
| **Execution topology** | `workflow-plan.json` | machine contract (human-seeded) |
| **Actual execution state** | `workflow-state.json` | machine-owned (never hand-edited) |
| Human task view | generated block in `tasks.md` | **projection** of plan + state |
| Agent / gate / wave results | `reports/{agents,gates,waves}/*.json` | machine |
| Human evidence narrative | `reports/**/*.md` | human |
| Cross-wave acceptance | `acceptance-matrix.md` | human |
| Risks & mitigations | `risk-register.md` | human |
| Activation & reversibility | `rollout-plan.md` | human |
| Session continuation | generated `CONTINUATION-PROMPT.md` | **projection** |

The full matrix is ADR-0100 §3; the per-file rules are in
[file-catalog-guide.md](./file-catalog-guide.md).

## A typical wave loop

1. Author tasks + ownership in `workflow-plan.json` for the ready wave.
2. `workflow next-run <slug>` — read the dispatch plan (ready waves, runs, slot
   assignments, deferred tasks, ownership conflicts, human actions).
3. `workflow ownership-check <slug>` — confirm no two tasks write one file.
4. Execute the tasks (orchestrator/human), then `record-agent-result` per task.
5. `workflow check-gate <slug> <gate>` — and `approve-gate` for a human gate.
6. `workflow close-wave <slug> <wave> --apply` once tasks are done and the gate
   passes.
7. `workflow refresh <slug>` — regenerate `tasks.md`, `index.md` status, and
   `CONTINUATION-PROMPT.md` projections.
