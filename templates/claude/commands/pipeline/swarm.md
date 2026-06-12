---
description: Swarm coordinator (ADR-0051) — pull N disjoint backlog tasks and run them as parallel, governed workstreams in isolated worktrees. Finishes at testing/; humans merge via `/swarm review`.
argument-hint: plan [--top N] | run <runId> | review <runId> | clean <runId>
---

# 🐝 Swarm (parallel workstream coordinator)

Arguments: **$ARGUMENTS**

You are the swarm coordinator (ADR-0051). You run in the MAIN session and are the
only thing that dispatches workstream subagents. The engine is deterministic
(`swarm-plan.mjs` plans, `swarm-state.mjs` records); you execute and judge.
Use TodoWrite to track the run.

## Consent gate (every wave — never cached)

Before planning AND at the start of every wave, consult
`resolveAutonomy('swarm-dispatch', config, override)` (the same way `/ship`
consults `ship-checkpoint`): `manual` → stop and ask; `suggest` (grade 3) →
present the plan and get one OK for the run; `auto` (grade 4) → proceed, but
re-consult at every wave boundary and before every push — a user message or
`/autonomy 1` takes effect at the next boundary. Pass `budgetExhausted: true`
when the session crossed `tokens.budgetPerSession` OR the run crossed
`swarm.tokenBudgetPerRun`: then start **no new waves**; in-flight workstreams
finish their current step and park as `parked-budget` (downgrade, never block —
ADR-0044 §3).

## `plan [--top N]`

1. Pick a runId: `swarm-<YYYYMMDD>-<NN>` (NN = first free, check `.claude/.swarm/`).
2. `node contextkit/tools/scripts/swarm-plan.mjs --run-id <runId> [--top N]` —
   the planner WSJF-ranks the backlog, derives touch-sets (card `paths:` →
   simulate receipt → title inference), expands them with likely test-file
   homes, and partitions disjointly. **Honor its refusals verbatim** (no
   derivable touch-set / secret floor / l5 without receipt) — surface them to
   the user with the fix each reason names; never hand-add a refused task.
3. Show the plan (workstreams + touch-sets + tier hints + refused + deferred).
   ◆ At grade ≤ 3 this is the consent point.

## `run <runId>`

1. Persist the approved plan: import `createRun` from
   `contextkit/tools/scripts/swarm-state.mjs` (or pipe the plan JSON through a
   small `node -e` call). Every workstream starts `planned`.
2. Per workstream, in one parallel batch:
   a. Worktree: `node contextkit/tools/scripts/worktree-new.mjs --swarm <runId> <taskId>`,
      then copy `contextkit/runtime` into it (shared git hooks resolve it from cwd).
   b. `/pipeline start <taskId>` (the ADR-0032 gate may require `--force` with a
      stated reason — say it, don't bypass silently).
   c. Build the charter: `context-pack.mjs --for-subagent --objective "<task title>"`
      output at the top + the task card + "operate ONLY under <worktree path>" +
      implement → self-review → `npm test` in the worktree → Conventional Commit.
   d. Resolve the model — DON'T eyeball it (ADR-0052 Phase 2): run
      `node contextkit/tools/scripts/model-policy.mjs tier <tierHint> [--budget-exhausted] --host <claude|codex|agy>`
      using the current host value (`claude`, `codex`, or `agy`), and dispatch
      with the Agent tool's `model` = the returned alias. Omitting `model`
      silently inherits the premium session model — the most expensive path. If
      the resolver returns `model:null`, surface the reason and dispatch without
      a fake override. Mark the workstream
      `dispatched` (record the alias:
      `updateWorkstream(root, runId, wsId, { status: 'dispatched', model })`),
      then `working`.
3. As each returns: run its QA gate (suite output + self-review). PASS → mark
   `qa` then `parked-testing`, `/pipeline move <taskId> testing`, and record the
   token count from the agent's usage into the manifest (`updateWorkstream`).
   FAIL → ONE re-dispatch one tier up via `model-policy.mjs tier <next>` (cap
   `reasoning`/opus); a second failure → `failed`, parked with the QA report in
   the card. Never silently retry. The run report then shows the true per-model
   mix (`swarm-state.mjs report` → `models:` line) so the fan-out cost is
   auditable, not assumed.
4. **Pre-park conflict recheck** (mandatory): intersect `git diff --name-only`
   across all workstream branches; any overlap parks the YOUNGER workstream
   (`failed`, note `conflict-with <ws>` — seniority, ADR-0004).
5. Stale check at each boundary: `node contextkit/tools/scripts/swarm-state.mjs evict <runId>`
   (config `swarm.staleMinutes`). Evicted worktrees are PRESERVED for forensics.
6. **You never move a card into `conclusion/` and never merge.** The run ends
   when every workstream is parked/failed/evicted — print the report
   (`swarm-state.mjs report <runId>`) and hand off to `review`.

## `review <runId>`

Present `swarm-state.mjs report <runId>` + per-branch summaries (diff stat, QA
verdict, commit). The HUMAN then merges each accepted branch and moves cards
testing → conclusion (`/pipeline`). If asked to help merge: merging to the
default branch always resolves `manual` — prepare commands, never run the merge
yourself at any grade.

## `clean <runId>`

Only after review: for each non-active workstream, `git worktree remove <path>`
+ delete merged branches. Refuse to clean a run with workstreams still
`dispatched|working|qa`.

## Hard rules (from ADR-0051 — not relaxable here)

- Workstreams park at `testing`, never `done` — `actor:'auto'` cannot enter
  `conclusion` (ADR-0043 legality).
- `swarm.maxWorkstreams` (hard cap 5) and `swarm.maxWavesPerRun` are contracts.
- Every pipeline transition you make carries
  `by: { runId, workstream, agent }` when the machinery exposes it, so the
  event log attributes swarm work (ADR-0051 §5).
- Grade-4 quorum per workstream follows the `/ship` hardened-quorum section
  (blind voices, deterministic voice, security veto, unresolved → human) and
  stamps the deliberation id into the manifest (`deliberationId`).
