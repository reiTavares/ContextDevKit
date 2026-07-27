# Governance contract reference

<!-- GENRE: Reference (information-oriented) -->

## Synopsis

The per-gate contract for every governance gate this project ships. One table per
gate, with three columns: the input the gate requires, what the gate does when that
input is absent, and what it does in each enforcement mode when the input is present
and the check fails.

```shell
node contextkit/tools/scripts/doctor.mjs        # which gates are wired here
node contextkit/tools/scripts/autonomy.mjs      # the consent dial and its floor
```

For why the modes exist and what a receipt is, see
[governance and enforcement](../explanation/governance-and-enforcement.md).

## Reading the tables

**Required input** is a fact the gate reads from disk, git, the session ledger, or
the hook payload. It is never an assertion made in conversation.

**When the input is absent** is the degrade path. Absent input yields `skipped`,
`unknown`, or a silent allow — never a pass, and never a recorded satisfaction. A
gate that cannot evaluate says so or stays quiet; it does not approve.

**Behaviour by mode** applies only when the input exists and the check fails. `warn`
prints the reason and lets the tool call proceed. `deny` returns a refusal for that
one tool call, with the corrective command named. Gates that carry no mode axis say
so in that column.

Three mode settings exist and are independent. `enforcement.mode` (`advisory` ·
`guarded` · `strict`, falling back to `guarded`) drives the capability, completion,
journey and subagent gates. `domainEngineering` derives its stage from the activation
level (`shadow` · `advisory` · `guarded` · `strict`) and is inert unless
`domainEngineering.enabled` is true. `projectMap.graph.mode` drives the graph-first
gate.

## Capability execution gate

Event `PreToolUse`. Inert below level 5. Governs `Read`, `Grep`, `Glob`, `Edit`,
`Write`, `MultiEdit`, and `Bash` classified by command pattern.

| Required input | When the input is absent | Behaviour by mode |
| --- | --- | --- |
| Task id, from the tool payload or the ledger's active task | Silent allow — the gate is inert for an unregistered task | Identical in all three modes: silent allow |
| Execution contract at `<pipeline>/state/<taskId>/execution-contract.json` | Silent allow, reason code `degrade:no-contract` | Identical in all three modes: silent allow |
| A valid receipt per capability required at the moment | Capability counted `missing`, never satisfied | advisory `warn` · guarded `deny` at write and completion, `warn` at exploration · strict `deny` at every moment |
| Work classification with confidence other than `ask` | `warn`, reason code `degrade:no-signals-work` or `degrade:signals-ask` | Identical in all three modes: `warn` |
| Missing capability is a ceremony capability (`intake-completed`, `adr-required`) | `warn`, reason code `degrade:non-ceremony-cap` | Identical in guarded and strict: `warn`. Only a ceremony capability reaches a block |
| Active workflow on the current branch, for a feature or architectural write | Treated as present when workflows are unreadable, so no false block | advisory `warn` · guarded `deny` at write · strict `deny` |
| Project-map freshness and the broad-search counter | Treated as fresh when unknown | advisory `warn` · guarded `warn` · strict `deny` |

A denial requires all five of: mode `guarded` or `strict`, contract on disk,
evaluation returned deny, a ceremony capability among the missing, and a confident
work classification. Any other combination degrades to `warn` with its reason code.

## Completion evidence gate

Event `Stop`. Inert below level 5. Fires at most once per session, and returns
immediately when the host reports a re-entrant stop.

| Required input | When the input is absent | Behaviour by mode |
| --- | --- | --- |
| Active task id in the session ledger | Silent — no evaluation | Identical in all three modes: silent |
| Execution contract on disk | Silent — no evaluation | Identical in all three modes: silent |
| Non-empty `requiredBeforeCompletion` in the contract | Silent allow | Identical in all three modes: silent allow |
| A valid receipt per required completion capability | Capability counted `missing`; a bypass is reported separately and never counted as satisfied | advisory `warn` · guarded `deny` · strict `deny` |
| Dispatch records matching a required deliberation or specialist | No envelope means the check does not run | advisory `warn` · guarded and strict `deny`, and only when the request was classified a material decision |
| Spawn-completion records for profile-required agents | Check does not run unless `domainEngineering.enabled` | Escalates to `deny` only when the domain stage is `guarded` or `strict`; the capability mode still governs the emitted decision |

