# Swarm feasibility study — a coordinated agent swarm on the autonomy substrate

> Status: **study** (input to a future `/debate` → ADR-0051 cycle — not a spec, not a commitment).
> Premise: ADR-0041…0050 fully implemented. Scope decided up-front: kit feature
> (source under `templates/`), target grade-4 full-auto, F3 (ADR-0044) lands first.
> Date: 2026-06-11.

## 1. Premise and question

Can ContextDevKit host a **strong agent swarm** — one coordinator pulling several
DevPipeline tasks at once, delegating each to squad agents working in parallel,
controlling and consolidating everything — while honoring every ADR and the
constitution?

**Verdict: yes, and ~70% of the substrate already exists.** What the swarm needs
that does not exist yet is (a) the F3 fan-out economy (tasks 113–115), (b) the F4
grade-4 control plane (task 116), and (c) **one new ADR (~0051)** defining the
coordinator itself — today every orchestration entry point (`/ship`, `/advise`,
`/deep-analysis`) is one-shot and hand-codes its own dispatch; nothing pulls N
backlog tasks and runs them as parallel workstreams.

## 2. What the substrate already provides (inventory)

With ADR-0041…0050 shipped, a swarm inherits for free:

| Pillar | Mechanism | Where |
| --- | --- | --- |
| **Consent** | `resolveAutonomy(area, config, override, context)` — closed area enum, precedence flag→session→config→default, floor clamps last | `templates/contextkit/runtime/config/resolve-autonomy.mjs` (ADR-0042) |
| **Floor (non-negotiable)** | secret paths (`matchSecret`), force-push, gate/hook self-edits, ADR/`grade-change` always `manual`; grade-4 `push` auto **only toward a non-default branch**; grade 4 throws if `deliberations.active === false` | same file, `floorReason()` + push branch check |
| **Observability** | state.json v1, append-only `events[] { ts, from, to, actor: human\|auto\|qa\|evict, inverse }`, atomic writes; "if it isn't an event, it didn't happen" | `templates/contextkit/runtime/state/state-io.mjs` (ADR-0043) |
| **Transition legality** | `auto` may move backlog→working→testing, **never enter or leave `conclusion`**; `qa-reject` is the only testing→working path | ADR-0043 matrix, enforced by pipeline verbs |
| **Economy (F3)** | deterministic subagent context-packs (≤120 lines, ~2K tokens), D3 per-command/per-agent token attribution `{ ts, command, subagents, tokensIn, tokensOut }`, budget-gate that **downgrades 4→2 `suggest`, never blocks** | ADR-0044, tasks 113–115 |
| **Control plane (F4)** | eligibility bar (≥30 evented transitions, ≥20 sessions, <10% rollback, zero wiring-drift, coverage harness green, D3 present — any miss → refuse); hardened quorum (blind voices + ≥1 deterministic voice = test/selfcheck exit codes; security Critical = **veto**, not a vote; `unresolved` escalates to human); per-step kill-switch | ADR-0045, task 116 |
| **Isolation** | git worktrees (`/worktree-new`), per-session ledgers, workspace claims with the seniority rule (older session owns, newer blocked) | ADR-0004 |
| **Conflict prediction** | project-map blast-radius edges, fan-out-queryable | ADR-0046 |
| **Host parity** | `.agents/` dir + `hooks.json` composer keep all gates live under Antigravity | ADR-0048/0049 |

Existing fan-out practice proves the dispatch shape: `/advise` runs 6 lanes in
parallel, `/debate` runs N blind voices (ADR-0035), qa-orchestrator fans to
unit/integration/fuzzer. The swarm composes these patterns; it invents no new
agent mechanics.

## 3. Architecture

**The coordinator is a skill + a deterministic engine — not an agent.**
Subagents cannot spawn subagents, so an orchestrator `.md` agent cannot fan out.
The kit has solved this shape twice already (`/ship` + `ship-state`, and the
squad-pipeline DSL: pure `plan()` consumed by an LLM executor). The swarm mirrors
it:

