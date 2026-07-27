# Reference: economy configuration and levers

<!-- GENRE: Reference (information-oriented) — dry, complete, no narrative. -->

## Synopsis

The `economy` block in `contextkit/config.json` governs the token-economy
levers: a master switch, a mode, and one toggle per lever. Every lever is
advisory and fail-open — a lever that cannot evaluate returns unchanged input
rather than blocking work.

```json
{
  "economy": {
    "enabled": true,
    "mode": "advisory",
    "outputContract":  { "enabled": true },
    "findings":        { "enabled": true },
    "agentContract":   { "enabled": true },
    "compaction":      { "enabled": true },
    "contextProfiles": { "enabled": true },
    "bootDelta":       { "enabled": true },
    "resumePack":      { "enabled": true },
    "leanLoop":        { "enabled": true },
    "loopBreaker":     { "enabled": true },
    "patchEconomy":    { "enabled": true },
    "measurement":     { "enabled": true }
  }
}
```

The canonical lever list lives in
`contextkit/tools/scripts/economy/economy-defaults.mjs`
(`ECONOMY_MODULE_KEYS`); the default layer is `FLAG_DEFAULTS` in
`economy-governance-core.mjs`. Both the optional strict validator
(`contextkit/runtime/config/schema-economy.mjs`) and the runtime resolver build
their surface from that one list.

## Top-level fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Master switch. `false` makes every lever return unchanged input. |
| `mode` | `"advisory"` \| `"blocking"` | `"advisory"` | Nominal escalation mode. See the note below: no shipped call site reads a non-advisory value. |
| `<lever>.enabled` | boolean | `true` | Per-lever toggle. One key per lever in the table below. |
| `autoActivate` | boolean | `true` | Emit the economy guidance block in the session-start banner. Read by `economy-session-activation.mjs`. |
| `tools.find` | boolean | `true` | Consulted by the `/dev-start` bootstrap when deciding whether to recommend the structural map lookup. |
| `tools.runCompact` | boolean | `true` | Consulted by the `/dev-start` bootstrap when recommending the compact runner. |
| `sessionAutonomyReceipt` | object | see below | Per-session receipt generation (token, autonomy, cost). Consumed by `contextkit/tools/scripts/economics/session-autonomy/`. |

`mode` is currently inert. The two levers that could escalate — `loopBreaker`
and `patchEconomy` — are invoked from `economy/gate-advisory.mjs` with the
literal `'advisory'`, so raising `mode` to `"blocking"` changes no behaviour in
the shipped call path. Their library layers do implement a strict branch; it has
no caller. Documented here rather than left to be discovered.

`tools` also accepts `workPacket`, `subagentProfile` and `loopBreaker` keys.
They are present in the default config and pass validation, but no shipped
consumer reads them: they are declared surface, not wired behaviour.

## Per-lever reference

Status vocabulary used below:

- **wired** — a runtime hook or a shipped command invokes it during normal work.
- **runnable** — it has a CLI, and fires only when a human or agent runs it.
- **library only** — importable and self-checked, but no shipped consumer
  outside its own directory. Not exercised by normal work.

| Toggle | Script | Mutates | Status |
|--------|--------|---------|--------|
| `outputContract` | `economy/output-contract.mjs` | no | library only |
| `findings` | `economy/findings.mjs`, `economy/findings-merge.mjs` | no | library only |
| `agentContract` | `economy/agent-contract.mjs`, `economy/agent-contract-drift.mjs` | no | library only |
| `compaction` | `economy/run-compact.mjs` | yes — `runs/<id>/` | runnable |
| `contextProfiles` | `economy/context-profiles.mjs` | no | library only, via callers |
| `bootDelta` | `economy/boot-delta-gate.mjs`, `economy/boot-delta.mjs` | yes — boot snapshot | wired |
| `resumePack` | `economy/resume-pack.mjs` | no (telemetry row only) | runnable |
| `leanLoop` | `economy/lean-loop-cli.mjs`, `economy/lean-loop.mjs` | no (telemetry row only) | runnable |
| `loopBreaker` | `economy/loop-breaker.mjs` | no (telemetry row only) | wired, advisory |
| `patchEconomy` | `economy/patch-economy.mjs` | no | wired, no telemetry |
| `measurement` | `economy/economy-governance.mjs` | no | split: see below |

All paths are relative to `contextkit/tools/scripts/`.

### outputContract

Resolves the output contract a worker should honour: write to an artifact first,
do not echo raw tool output, a soft response ceiling, and per-severity finding
caps. Defaults come from `ECONOMY_DEFAULTS` in `economy-defaults.mjs`; config
and a per-agent override deep-merge over them.

