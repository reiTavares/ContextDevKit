# CLI Reference

Every `workflow` command, its flags, one example, and whether it **writes
state** or is **read-only**. Derived from the real
[`workflow.mjs`](../../templates/contextkit/tools/scripts/workflow.mjs). Invoke
via the kit's `/workflow` command (or `node …/workflow.mjs <cmd>`).

The slug positional accepts a workflow slug or its `NNNN` number. Read-only
commands print JSON or a status line and never mutate the pack.

## new — create a workflow (legacy or wave)

Without `--profile`, creates a legacy ADR-0057 journey pack. With `--profile`,
creates a wave pack (writes `index.md`, required files, `reports/`, and
`workflow-plan.json`; **not** `workflow-state.json`).

- Legacy flag: `--kind <kind>` (default `feature`).
- Wave flags: `--profile <p>` (required for wave mode), `--pattern <p>`,
  `--addon <a>` (repeatable), `--plan <file>`.

Writes files (creates the pack).

```
workflow new my-fix --profile basic
workflow new big-thing --profile program --pattern large-program --addon security
```

## advance — move the journey forward

Advances the ADR-0057 governance phase. `--ref <ref>` records the phase
artifact; a trailing positional is accepted as a legacy ref. `--force` skips the
phase-leave gate.

Writes state (journey/frontmatter).

```
workflow advance my-fix --ref spec.md
```

## check — verify the current journey phase is complete

Reports whether the current phase's required artifacts exist; exits non-zero
when something is missing. Read-only.

```
workflow check my-fix
```

## status — list workflows / show one

No positional ⇒ all workflows; a positional ⇒ just that one. `--json` for
script-safe output. Read-only.

```
workflow status my-fix --json
```

## refresh (alias: render) — regenerate projections

Regenerates `tasks.md`, the `index.md` status block, and
`CONTINUATION-PROMPT.md` from plan + state + git facts. Reports which changed.

Writes files (managed blocks only; hand-written content preserved).

```
workflow refresh my-fix
```

## next-run — the deterministic dispatch plan

Prints the pure scheduler output: `readyWaves`, `blockedWaves` (with
`blockedBy`), `dispatches` (runs + agent-slot assignments), `deferredTasks`,
`ownershipConflicts`, `humanActions`. Read-only.

```
workflow next-run my-fix
```

## ownership-check — detect path collisions

Prints ownership collisions across the plan's agent tasks (two tasks writing one
file, overlapping globs, shared paths without an integration owner). Exits
non-zero if any collision exists. Read-only.

```
workflow ownership-check my-fix
```

## record-agent-result — ingest a result, advance a task

`--file <f>` is the agent result JSON. Validates its file paths against the
task's ownership lane, persists it under `reports/agents/`, and advances the
task status in state. Exits non-zero (after recording) if there are ownership
violations.

Writes state (and creates `workflow-state.json` on first call).

```
workflow record-agent-result my-fix --file reports/agents/W1-T2.json
```

## check-gate — evaluate a gate

Positional `<gate>`. Prints the gate verdict; a recorded explicit approval at
the current revision wins over a pending verdict. Exits non-zero unless the
status is `passed` or `approved`. Read-only.

```
workflow check-gate my-fix G-W1
```

## approve-gate — record an explicit human approval

Positional `<gate>`. `--approver <name>` (falls back to the current branch),
`--evidence <file>` optional. Records a named, timestamped human approval at the
current revision — human approval is never inferred.

Writes a gate result file.

```
workflow approve-gate my-fix G-W1 --approver alice --evidence reports/gates/note.md
```

## close-wave — close a wave when it is done

Positional `<wave>`. Without `--apply` it reports readiness only; with `--apply`
it marks the wave done **only** when every task is done AND its gate is
passed/approved (default-refuse). Prints `allTasksDone`, `gateStatus`,
`applied`, `blocked`. Exits non-zero if `--apply` was requested but blocked.

Read-only without `--apply`; writes state with `--apply`.

```
workflow close-wave my-fix W1 --apply
```

## explain-file — what an artifact is for

Positional `<id>`. Prints the artifact's purpose, author, source of truth,
`required`, `whenToRead`, and `mustNotDuplicate`. Read-only.

```
workflow explain-file risk-register
```

## required-files — required artifacts for a profile

`--profile <p>` ⇒ the required artifact ids (widened by `--addon <a>`,
repeatable). No `--profile` ⇒ lists the available profiles. Read-only.

```
workflow required-files --profile advanced --addon security
```

## report — write a factual workflow report

Optional `--task <id>`; `--force` to overwrite. Writes a deterministic,
git-derived report (no full patches).

Writes a report file.

```
workflow report my-fix --task W1-T2
```

## Quick map: writes vs. read-only

| Writes state / files | Read-only |
| --- | --- |
| `new`, `advance`, `refresh`, `record-agent-result`, `approve-gate`, `close-wave --apply`, `report` | `check`, `status`, `next-run`, `ownership-check`, `check-gate`, `close-wave` (no `--apply`), `explain-file`, `required-files` |