One documented escape: when the classified intent is no-code, the domain is general,
and no source write is recorded for that task, completion obligations are cleared. A
real source write for the task revokes the escape and the obligations stand.

## Methodology journey gate

Event `PreToolUse` on `Edit` and `Write`. Inert below level 5. Exempt: anything under
memory or pipeline paths, the changelog, the agent boot files, `.gitignore`,
`.gitattributes`, `package.json`, and any `.md` file.

| Required input | When the input is absent | Behaviour by mode |
| --- | --- | --- |
| A loadable journey map | Silent — degrades and returns | Identical in all modes: silent |
| Active task id and an execution contract carrying work signals | Silent | Identical in all modes: silent |
| A resolvable journey branch for the work | Silent | Identical in all modes: silent |
| Checkpoint `workflowNestedUnderOwner` verified false on disk | Checkpoint stays `pending`; a pending checkpoint never blocks | guarded and strict `deny` · advisory `warn` |
| Checkpoint `adrNumberContiguous` verified false on disk | Checkpoint stays `pending`; never blocks | guarded and strict `deny` · advisory `warn` |
| No covering bypass record for the target path | A covering record stands the gate down | Identical in all modes: silent allow |

Only those two checkpoints are blockable. Checkpoints that read false merely because
the journey has not reached that stage yet — a decision record not yet accepted, an
owner context not yet created — are excluded by design and surfaced as advice.

## Workflow phase mutation guard

Event `PreToolUse` on `Edit`, `Write`, `MultiEdit`. Inert below level 5. Same exempt
path set as the journey gate.

| Required input | When the input is absent | Behaviour by mode |
| --- | --- | --- |
| A workflow on the current branch whose phase precedes `ship` | Unreadable workflows yield no active workflow, so no block | No mode axis. The guard blocks whenever the input is present, in every mode |
| Target path outside the exempt set | Exempt path yields silent allow | No mode axis |

The refusal names the advance command for the blocking workflow. This guard is also
blind to the autonomy grade: no consent setting weakens it.

## Blast-radius gate

Event `PreToolUse` on `Edit`, `Write`, `MultiEdit`. Inert below level 5.

| Required input | When the input is absent | Behaviour by mode |
| --- | --- | --- |
| `l5.highRiskPaths` entries matching the target path | No configured entries means no match and no block | No mode axis. A match with no covering record blocks in every mode |
| A blast-radius record in the session ledger covering the path | Absent record is the blocking condition | No mode axis |
| Committed graph projection, for the consumer count in the message | Line omitted; nothing is fabricated | Message detail only; never changes the decision |

Two ways forward are named in the refusal: run the blast-radius analysis, or record an
explicit bypass whose objective begins with `BYPASS:`. Both are auditable; the second
is a waiver, not a proof.

## Graph-first exploration gate

Events `UserPromptSubmit` (records a human waiver token) and `PreToolUse` on `Grep`
and `Glob`. Allows silently below level 4. Reading one named file is never gated.

| Required input | When the input is absent | Behaviour by mode |
| --- | --- | --- |
| `projectMap.graph.mode` set to `guarded` or `strict` | Allow, silent | `off`, `shadow`, `advisory` allow silently · `guarded` and `strict` may block |
| A readable committed graph projection | Allow plus a visible warning that the graph could not answer — explicitly not a pass | Identical in all modes: allow with warning |
| A literal search term in the tool payload | Returns without evaluating | Identical in all modes: silent |
| Graph nodes matching the term | A miss allows the search and states the miss out loud | `guarded` and `strict` `deny`, with the graph's own answer inlined |
| Projection age within `projectMap.graph.maxAgeMinutes` (default 60) | A stale miss triggers one bounded rebuild, then a single re-query | Same in every blocking mode; the rebuild never recurses |
| Absence of a waiver token in the human's prompt | A recorded waiver allows for the session | Identical in all modes: allow, waiver noted |

The waiver is recorded only from the human's prompt text. The agent cannot set it.

## Subagent scope gate

Events `PreToolUse` on `Task` (records the spawn; never blocks) and `SubagentStop`
(compares observed writes against the declared touch set). Inert below level 5.