Critical and high findings are permanently uncapped. An override attempting to
cap them raises a contract-floor violation rather than silently truncating
evidence — the one intentional throw in an otherwise fail-open module.

Pure resolver; touches no disk. No consumer outside the economy directory and no
telemetry rows, so its effect on real sessions is currently zero.

### findings

Owns the canonical finding schema — id, severity, path, line, claim, evidence,
action, confidence, status, agent — plus validation, fingerprinting for
deduplication, and the merge pipeline in `findings-merge.mjs`.

Enforces the evidence-required invariant: a critical or high finding without
verbatim evidence is invalid and does not enter the merge. Read-only and pure.
Library only; no shipped consumer, no telemetry rows.

### agentContract

Owns the single canonical `## Output Contract` markdown block for the QA squad
agents, and audits which per-host agent files diverge from it or omit it.

The audit reads files and reports; injection into agent files is not
implemented, so nothing is written. Unreadable files report as skipped, never as
a pass. Library only; no telemetry rows.

### compaction

The compact command runner. Spawns a command, streams its output, and returns a
bounded summary so a noisy log does not enter the context window verbatim.

```shell
node contextkit/tools/scripts/economy/run-compact.mjs [--kind test|lint|build] [--capture-full] <command...>
```

Mutates disk: writes `runs/<id>/summary.json` under the project root, prunes to
roughly the twenty newest run directories, and passes every persisted byte
through the secret redactor. Without `--capture-full` the raw output is not
persisted; with it, the full log lands at `runs/<id>/output.log`. `runs/` is
gitignored.

The spawned command's exit code is the only pass/fail signal — never suppressed,
never fabricated. Writes observed rows to the savings ledger. Wired in the sense
that controllers and agents call it; it is not invoked by a hook.

### contextProfiles

The profile engine that trims a context pack to a line budget. Named budgets
are declared in `PROFILE_BUDGETS`: `state`, `dev-start`, `ship`, `review`, and
`subagent`, the last capped at 120 lines.

Invariants: rule sections are never dropped even when over budget; an unknown
profile name returns the section list unchanged; the trim order is session, then
changelog, then narrative, with rules last and never cut.

Purely functional, writes nothing, and has no CLI of its own. Its runnable
surface is `economy/subagent-profile.mjs`, which resolves the `subagent` budget
and records that it was applied; `dev-start-economy-core.mjs` and `boot-delta.mjs`
are the other callers. Note that `context-pack.mjs` has no `--profile` flag —
its flags are `--json` and `--for-subagent --objective "..."`.

### bootDelta

Suppresses informational boot-banner sections whose content has not changed
since the previous session, so identical context is not re-sent every boot.

Gateable fields are enumerated in `GATEABLE_BOOT_FIELDS` — the last-session
digest, the unreleased changelog block, workspace claims, other active branches,
and similar. Mandatory governance rules, the drift warning, and time-sensitive
nudges are never gated.

Mutates disk: a `{ key → contentHash }` snapshot under the session directory
(`.boot-snapshot.json`, gitignored, per-worktree). Fail-open in the safe
direction — a missing or unreadable snapshot means every section is treated as
changed and the full boot renders. Wired into the session-start hook, and the
only lever that fires without anyone asking. Writes observed rows to the savings
ledger.

### resumePack

Reads the `resume` stamp on a pipeline run and renders a bounded brief — at most
120 lines, pointers only, never inlined file bodies — so an interrupted session
reconstructs intent in one read.

```shell
node contextkit/tools/scripts/economy/resume-pack.mjs <runId>
```

The stamp is written by the `checkpoint` verb on `ship-state.mjs`, not by this
script. With no argument it exits 1 with a usage line. With an id that has no
checkpoint it renders a "No Checkpoint" brief and the reason `no-checkpoint`.
Writes nothing but a lifecycle telemetry row, and only when a pack was actually
rendered. No telemetry rows recorded in this repository, meaning it has not yet
fired here.

### leanLoop

Reports whether a controller should delegate work to a worker.

```shell
node contextkit/tools/scripts/economy/lean-loop-cli.mjs [--controller <name>] [--touch <a,b,c>]
```

Controller-scoped by construction: with no controller in context the decision is
`delegate: false`, and the seam reports `phase2GlobalDefault: false` — there is
no global delegation default. The host main loop is not controllable from here,
so this lever inspects and recommends; it never changes how the session itself
is driven. Writes nothing but a telemetry row.

### loopBreaker

Detects no-progress repetition — the same file written repeatedly within a
session — from the session ledger's modification trail, and surfaces a nudge to
try a different approach.

