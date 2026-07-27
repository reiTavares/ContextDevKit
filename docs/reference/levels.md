# Levels reference

<!-- GENRE: Reference (information-oriented)
     Goal: reader looks up exactly what a level activates.
     Voice: dry, accurate, consulted rather than read.
     CONTRACT: the level labels come from the canonical level table and the hook rows
     from the settings composer. Both are single sources of truth — when the
     generator covers this surface these tables move between markers. Never
     hand-invent a hook name or a level label. -->

Levels decide **which** capabilities exist. A separate dial, the autonomy grade,
decides **how much** of them runs without you. The two are independent.

Every level keeps everything below it. Levels 1 through 5 each add host hooks; levels 6
and 7 are capability tiers layered on the level-5 gates — they add commands and tooling,
not new hooks.

Valid range: 1 to 7. Anything outside it is clamped rather than accepted.

## The levels

| Level | Name | What it adds |
| --- | --- | --- |
| 1 | Memory | Boot context, session log, decision records, changelog |
| 2 | Ledger | Drift detection — edit tracking plus a session-end nudge |
| 3 | Multi | Claims, worktrees, derived indices, git hooks. Recommended for a new or empty project |
| 4 | Squads | Specialised sub-agents |
| 5 | Proactive | Impact-simulation gate, technical-debt sweep, contract-drift detection |
| 6 | Autonomy and Insight | Ship pipeline, retrospective learning loop, metrics |
| 7 | Ecosystem and Scale | Fleet across repositories, agent tuning, visual tests, playbooks, token and cost insight. Recommended for an existing project with code |

## Host hooks by level

What the settings composer actually wires for the Claude Code host, cumulative by
level. Each row is one hook registration.

### Level 1 and above

| Event | Matcher | Hook | Effect |
| --- | --- | --- | --- |
| SessionStart | — | `session-start.mjs` | Loads boot context before the first message |
| (status line) | — | `statusline.mjs` | Status-line widget. Only set when you have no status line of your own, or when replacing a previously installed one |

### Level 2 and above

| Event | Matcher | Hook | Effect |
| --- | --- | --- | --- |
| PostToolUse | Edit, Write, MultiEdit | `track-edits.mjs` | Appends every edit to the session ledger |
| Stop | — | `check-registration.mjs` | Nudges when a session would close with unregistered work |

### Level 3 and above

| Event | Matcher | Hook | Effect |
| --- | --- | --- | --- |
| PreToolUse | Edit, Write, MultiEdit | `concurrency-guard.mjs` | Warns when a parallel session has claimed the path |

Level 3 is also where git hooks are installed. See
[footprint](footprint.md) for which ones and what they do.

### Level 4 and above

| Event | Matcher | Hook | Effect |
| --- | --- | --- | --- |
| PostToolUse | Edit, Write, MultiEdit | `auto-format.mjs` | Advisory format and lint pass |
| SessionStart | — | `graph-session-refresh.mjs` | Refreshes the structural graph in a detached process, so boot is never delayed |
| UserPromptSubmit | — | `graph-first-gate.mjs` | Prefers a graph answer over a text sweep; captures the explicit human bypass |
| PreToolUse | Grep, Glob | `graph-first-gate.mjs` | Same gate on the search path |
| PreToolUse | Edit, Write, MultiEdit | `domain-code-gate.mjs` | Domain-engineering code gate |
| PostToolUse | Edit, Write, MultiEdit | `domain-conformance.mjs` | Records conformance and advises |

Two things about this tier are worth stating precisely.

The graph-first gate is registered from level 4 because that is the graph's own
minimum, but it only **blocks** at level 7 and only with an explicit human flip.
Otherwise it is clamped, and it always degrades to warn-and-allow when it cannot
evaluate.

The domain-engineering hooks are registered here so the level-to-mode ladder has its
advisory floor, but they are **off by default**: each exits early unless
`domainEngineering.enabled` is set, so they are inert on an existing install. The
guarded and strict stages stay human-gated through the rollout ceiling.