| Required input | When the input is absent | Behaviour by mode |
| --- | --- | --- |
| Execution contract for the parent task | Silent | Identical in all modes: silent |
| A spawn record for the completing subagent | Silent | Identical in all modes: silent |
| Observed touched paths in the ledger | Allow, treated as unobservable — never escalated to a warning | Identical in all modes: allow |
| Observed paths within the declared set and outside the forbidden set | Violation is the blocking condition | advisory `warn` · guarded and strict `deny` at `SubagentStop` |

## Domain code gate

Event `PreToolUse` on `Edit`, `Write`, `MultiEdit`, `NotebookEdit`. Inert below level
4, and inert entirely unless `domainEngineering.enabled` is true, which is not the
shipped default.

| Required input | When the input is absent | Behaviour by mode |
| --- | --- | --- |
| `domainEngineering.enabled` true | Stage resolves to `shadow`; nothing is emitted | `shadow` silent · `advisory` `warn` · `guarded` `deny` for medium and high risk bands, `warn` for low · `strict` `deny` |
| Implementation block and policy table | Verdict is `DEGRADED` with `ALLOW` and a recorded reason code — never a pass, never an arbitrary block | Identical in all stages: allow with a degraded receipt |
| Path classification of the write target | Hard-excluded paths are not gated | Stage table above |
| Implementation packet, blast-radius receipt, bound owner, dispatched required agents | Missing requirement is the failing condition | Stage table above. A predictive, non-deterministic uncertainty never auto-blocks; at most it asks once, ceiling `guarded` |
| `domainEngineering.enforcement.rolloutStage` | Unset or unrecognised means no ceiling; the level ladder applies | The ceiling can only lower the level-derived stage, never raise it |

A real write to a non-excluded source path forces the code-mutation signal to its
maximum, so a low textual score cannot let a genuine source write past the gate.

## Domain conformance reconciler

Event `PostToolUse`. Inert below level 4 and unless `domainEngineering.enabled`.

| Required input | When the input is absent | Behaviour by mode |
| --- | --- | --- |
| Governing implementation packet with a declared touch set | Silent — nothing to reconcile | `shadow` silent; all other stages advisory |
| Resolved real path of the completed write | Silent | Advisory only |
| Severity of the reconciled deviation | Nothing recorded | Low and medium record the deviation; high warns and arms a next-write block in the domain code gate |

This event fires after the write has already happened, so it can never block that
write in any stage. The block it arms belongs to the `PreToolUse` gate.

## Concurrency guard

Event `PreToolUse`. Inert below level 3.

| Required input | When the input is absent | Behaviour by mode |
| --- | --- | --- |
| Other sessions' ledgers, with heartbeat and start time | Advisory only; no denial is derived | No mode axis. Advisory by default |
| A conflicting session that is active within the hour and started earlier | Without seniority the result is a warning, not a denial | No mode axis. Seniority denies with a non-zero exit |
| `CONTEXT_ALLOW_CLAIMED_EDIT` unset | Set to `1`, every denial is demoted to advisory and the demotion is written to stderr | No mode axis |

This is the one gate hook that exits non-zero, and the override is audited rather
than silent.

## Session registration gate

Event `Stop`. Inert below level 2.

| Required input | When the input is absent | Behaviour by mode |
| --- | --- | --- |
| At least two important paths touched and unregistered in the ledger | Silent | No mode axis |
| Session not already registered | Silent | No mode axis |
| No prior nudge stamped this session | Silent — fires at most once | No mode axis |
| Host does not report a re-entrant stop | Silent | No mode axis |

## Architecture debt gate

A CI script rather than a hook: `node contextkit/tools/scripts/architecture-debt-gate.mjs --ci`.

| Required input | When the input is absent | Behaviour by mode |
| --- | --- | --- |
| Changed-file set from `git diff --name-only HEAD` | Empty set means scope narrowing is inactive; nothing is demoted and nothing is approved on that basis | No mode axis. Without `--ci` the process always exits 0; with `--ci` any non-approving outcome exits 1 |
| Declared layer rules, state ownership and write authorities | The three conformance rules are forced `DISABLED` and dropped rather than passed | Same in every configuration |
| Graph projection, when conformance is configured | Outcome `UNKNOWN`, which is not an approving outcome and fails `--ci` | Same in every configuration |
| Floor evidence for security, reliability and testability | Missing test-impact evidence yields a `REVIEW_REQUIRED` finding with status `UNKNOWN`, never a pass | Same in every configuration |

