# Workflow governance: enforcing the journey, not suggesting it

_Why ContextDevKit makes the `/workflow` lifecycle an engine-enforced gate instead of a checklist the AI is trusted to honour — and how numbering and a branch-scoped guard hardened it._

## The problem this solves

ContextDevKit's spec-pack workflow ([ADR-0057](../../contextkit/memory/decisions/0057-workflow-spec-packs-and-completion-reports.md)) gave large features a stable narrative: a folder under `contextkit/memory/workflows/<slug>/` carrying a PRD/PDR, a SPEC, ADR links, task links, memory, and dated completion reports. It defined a 9-phase journey with a mandatory artifact at each step. What it did **not** do was *enforce* any of it.

That gap surfaced three distinct failures, which [ADR-0071](../../contextkit/memory/decisions/0071-workflow-numbering-and-journey-gate.md) addresses together:

1. **The journey was advisory.** A model could call `advance` nine times in a row and march from `intake` to `conclusion` leaving `prd.md`, `spec.md`, `decisions.md`, `tasks.md`, and the reports completely empty. The discipline lived entirely in the prompt — and a prompt is a request, not a constraint. Weaker CLIs (a Gemini Flash, say) skip steps and ship half-tracked, buggy work; even a capable model under time pressure cuts the corner. The artifact existed; the *guarantee* did not.

2. **Workflows were bare slugs.** Unlike ADRs — which are `NNNN-slug` and therefore sort, reference, and get talked about by number — a workflow was just `auth-rework/`. Hard to order, hard to cite, no stable handle.

3. **The L5 mutation guard blocked globally.** The phase-aware guard (`getActiveWorkflowBeforeShip` in `simulate-gate.mjs`) refuses source edits while any pre-`ship` workflow is open — the point being to force planning *before* code. But it picked the newest non-`done` workflow across the **whole repo**. One session's pre-ship workflow therefore froze source edits for *every* session, in *every* worktree, even on unrelated branches. The guard meant to protect one flow was breaking all the others.

## The three fixes, as design decisions

### 1. Enforce the journey in the engine

`advanceWorkflow` now refuses to leave a phase whose required deliverables are missing. The check lives in a dedicated, pure module — `workflow-gate.mjs` — whose `checkPhaseGaps(dir, phase, workflow)` returns the list of gaps for the current phase: a missing or stub `prd.md`, an unfilled `## Proposed design` / `## Test plan` in the SPEC, no linked ADR, no roadmap ref, no DevPipeline card in `tasks.md`, no dated report, no recorded suite result. A non-empty list is a hard refusal that *names* the gaps.

This follows the constitution's default-refuse posture (§8): the journey is *unproved* until the deliverable exists, and only a verified artifact opens the gate. The explicit escape is `--force` — a deliberate, recorded override, never a silent one. And because not every refusal should cost you an `advance`, a `workflow check <id>` command previews readiness without mutating anything.

The refusal is not a terse failure; it is a map of what is left to do. Trying to leave `spec` with an empty design section produces:

```
workflow "0007-auth-rework" cannot leave "spec" - missing:
  - spec.md: fill "## Proposed design" and "## Test plan"
Complete these, or pass --force to override.
```

The gate reads the *content*, not just the file's existence — `sectionEmpty` treats a heading with nothing beneath it as still-the-scaffold, so seeding a stub PRD never counts as completing it. `tableHasRow` likewise requires a real data row in `decisions.md` / `tasks.md`, not just the template's header. The check is structural and deterministic: the same workflow folder yields the same verdict for every model, every time.

### 2. Number workflows like ADRs

`createWorkflow` computes the next 4-digit number (`max existing + 1`, starting at `0001`) and stamps `number:` into the index; the folder becomes `NNNN-slug`. Path resolution (`resolveFolderName` / `packDir`) accepts a slug *or* a number *or* the full `NNNN-slug`, so every old reference keeps resolving. The ordering key stays `started` — the number is an identity, not a sort key.

Existing installs are migrated by `renumberByStarted`: it sorts well-formed workflows by start date (oldest = `0001`), backfills `number:`, and renames folders. It is **idempotent** — a workflow already at its target name and number is left untouched — and runs automatically from `install.mjs` on a fresh install and on `--update`, so projects renumber the moment they pull the kit forward.

### 3. Scope the L5 guard by branch

`createWorkflow` records the current git branch (`branch:`) at creation, read zero-dep from `.git/HEAD` — correctly following the `gitdir:` pointer when `.git` is a *file*, as it is inside a worktree. The guard now blocks an edit only when an active pre-`ship` workflow's recorded branch equals the current branch:

```js
const active = list.find((w) =>
  w.currentPhase && w.currentPhase !== 'done' &&
  w.branch && branch && w.branch === branch);
```

