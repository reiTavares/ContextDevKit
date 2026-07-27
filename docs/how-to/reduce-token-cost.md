# How to reduce token cost

<!-- GENRE: How-to guide (task-oriented)
     Goal: reader applies the economy levers deliberately, highest-effect first.
     Voice: direct, imperative. Every command below was run before being cited. -->

## When to use this guide

You are about to start a large piece of work, or your sessions are pulling in
more context than the task needs. The levers are ordered by effect: the first two
change how much context enters the window at all, the rest trim what is already
entering it.

Read the caveat first. None of these levers reorders a stage of work, satisfies
a gate, changes which specialist handles a task, or skips a test. They reduce
context and output cost only.

## Prerequisites

- `node` 18 or later on the path.
- ContextDevKit installed with the economy block present in
  `contextkit/config.json`. Check with:

  ```shell
  node -e "const fs=require('fs');let t=fs.readFileSync('contextkit/config.json','utf8');if(t.charCodeAt(0)===0xFEFF)t=t.slice(1);const e=JSON.parse(t).economy||{};console.log('enabled='+e.enabled,'mode='+e.mode)"
  ```

  Expect `enabled=true mode=advisory`. `enabled=false` means every lever below
  returns unchanged input.
- For steps 1 and 2, a structural map baseline under
  `contextkit/memory/project-map/`.

## Steps

### 1. Query the structure instead of sweeping the tree

This is the largest lever. A broad `grep` or `glob` across a repository pulls
file after file into the window; a graph or map lookup answers the same question
in one line.

Check the map is current before trusting it:

```shell
node contextkit/tools/scripts/project-map.mjs --check
```

A stale map prints the saved and current fingerprints and tells you to
regenerate. Regenerate by running the script with no flags — there is no
`--refresh`:

```shell
node contextkit/tools/scripts/project-map.mjs
```

Then look up a symbol or path directly:

```shell
node contextkit/tools/scripts/project-map.mjs --find resolveSubagentProfile
```

A hit prints one line, `symbol → path`. A miss prints
`no symbol matching "..."` and still exits 0, so check the text, not the exit
code.

For relationships rather than location, use the graph. It answers who calls a
symbol, who breaks if it changes, and what sits nearby, without reading the
files:

```shell
node contextkit/tools/scripts/graph.mjs callers <symbolId>
node contextkit/tools/scripts/graph.mjs impact <symbolId>
node contextkit/tools/scripts/graph.mjs query <substring>
node contextkit/tools/scripts/graph.mjs neighbors <symbolId> --budget 20
```

Subcommands are `callers`, `affected`, `impact`, `neighbors`, `path`,
`god-nodes` and `query`. Start with `query` to get an id, since the other
subcommands want a full node id. With no graph built, the receipt is
`{"available": false}` and the exit code is 3 — distinct from exit 2 for a bad
invocation, so a script can tell "no graph yet" from "wrong arguments" and never
invent an answer.

### 2. Hand a subagent a bounded pack, not your session

A dispatched agent that inherits full session context pays for all of it. Build
a bounded pack instead:

```shell
node contextkit/tools/scripts/context-pack.mjs --for-subagent --objective "your objective"
```

Paste the output into the agent's prompt. The `subagent` profile is capped at 120
lines and rule sections are never trimmed away to fit, so governance survives the
cut while the narrative sections do not.

Confirm the budget the profile actually resolves to:

```shell
node contextkit/tools/scripts/economy/subagent-profile.mjs
```

It prints the resolved profile and budget as JSON, and records that the budget
was applied.

For your own session, the same script without `--for-subagent` returns one
bundle instead of several sequential reads:

```shell
node contextkit/tools/scripts/context-pack.mjs
node contextkit/tools/scripts/context-pack.mjs --json
```

Those three are the only flags. `--profile` does not exist on this script; if you
have seen it cited, it was wrong.

### 3. Resolve the dispatch tier instead of guessing

Do not pick a model by feel, and do not omit the parameter — omitting it inherits
the session default.

```shell
node contextkit/tools/scripts/model-policy.mjs resolve \
  --agent <agent-name> \
  --task <think|execute|ambiguous> \
  --host <claude|codex|agy>
```

The response is structural: the resolved alias, its tier, the rule that applied,
and the reasons. Pass the returned alias through to the dispatch. It expresses no
opinion about one model being better than another, and neither should you when
relaying it. If `model` comes back `null`, no rule matched — say so and dispatch
without an override rather than inventing an alias.

Skip dispatch entirely for anything that is three commands or fewer. Coordination
costs more than the commands.

### 4. Resume from a checkpoint instead of reconstructing

If a previous run was checkpointed, read the brief rather than re-deriving where
things stood:

```shell
node contextkit/tools/scripts/economy/resume-pack.mjs <runId>
```

The brief is capped at 120 lines and carries pointers only — never inlined file
bodies. With no checkpoint for that id you get a `No Checkpoint` brief with the
reason `no-checkpoint`. With no id at all it exits 1 with a usage line.

The checkpoint itself is stamped by the pipeline, not by this script:

```shell
node contextkit/tools/scripts/ship-state.mjs checkpoint --id <runId> --data '<json>'
```

No checkpoint exists until something stamps one, so this lever does nothing on a
project that has never checkpointed a run.

### 5. Run noisy builds and tests through the compact runner

A full test or build log entering the window verbatim is pure waste when the
verdict is what you need.

```shell
node contextkit/tools/scripts/economy/run-compact.mjs --kind test npm test
```

`--kind` accepts `test`, `lint` or `build`, and is auto-detected when omitted.
The runner prints a bounded summary — run id, command, kind, exit code, pass
flag, and test counts when it could parse them — and exits with the wrapped
command's exit code unchanged. Verified: a command exiting 7 makes the wrapper
exit 7.