Approving outcomes are `PASS`, `PASS_WITH_OBSERVATION`, `DEBT_REDUCED` and
`DEBT_ACCEPTED`. `REVIEW_REQUIRED`, `REMEDIATION_REQUIRED`, `BLOCKED`, `UNKNOWN` and
`SKIPPED` all fail the CI check. Details of the dimensions and floors are in the
[quality model](../explanation/quality-model.md).

## Git-hook gates

| Gate | Required input | When the input is absent | Behaviour by mode |
| --- | --- | --- | --- |
| Commit message | A conventional-commit subject line | A commit with no message cannot proceed | No mode axis. Non-conforming message exits non-zero |
| Pre-commit quality gates | The configured runners | A runner that cannot execute is reported, not counted as passed | No mode axis |
| Pre-push | Remote comparison state | Unavailable comparison degrades to advisory | No mode axis |
| Workflow invariant | Workflow state files | Unreadable state yields no block | Exits non-zero only when its own mode is `guarded` |

## Receipt validity

A stored receipt satisfies a gate only when every condition holds.

| Condition | Value required |
| --- | --- |
| `result` | `passed` |
| `expiresAt` | Not yet reached; default lifetime 24 hours |
| `scope.branch` | Equal to the current branch |
| `taskId` | Equal to the current task |
| `fingerprint` | Equal to a fresh hash of the current scope |

The full result vocabulary is `passed`, `failed`, `skipped`, `unknown`,
`not-applicable`, `blocked`, `bypassed`, `stale`, `insufficient-data`. Only `passed`
satisfies a gate. A bypass is reported in its own list, separate from satisfied
capabilities, and a bypass whose recorded actor is automation is invalid for any
capability that requires human approval.

## Degrade reason codes

Emitted by the capability gate's block authority, in evaluation order.

| Reason code | Meaning |
| --- | --- |
| `degrade:null-context` | No evaluable context was supplied |
| `degrade:advisory-mode` | Mode is `advisory`, which never denies |
| `degrade:no-contract` | No execution contract on disk |
| `degrade:non-deny` | The evaluation did not return a denial |
| `degrade:non-ceremony-cap` | The missing capability is not a ceremony capability |
| `degrade:no-signals-work` | Work classification was not computed |
| `degrade:signals-ask` | Work classification confidence is `ask` |
| `degrade:registry-fail` | The policy registry failed to load |
| `degrade:unregistered-task` | The task is not registered |
| `block:ceremony-gate` | All five blocking conditions held |

## Decision and exit conventions

Hooks express a refusal as JSON on stdout and still exit 0. The decision key is
host-specific: `block` on Claude Code and Codex, `deny` on Antigravity. Advisory
output is bare stdout on Claude Code, a structured additional-context payload on
Codex, and an explicit allow carrying the reason on Antigravity.

Every gate hook ends by exiting 0 on any uncaught error. The exceptions to the
exit-0 rule are the concurrency guard, the git hooks, and the CI scripts. Because a
hook can be defeated by making it throw, hooks are governance and not a security
control.

Those three are the hosts that receive enforcement. The other supported tools receive
the context layer only and carry no gates; see [hosts](./hosts.md).

## Name collision

This page documents the gates. A separate JSON artifact named
`governance-contract.json` is written per work context and carries something else
entirely: a read-only projection of that context's resolved ceremony shape, for a
runtime other than the three native hosts to read without re-running the classifier.
It is never an enforcement point, and a reader must treat an absent or stale
projection as `skipped`, never as a failure and never as a pass.

## See also

- [Governance and enforcement](../explanation/governance-and-enforcement.md) — the reasoning behind these tables.
- [Quality model](../explanation/quality-model.md) — how the debt gate adjudicates.
- [Configuration](./config.md) — the keys named on this page and their defaults.
- [Levels](./levels.md) — which gates are wired at which activation level.
- [Hosts](./hosts.md) — which hosts enforce and which only receive context.
- [Troubleshoot an install](../how-to/troubleshoot.md) — resolving a specific block.