- **`/swarm` skill** — `templates/claude/commands/pipeline/swarm.md` (+ the
  Antigravity mirror per ADR-0048/0049). Runs in the **main session**; it is the
  only thing that issues Task calls, embeds the F3 context-pack in every charter,
  and consults `resolveAutonomy()` at every wave boundary.
- **`swarm-plan.mjs`** (~220 lines, pure) — ranks backlog candidates with the
  existing WSJF logic (`pipeline-prioritize.mjs`), derives a **predicted
  touch-set** per task (card `paths:` frontmatter → recorded `/simulate-impact`
  receipt → project-map module inference; **no derivable touch-set → refused
  from auto-swarm**, constitution §8), expands one hop through ADR-0046
  blast-radius edges, and greedily partitions into K provably disjoint
  workstreams (overlap → higher WSJF wins the slot, the other defers to the next
  wave).
- **`swarm-state.mjs`** (~180 lines) — run manifest I/O at
  `.claude/.swarm/<runId>.json`: atomic writes (the `state-io` pattern),
  heartbeats, eviction, run report. Paths via `pathsFor(root)` (rule 4).

**Run flow:**

```
plan (K disjoint workstreams)
  → worktree per workstream  (branch swarm/<runId>/<taskId>; claim the touch-set in the main repo)
  → parallel Task dispatch    (charter = task card + F3 pack + "operate only under this path"
                               + implement → self-review → npm test in worktree → commit)
  → per-workstream QA gate    (qa-orchestrator pattern; the worktree's test exit code IS the
                               deterministic quorum voice of ADR-0045)
  → pre-push conflict recheck (cross git diff --name-only; any overlap that escaped the
                               partition parks the YOUNGER workstream — seniority, ADR-0004)
  → branch-only push          (grade-4 push contract, resolve-autonomy.mjs)
```

**Defining safety property: a grade-4 swarm finishes at `testing`, never at
`done`.** The legality matrix forbids `actor:'auto'` entering `conclusion`, so
each workstream parks in testing with a QA PASS receipt and its deliberation
artifact ID stamped into the state.json event. `/swarm review` then presents the
whole batch and the **human** performs the testing→conclusion moves in one
consolidated approval session — N tasks shipped, one consent interaction.
ADR-0051 must reaffirm this, never relax it.

## 4. Constraint-by-constraint compliance

| Constraint | How the swarm honors it |
| --- | --- |
| Floor areas | Planner excludes secret paths / hook self-edits / ADR work at partition time; the resolver clamps last regardless. A workstream that discovers it needs an ADR refuses and parks — surfaced, never auto-resolved. |
| Transition legality | Coordinator emits only backlog→working→testing with `actor:'auto'`; conclusion stays human (see §3). |
| Budget exhausted mid-run | No new waves; in-flight Tasks finish their current step (they cannot be killed mid-tool), park in `working` with note `budget-exhausted`; the manifest stores the resume plan. Downgrade-not-block, exactly ADR-0044 §3. |
| Kill-switch | The resolver is re-consulted at every wave boundary and before every push — never cached per run (ADR-0045). `/autonomy 1` mid-run means worst-case exposure of one in-flight step, on a branch, in a worktree; nothing reaches the default branch. |
| Attribution | D3 ledger records gain `runId` + `workstream`; state.json events gain an optional `by: { runId, workstream, agent }` field (backward-compatible — `appendEvent` validates only known fields). |
| Hardened quorum | Each workstream's ship-checkpoint at grade 4 resolves to `debate` (the existing `MODE_TABLE` row): blind voices + the worktree's deterministic test exit code; security Critical = veto; `unresolved` → park, never push. |
| Hooks never break work | The swarm adds no blocking hook. simulate-gate, concurrency-guard and track-edits operate unchanged inside each worktree's own session ledger. |

## 5. New contracts ADR-0051 must lock