A workflow with **no** recorded branch (a legacy one, created before this change) never branch-scopes and therefore never blocks. That is the deliberate trade-off: favour *"never break an unrelated flow"* over *"never miss a block."* Over-blocking strands real work in other worktrees; an under-block on a legacy workflow at most lets one stale edit through. The guard's job is to keep one disciplined flow honest, not to police the whole machine.

### A note on migration safety

`renumberByStarted` is the kind of one-shot rename that, done carelessly, corrupts a repo. Three properties keep it safe to run unattended on every update. It is **idempotent** — it computes each workflow's target name and number and skips any folder already there, so re-running it is a no-op rather than a re-shuffle. It writes the `number:` field atomically (tmp + rename) before renaming the folder, so an interrupted run never leaves an index claiming a number its folder does not have. And it operates only on **well-formed** workflows — a folder whose index will not parse is left exactly as found, never renamed into a number it cannot back up. The migration moves identities; it never touches the deliverables those identities point at.

## Why enforce in the engine, not the prompt

This is the load-bearing decision, and it is the project's core thesis in miniature. ContextDevKit's whole premise is that AI-assisted development should be *enforced through Claude Code hooks rather than relying on the AI's goodwill*. A rule that lives only in `CLAUDE.md` or a skill briefing is a rule the model can rationalise its way past — and the more capable the model, the more persuasively it argues for the shortcut. A rule that lives in `workflow-gate.mjs` is arithmetic: the deliverable is there or it is not.

Putting the gate in the engine also makes it **host-agnostic**. The same `workflow.mjs` engine drives Claude, Codex, and Antigravity; a gate in the code holds all of them to the identical bar, where a gate in a Claude-specific prompt would protect exactly one host and leave the weaker CLIs — precisely the ones most likely to skip a step — ungoverned. The harness enforces; it does not negotiate.

## The 9-phase lifecycle

The gate is checked on *leaving* each phase. `intake` and `conclusion` have no leave-gate (they bookend the journey); `roadmap` only gates feature-kind workflows.

```
intake → prd → spec → adr → roadmap(if feature) → pipeline → ship → testing → conclusion
```

| Phase       | Gate to leave it |
| ----------- | ---------------- |
| `prd`       | `prd.md` exists with `## Problem` and `## Goals` filled |
| `spec`      | `spec.md` has `## Proposed design` and `## Test plan` filled |
| `adr`       | at least one ADR linked in `decisions.md` (or an `adr` ref) |
| `roadmap`   | a roadmap ref set (a P-id, or `not-applicable`) |
| `pipeline`  | at least one DevPipeline card linked in `tasks.md` |
| `ship`      | a dated report exists under `reports/` |
| `testing`   | the latest report records the suite command + exit code |

`ship` is also the phase boundary the L5 guard watches: source edits stay blocked until the workflow reaches it, which is exactly when planning is done and implementation begins.

## Trade-offs and how they are contained

The blast radius is high — this touches the workflow engine *and* the mutation guard that polices the whole repo, the two places a regression hurts most. Three things contain it:

- **SRP splitting.** Rather than swelling `workflow-pack.mjs` past its line budget, numbering moved to `workflow-number.mjs` and the gate to `workflow-gate.mjs` — each a pure, `node:fs`-only module with one job, testable in isolation.
- **Backward-compatible parsing.** Legacy single-file breadcrumbs and null-`branch` / null-`number` workflows all still parse and never throw; a malformed index yields an explicit *malformed* marker, never a silent skip. This matters for the guard especially: a corrupt workflow that quietly vanished from the list could *un-block* edits that should stay blocked — a refused-silently-to-false-negative, the one degradation §8 forbids. So `listWorkflows` keeps malformed entries as visible markers rather than dropping them.
- **Integration tests.** `integration-test-workflow-governance.mjs` exercises numbering, the gate, the branch-scoped guard, and the migration end-to-end, per the constitution's "every addition ships with a test" rule.

The one residual trade-off is the **legacy null-branch** rule in §3: a workflow with no recorded branch can no longer block anyone. It is a conscious choice to bias the guard toward letting unrelated work proceed.

## See also

- [ADR-0071](../../contextkit/memory/decisions/0071-workflow-numbering-and-journey-gate.md) — the core decision documented here.
- [ADR-0057](../../contextkit/memory/decisions/0057-workflow-spec-packs-and-completion-reports.md) — the spec-pack lifecycle this gate hardens.
- [ADR-0058](../../contextkit/memory/decisions/0058-default-grade-3-and-grade-4-informed-consent.md) — autonomy grades. At higher grades the AI advances workflows on its own, which is exactly why the gate must be enforced rather than trusted.
- [Active squads](./active-squads.md) — the agent roster the workflow phases hand work to.
- [The deliberation council](./deliberation-council.md) — the sibling "enforce, don't suggest" mechanism: gates that convene a debate instead of trusting a single voice.