### Level 5 and above

| Event | Matcher | Hook | Effect |
| --- | --- | --- | --- |
| PreToolUse | Edit, Write, MultiEdit | `simulate-gate.mjs` | Blocks a high-risk-path edit without a recorded impact analysis; also enforces the workflow phase |
| PreToolUse | Edit, Write, MultiEdit | `journey-gate.mjs` | Methodology journey enforcement, guarded with a fallback |
| PreToolUse | Edit, Write, MultiEdit | `deliberation-nudge.mjs` | Soft nudge toward a deliberation. Never blocks |
| UserPromptSubmit | — | `execution-contract-hook.mjs` | Records the execution contract for the request |
| PreToolUse | Read, Edit, Write, MultiEdit, Grep, Glob, Bash | `execution-gate.mjs` | Warns when the contract's preconditions are unmet |
| PostToolUse | Edit, Write, MultiEdit, Bash | `indirect-write-reconcile.mjs` | Reconciles writes that arrived indirectly |
| Stop | — | `completion-gate.mjs` | Refuses to treat a task as done without completion evidence |
| Stop | — | `done-sweep.mjs` | Files concluded workflows at session end |
| PreToolUse | Task | `subagent-gate.mjs` | Scopes a sub-agent spawn |
| SubagentStop | — | `subagent-gate.mjs` | Handles sub-agent completion |
| PreCompact | — | `compaction-continuity.mjs` | Persists obligations before context is compacted |
| SessionStart | — | `compaction-continuity.mjs` | Resurfaces those obligations on resume |

The capability-enforcement gate ships **guarded with a fallback** by default: the intake
ceremony is active, and it is safe to ship active because the gate degrades to advisory
— warn, exit 0 — whenever it cannot evaluate safely. A fresh install is never
false-blocked. Set the enforcement mode to advisory to opt out, or to strict to tighten.

Every hook in this table is fail-open: it exits 0 and stays silent on its own errors, so
a broken hook can never break real work. That is what makes them a governance control
rather than a security control. See [data posture](data-posture.md).

### Levels 6 and 7

No new hooks. These tiers add commands and tooling on top of the level-5 gates — the
ship pipeline and learning loop at 6, fleet coordination, agent tuning, playbooks and
token and cost insight at 7.

The one behavioural difference at level 7: it is the level at which the graph-first gate
can block, and only with an explicit human flip.

## Which level to choose

The installer defaults to 3 for an empty folder and 7 for a folder that already has
code. Higher tiers ship inert until configured, so a high level is additive rather than
intrusive.

The decision table, including the cases where a lower level is the right answer, is in
[install and choose a level](../how-to/install-and-choose-a-level.md).

## Reading and changing the level

```shell
node contextkit/tools/scripts/context-level.mjs        # show
node contextkit/tools/scripts/context-level.mjs 4      # move to level 4
```

Changing the level rewrites the configuration and recomposes the host hook wiring. The
wiring is read once when the host starts, so restart the host afterwards. Going up adds
capability; going down cleanly removes the now-disabled hooks.

To recompose the wiring without touching anything else — for example after editing the
level key by hand:

```shell
npx contextdevkit --rewire --level <1-7>
```

To confirm the wiring on disk matches the configured level:

```shell
node contextkit/tools/scripts/doctor.mjs
```

The doctor exits non-zero when they disagree, and names the mismatch.

## Related

- [Install and choose a level](../how-to/install-and-choose-a-level.md) — the decision
  table and every installer flag.
- [Configuration reference](config.md) — every configuration area, including the
  level-5 high-risk paths the gate protects.
- [Footprint](footprint.md) — the file-by-file inventory of what each level writes.
- [Governance and enforcement](../explanation/governance-and-enforcement.md) — what the
  enforcement modes do, and why absent data is never a pass.
- [Troubleshoot](../how-to/troubleshoot.md) — when the level and the observed behaviour
  disagree.