By default the raw output is not persisted; only `runs/<id>/summary.json` under
the project root is written. Add `--capture-full` when you will need the log:

```shell
node contextkit/tools/scripts/economy/run-compact.mjs --capture-full --kind test npm test
```

That writes `runs/<id>/output.log` and prints its path. `runs/` is gitignored,
the directory is pruned to roughly the twenty newest runs, and every persisted
byte passes through the secret redactor.

### 6. Plan the levers at the start of focused work

Before loading broad context, get the bootstrap's read on which levers apply:

```shell
node contextkit/tools/scripts/economy/dev-start-bootstrap.mjs --objective -- "your objective"
```

It prints one line per lever with `status`, `evaluated`, `recommended` and
`applied`, plus whether the map is stale and whether a resume checkpoint was
found. Add `--json` for the machine-readable form. It is read-only: it does not
regenerate the map, spawn anything, or touch git state.

For a controller-scoped run, check the delegation decision rather than assuming
it:

```shell
node contextkit/tools/scripts/economy/lean-loop-cli.mjs --controller ship --touch path/a,path/b
```

With no controller in context the answer is `delegate: false`. There is no
global delegation default, and this lever cannot change how the host session
itself is driven.

### 7. Compile a work packet for a known symbol

When the target is one symbol you have already located, compile a bounded packet
instead of reading around it:

```shell
node contextkit/tools/scripts/economy/task-compiler.mjs \
  --symbol resolveSubagentProfile --objective "your objective"
```

Use this only on an exact match from step 1. An unknown symbol returns
`{"packet":{"status":"skipped","reason":"..."}}` — a refusal, not a result. The
compiler is read-only: it plans without executing and mutates no source.

## Verify it worked

There is no recorded before-and-after measurement for these levers in this
guide, so treat any savings figure you have not measured yourself as unknown.
Measure it:

```shell
node contextkit/tools/scripts/token-report.mjs
node contextkit/tools/scripts/token-report.mjs --json
```

Accepted flags are `--json`, `--all` and `--from <path>`. In the JSON payload:

- `observedSavings` — observed token deltas per lever, with sample counts. Only
  four levers can appear here: boot-delta, run-compact, project-map and routing.
  A lever absent from this section has not been observed, which is not the same
  as having saved nothing.
- `economyLifecycle` — event counts by stage and by reason, including how often a
  lever was evaluated and skipped.
- `mapEffectiveness` — how many reads occurred and across how many distinct
  files. Falling repeat-reads is the signal that step 1 is working.
- `quota` — host quota. With nothing recorded it reports
  `status: "skipped"`, never zero.

Per-lever spot checks:

- `run-compact` exit code equals the raw command's exit code, and `runs/<id>/`
  contains `summary.json`.
- `project-map.mjs --check` reports the map as current rather than stale.
- `subagent-profile.mjs` returns a numeric budget rather than `null`.

To record host quota when it is visible to you:

```shell
node contextkit/tools/scripts/economics/quota-snapshot.mjs --write
```

Without a resolvable host it prints `quota-snapshot: skipped (host required)` and
exits 0. Missing data is skipped, never a pass.

## Troubleshooting

**Symptom:** `project-map.mjs --find` prints nothing useful and exits 0.
Fix: a miss exits 0 by design. Read the output text. If it says
`no symbol matching`, the symbol is absent from the inventory — regenerate the
map, then fall back to the graph's `query` subcommand for a substring search.

**Symptom:** `graph.mjs` exits 3 with `{"available": false}`.
Fix: no graph projection is built for this project. Exit 3 means "no graph yet",
exit 2 means the invocation was wrong. Fall back to the map for this session
rather than treating the empty receipt as "no callers".

**Symptom:** `graph.mjs callers` returns an empty list for a symbol you know is
called.
Fix: pass a full node id, not a bare name. Get one from
`graph.mjs query <substring>` first — ids look like
`sym:<path>#<symbol>`.

**Symptom:** `context-pack.mjs --profile <name>` seems to be ignored.
Fix: it is. The script has no `--profile` flag; unknown arguments are ignored and
the full pack is printed. Use `--for-subagent --objective "..."` for the bounded
form.

**Symptom:** `run-compact.mjs` reports a failure where you expected a pass.
Fix: the wrapped command's exit code is the only pass/fail signal, never
suppressed and never fabricated. A command that exits non-zero on
warnings-only output fails here too. Re-run with `--capture-full` and read
`runs/<id>/output.log`.

**Symptom:** `run-compact.mjs` prints `log: (summary-only on disk...)` and you
needed the log.
Fix: expected default. Only `--capture-full` persists raw output.

**Symptom:** `resume-pack.mjs` renders `No Checkpoint`.
Fix: nothing stamped a checkpoint for that run id. Stamp one with
`ship-state.mjs checkpoint` during the run; this script only reads.

**Symptom:** `model-policy.mjs resolve` returns `"model": null`.
Fix: no rule matched. Report the reason and dispatch without an override. Do not
substitute an alias by hand.

**Symptom:** A lever appears to do nothing and produces no telemetry.
Fix: check its wiring status before assuming a bug. Several levers are library
only or run only when invoked directly — see
[the economy reference](../reference/economy.md), which marks each one wired,
runnable, or library only.

## Related

- [Reference: economy configuration and levers](../reference/economy.md) — every
  toggle, the script behind it, whether it mutates anything, and its wiring
  status.
- [The three economies](../explanation/the-three-economies.md) — what token, cost
  and autonomy each measure, and the limits on what economy may change.
- [How to start a focused session](start-a-focused-session.md) — where the
  bootstrap in step 6 fits.
- [How to use the knowledge graph](use-the-knowledge-graph.md) — the graph
  surface from step 1 in depth.