Reached through `economy/gate-advisory.mjs` from the execution-gate hook, which
writes the text to stderr as a warning. It does not feed the gate's deny path.
Escalation is always false: the call site passes `'advisory'` literally,
independent of `economy.mode`. The signal is modest by design — richer command
and error history is not captured, and the modification trail is the only honest
source available. Writes a telemetry row when it fires.

### patchEconomy

On a `Write` to an existing file, compares existing bytes against new content
and suggests a targeted edit when a patch would transmit only the changed lines
instead of the whole file twice.

Also reached through `gate-advisory.mjs`, also hardcoded to `'advisory'`, also
stderr-only and never a deny. It emits no telemetry at all: unlike the
loop-breaker branch, its call site records no event, so whether it has ever
fired in a given project is not observable from the ledgers. Treat its adoption
as unmeasured, not as zero.

### measurement

Two halves with different statuses.

`resolveEconomyFlags` and `rolloutGate` — flag resolution and the per-lever
advisory gate — are imported by `gate-advisory.mjs` and `boot-delta-gate.mjs`
and therefore run on every gated tool call and every boot. That half is wired.

`measureBeforeAfter` and `loadUsageWindow` — the before/after delta computation
and the usage-window reader — have no caller outside the economy directory. That
half is library only. `measureBeforeAfter` never fabricates a delta: absent one
side of the comparison, it reports the absence.

## Telemetry and ledgers

Two append-only JSONL ledgers under `contextkit/memory/`, both gitignored:

| File | Contents |
|------|----------|
| `economy-savings.jsonl` | Observed token deltas. Accepts four levers only: `boot-delta`, `run-compact`, `project-map`, `routing`. |
| `economy-events.jsonl` | Lifecycle and advisory events for every registered resource. |

`economy/registry.mjs` assigns each resource one honesty category. `lever` means
an observable token delta exists and may reach the savings ledger — only the
four above qualify. `advisory` means it produces a recommendation and reports
adoption, never an invented saving. `lifecycle` means it fires but has no
measurable delta.

A savings record carries no causal claim field. It states that a lever fired and
how many tokens were observed as avoided at that moment; it does not assert what
the same work would have cost with no platform installed. `savedTokens` and
`estimatedTokens` are never summed together.

Every write path is best-effort: `economy/telemetry-emit.mjs` returns the
recorder result, a skipped marker, or null, and never throws. An unknown
resource id is skipped rather than recorded under a guessed name.

## Reading the numbers

```shell
node contextkit/tools/scripts/token-report.mjs          # human report
node contextkit/tools/scripts/token-report.mjs --json    # machine-readable
```

Accepted flags: `--json`, `--all` (across projects), `--from <path>`. The JSON
payload includes `totals`, `weeks`, `attribution`, `observedSavings` (per-lever
observed totals and sample counts), `economyLifecycle` (event counts by stage
and reason), `mapEffectiveness`, `routingTelemetry`, `financial`, and `quota`.

Host quota data is not derivable from transcripts. With no snapshot recorded,
`quota` reports `status: "skipped"` with the reason `no quota snapshots`. To
record one when host quota is visible:

```shell
node contextkit/tools/scripts/economics/quota-snapshot.mjs --write
```

Without a resolvable host it prints `quota-snapshot: skipped (host required)`
and exits 0. A skipped section is never counted as a pass.

The `financial` section reports currency, per-model confidence, and the count of
unpriced models. Prices and model entries live in the generated pricing data
under `contextkit/tools/scripts/economics/pricing/` with a timestamp; changing a
price or adding a model requires a recorded decision, and automation may only
refresh the date. On a subscription host the payload states that the marginal
money cost is near zero until a quota wall, so the figure is an estimated
API-equivalent rather than a bill.

## Error and refusal conditions

| Condition | Behaviour |
|-----------|-----------|
| `economy.enabled: false` | Every lever returns unchanged input; the guidance block is suppressed. |
| A lever throws internally | Caught; the caller receives unchanged input. Tool calls and boot are never broken. |
| Boot snapshot missing or unreadable | All sections treated as changed; full boot renders. |
| Override caps critical or high findings | Contract-floor violation raised; the override is refused. |
| Unknown resource id passed to the telemetry seam | Skipped marker returned; nothing written. |
| No checkpoint for the given run id | `no-checkpoint` brief; exit 0. Missing run id exits 1 with a usage line. |
| No quota snapshot | `quota` reports `skipped` with a reason, never zero. |
| Compact runner cannot persist an artifact | Swallowed; the command result is still returned and the exit code is preserved. |

## See also

- [How to reduce token cost](../how-to/reduce-token-cost.md) — these levers in
  order of effect, as a task.
- [The three economies](../explanation/the-three-economies.md) — what token,
  cost and autonomy each measure, and the limits on what economy may change.
- [Reference: configuration](./config.md) — the rest of `contextkit/config.json`.