1. **Run manifest schema** — `{ runId, startedAt, grade, configSnapshot, workstreams: [{ id, taskId, branch, worktree, touchSet, status, heartbeatTs, deliberationId, tokens }] }` with status ∈ `planned | dispatched | working | qa | parked-testing | parked-budget | failed | evicted`; append-only status history mirroring the events idiom.
2. **Area-enum extension: `swarm-dispatch`** — launching N parallel auto workstreams is a materially larger consent grant than one `pipeline-move`. Proposed row `['manual','manual','suggest','auto']`. Extending `AREAS` is an ADR-level change by the ADR-0042 contract — this alone justifies ADR-0051's existence.
3. **Subagent identity in events** — the optional `by` field (first-class, replay-friendly) over a structured-note convention.
4. **Width and wave caps** — `swarm.maxWorkstreams` (default 3, hard cap 5), `swarm.maxWavesPerRun` (default 2), `swarm.tokenBudgetPerRun` (a sub-budget of `tokens.budgetPerSession` feeding the budget gate), `swarm.staleMinutes` (default 30).
5. **Failure/retry** — qa-reject → exactly one auto retry (mirrors `max_review_cycles` in the squad-pipeline DSL); second failure → `failed`, parked with the QA report attached, never silently retried.
6. **Eviction** — stalled workstream → `evicted` via the existing `evict` actor; the worktree is preserved for forensics and removed only by an explicit `/swarm clean`.
7. **Worktree lifecycle** — creation only via an extended `worktree-new.mjs --swarm <runId>`; the default branch is never checked out in a swarm worktree.
8. **Merge-time conflict recheck** — the cross-workstream `git diff --name-only` overlap check as a mandatory pre-push gate, resolved by workstream seniority.
9. **Grade-4 eligibility delta** — the full ADR-0045 bar **plus ≥3 completed grade-3 swarm runs with zero conflict storms**, measured from manifests.
10. **Tests** — `tools/integration-test-swarm.mjs` in the `npm test` chain (planner determinism, manifest atomicity, legality of every event the engine can emit, eviction, budget-park path) + selfcheck wiring-drift entries for every new file (rule 3).

## 6. Phasing and estimates

| Phase | Content | Estimate |
| --- | --- | --- |
| P0 | Zero-code validation run (§8) | 2–3 days |
| P1 | F3 — tasks 113–115 (context-packs, D3 attribution, budget-gate, memory retriever) | ✅ shipped in v2.0.0 (2026-06-11) |
| P2 | F4 — task 116 (eligibility bar, hardened quorum, kill-switch mechanics) | ✅ shipped in v2.0.0 (2026-06-11) |
| P3 | Eligibility data accumulation (≥30 transitions, ≥20 sessions, <10% rollback) | **calendar weeks, passive — the real bottleneck** |
| P4 | `/debate` on the swarm design → ADR-0051 | ✅ ADR-0051 created 2026-06-11 (this study accepted as the deliberation input; separate `/debate` waived) |
| P5 | Swarm v1, grade-3: human approves each wave and each merge | ✅ shipped 2026-06-11 (same day — `/swarm` + swarm-plan/state engines + 23-check suite; task 123) |
| P6 | Swarm v2, grade-4: per-workstream quorum, branch-only auto-push | 1–2 weeks after ≥3 clean v1 runs |

> **Status update (2026-06-11, post-v2.0.0):** F3 and F4 shipped the same day this
> study was written — the autonomy package (F0–F4) is complete. The critical path
> is now P3 (passive data accumulation) in parallel with P4 (ADR-0051) and P5.
> Cost-tier composition also landed early: ADR-0052 ships per-agent `model:` tiers,
> so swarm workstreams inherit tier routing for free (see
> [model-tier-routing-study.md](model-tier-routing-study.md)).

Critical path: P1 → P2 → (P3 in parallel with P4/P5) → P6. Realistic wall-clock
to v2: **~2–3 months, dominated by P3**. **v1 grade-3 is the product; v2 is the
bonus** — if the eligibility bar is never met, a permanently grade-3 swarm is an
acceptable, useful outcome.

## 7. Risks and kill criteria

