# Migration Guide

Migrating a legacy workflow onto the wave engine is **opt-in and
non-destructive** (ADR-0101 §11). There is no forced or global rewrite, and
legacy + hybrid workflows keep working unchanged — legacy support is not removed
in this release.

> **Implementation status (be accurate):** the migration **pipeline is a design
> contract in ADR-0101 §11 and the [WF0035 spec](../../contextkit/memory/workflows/0035-universal-wave-workflow-engine/spec.md)**
> (WAVE 3). At the time of writing, `workflow.mjs` does **not** yet expose
> `audit` / `migrate` subcommands and no `audit.mjs` / `migrate.mjs` module
> ships in `workflow/`. This guide documents the intended pipeline and the
> non-destructive guarantees so the behavior is known; it does not invent CLI
> flags. Until the verbs land, migration is performed by hand following the same
> safety rules, and the legacy `new/advance/check/status/report` path continues
> to work.

## The pipeline

```
discover → audit → propose → dry-run → explicit apply → verify → receipt
```

| Stage | What it does | Mutates? |
| --- | --- | --- |
| **discover** | Find candidate legacy workflows. | no |
| **audit** | **Report** inconsistencies (e.g. `index` vs `tasks` vs `memory`) — it never silently picks a winner. | no |
| **propose** | Produce a migration plan (which managed blocks would be inserted). | no |
| **dry-run** | Show the exact changes. **Zero writes.** | no |
| **apply** | Apply only on **explicit** opt-in; edits only inside managed blocks, preserving all human content outside them. | yes (managed blocks only) |
| **verify** | Confirm the applied result is consistent and reversible. | no |
| **receipt** | Record what was migrated, for traceability. | writes a receipt |

Key guarantees:

- **Dry-run performs zero writes.** Nothing on disk changes until an explicit
  apply.
- **Audit reports contradictions, it does not resolve them.** The classic
  failure mode — `index.md` says "Wave 1 NOT APPLIED" while `tasks.md`/`memory.md`
  say "applied in production" — is surfaced for a human to decide, never
  auto-fixed.
- **Apply preserves human content.** It edits only inside ADR-0067 managed
  blocks; hand-written prose outside the block is untouched.
- **Reversible by construction.** Removing the managed block (or deleting the
  new `workflow-plan.json` / `workflow-state.json`) restores the prior
  legacy-Markdown pack. No phase, numbering, or journey-gate change occurs, so
  there is no governance state to migrate back.

## Opt-in rollout stages

From the WF0035 [rollout-plan](../../contextkit/memory/workflows/0035-universal-wave-workflow-engine/rollout-plan.md).
Every stage is reversible; the model is opt-in this release.

| Stage | Action |
| --- | --- |
| 1 | New workflows MAY opt into the wave engine (`--profile` / `--plan`); default `workflow new` is unchanged. |
| 2 | Dogfood on WF0035 itself — its own `workflow-plan.json` drives scheduling. |
| 3 | Dogfood a Basic (1-wave) workflow end-to-end. |
| 4 | Dogfood a Standard (3–4-wave) workflow. |
| 5 | `audit` all existing workflows (read-only, zero mutation). |
| 6 | Opt-in `migrate` of ONE active Program workflow (explicit apply + receipt). |
| 7 | Consider making the new model the default — only under a separate ADR. |

### Activation gates & kill switch

- Stage 1 ships only after the WAVE 1/2/3 machine gates (G-W1/G-W2/G-W3) are
  green.
- Stage 6 (a real migration) requires explicit human authorization **per
  workflow**.
- Stage 7 (new model as default) requires a new ADR.
- **Kill switch:** if the engine misbehaves after merge, stop using the new
  subcommands — the legacy `new/advance/check/status/report` path continues to
  work unchanged, and the new JSON files are inert to that path, so there is no
  data migration to undo.

See also: [workflow-guide.md](./workflow-guide.md) ·
[cli-reference.md](./cli-reference.md) · [README](./README.md).