1. **Token economics (highest).** K workstreams × (pack + implement + QA fan-out + grade-4 quorum); ADR-0044's own numbers put one deliberation at 25–80K tokens, so a K=3 run with quorums can burn 200K+. Mitigation: D3 makes it measurable *before* v2; `swarm.tokenBudgetPerRun`; quorum only at the final checkpoint. **Kill criterion: cost per shipped task > ~2× a human-driven `/ship` → stop at v1.**
2. **Conflict storms.** Touch-set prediction is heuristic; blast-radius edges are static. Measure overlap rate in v1; **>20% → simulate-impact receipts become mandatory partition input.**
3. **Eligibility bar never met.** <10% rollback + zero wiring-drift across 30 transitions is strict on a fast-moving repo → grade-3 forever (explicitly acceptable, see §6).
4. **Parked-testing pile-up.** A neglected `/swarm review` queue makes throughput illusory. Mitigation: Stop-digest nudge when parked count > K.
5. **Worktree friction on Windows** (file locking, `node_modules` duplication — see the known runtime-copy requirement for committing in fresh worktrees). P0 validates on this machine first.
6. **Coordinator context exhaustion.** K charters + K reports in one session. Mitigation: charters are pack-sized by contract; reports are manifest-backed, the coordinator reads summaries only.

## 8. What is possible today (P0 — zero new code)

The validation run, before any ADR is written:

1. `/plan-week` → pick 2–3 visibly disjoint backlog tasks.
2. `/worktree-new <feature>` per task.
3. In one main-session message, fan out 2–3 Task subagents — each charter: task
   card + worktree path + "run `npm test` there, commit on the branch". This is
   the `/advise`/`/debate` dispatch pattern, hand-rolled.
4. Consolidate manually; `/qa-signoff` per branch; human merges; `/log-session`.
5. Record token cost from `/token-report` and every conflict incident.

One afternoon answers the two killer questions — **cost per task** and
**conflict rate** — and becomes the baseline row of this study (the
measurement-protocol idiom of ADR-0044 §6).

### P0 baseline — measured 2026-06-11 (run by the maintainer's session, post-ADR-0051)

Two parallel workstreams, ADR-0051 protocol followed manually (D1 context-packs,
path-confined charters, disjoint predicted touch-sets, ADR-0052 tiers — one
deliberately on each tier):

| Workstream | Task | Model tier | Subagent tokens | Tool uses | Wall clock | Outcome |
| --- | --- | --- | --- | --- | --- | --- |
| `feat/swarm-p0-141` | 141 — ctx.mjs `$`-pattern mangling (bug) | `sonnet` | 61,301 | 21 | 4m 05s | ✅ fix + 2-level regression guard, `npm test` green, commit `24574f5` |
| `feat/swarm-p0-143` | 143 — INSTRUCTIONS.md.tpl stale facts (chore) | `haiku` | 52,285 | 30 | 6m 35s | ✅ fix + selfcheck guard, `npm test` green, commit `56ea981` |

- **Cost per task**: ~52–61K subagent tokens. At list-price ratios, the haiku
  workstream ran ~10× cheaper and the sonnet one ~3.3× cheaper than the same
  volume on the session model (Fable 5) — the ADR-0052 composition works in
  practice, including a chore completed end-to-end on the `fast` tier.
- **Cross-workstream conflict rate: 0/2** — `git diff --name-only` intersection
  between the two branches is empty.
- **Finding for `swarm-plan.mjs` (load-bearing):** touch-set prediction from the
  task card alone under-predicts — **rule 3 makes every workstream touch shared
  test files** (141 spilled into `integration-test-antigravity.mjs` +
  `selfcheck-source-cases-recent.mjs`; 143 into `selfcheck-templates.mjs`, which
  also collided with uncommitted main-checkout work). The planner must expand
  every predicted touch-set with the task's likely test-file homes, and shared
  selfcheck/integration shards are the dominant conflict surface to partition by.
- Both branches park awaiting human merge — the finish-at-`testing` property
  held by construction.

---

_Update 2026-06-11: this study has been hardened into
[ADR-0051](../../contextkit/memory/decisions/0051-swarm-coordinator-parallel-workstreams.md)
(the maintainer accepted the study as the deliberation input, waiving a separate
`/debate` round). Next step: the P0 validation run, then swarm v1 (task 123)._
