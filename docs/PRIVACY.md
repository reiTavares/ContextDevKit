# Reference: privacy and recorded data

What the kit records about your work, where each artifact lives, what leaves the
machine, and how data is removed. This page describes mechanisms and their limits.
It makes no conformity claim: whether this posture satisfies a given regulation is
a determination for the controller of the data — you or your organisation — not
something a tool can certify.

Companion pages: [reference/footprint.md](reference/footprint.md) for the file
inventory, [reference/data-posture.md](reference/data-posture.md) for the per-hook
read, write and network table.

## What leaves the machine

Nothing is sent to the project's authors. There is no telemetry endpoint, no
license check and no usage beacon in any code path.

Two network calls are active on a stock install, and both go to **your own**
configured git remote: the session-start divergence check and the pre-push
conflict pre-check each run `git fetch`. They carry git protocol traffic only, and
they carry it to a host you chose.

Everything else that touches the network is opt-in and enumerated in the
data-posture page: the npm registry (dependency staleness, MCP discovery), an MCP
server you enabled, GitHub through your own authenticated CLI, and the media
generation provider when you supply a key. The one that matters most for privacy is
MCP: enabling a server hands a third-party process access to your repository
through your host, and the kit verifies no signature or artifact hash for it.

## Artifacts recorded in your repository

### Durable memory

Written under `contextkit/memory/`, by explicit commands rather than
automatically, and **trackable by default** — the installer deliberately leaves
this tree out of its exclude block so a teammate's clone carries the project's
memory.

| Artifact | Path | Contents |
|---|---|---|
| Decision records | `decisions/**` | Free prose: context, decision, consequences. Written by `/new-adr`. |
| Session records | `sessions/**` | Free prose, one file per session: date, branch, **the request as it was made**, what was done, files touched, findings. Written by `/log-session`. |
| Work contexts | `business/**`, `operations/**`, `workflows/**` | Objectives, requirements, specifications, per-workflow reports. |
| Deliberations | `deliberations/**` | Multi-voice debate transcripts and the synthesis. |
| Glossary | `GLOSSARY.md` | Domain term to code identifier mapping. |
| Roadmap | `roadmap.md` | Planned work. |
| Registries and indices | `*-registry.json`, `SESSIONS.md`, `WORKSPACE.md`, `DELIBERATIONS.md`, `project-map/` | Derived from the above; ignored by the committed `.gitignore` because they are regenerable. |

Session records are the artifact most likely to contain personal data, because they
quote the request verbatim and summarise a conversation. If a prompt contained a
customer name, a ticket body, a log excerpt or a credential, the session record can
carry it into a file that is trackable by default.

### Per-session edit ledger

| Artifact | Path | Contents | Tracked |
|---|---|---|---|
| Session ledger | `.claude/.sessions/<sessionId>.json` | Session id, start time, an ordered list of every edited path with the tool used and a timestamp, registration state, simulation records, active task id | Ignored |
| Pointer and markers | `.claude/.sessions/.last-touched`, `.engine-seen`, `.distill-nudge`, `.advisor-nudge` | Session id, timestamps, engine version | Ignored |
| Claim records | `.claude/.workspace/<sessionId>.json` | Which session is working on which paths, for cross-session conflict warnings | Ignored |

The ledger is a record of your activity: which files you touched, in what order, at
what time. It is written by the `PostToolUse` hook on every edit at level 2 and
above. Codex writes the same shapes under `.codex/.sessions/` and
`.codex/.workspace/`.

### Task and execution state

| Artifact | Path | Contents | Tracked |
|---|---|---|---|
| Execution contract | `contextkit/pipeline/state/<taskId>/execution-contract.json` | Task id, session id, branch, host, classification signals and the classifier's reason strings, required-evidence lists, timestamps, history | Ignored |
| Receipts | `contextkit/pipeline/state/<taskId>/receipts/<capability>.json` | Which capability was satisfied, the result from a fixed taxonomy, when | Ignored |
| Compaction continuity | `contextkit/pipeline/state/<taskId>/compaction.json` | Outstanding obligations and a metadata summary, no transcript content | Ignored |
| Subagent spawn records | `contextkit/pipeline/state/<taskId>/` | Which subagent was spawned, with what scope | Ignored |

The prompt-classification hook receives your prompt text. Inspecting a stored
contract on disk, no field carried the prompt itself — the persisted output is the
verdict. The limit: the classifier's `reasons` strings and any derived path list are
generated from your prompt, so a specific prompt is partially inferable from them.

### Local telemetry

Append-only JSON Lines files under `contextkit/memory/`. All are local; none is
transmitted.

| File | Written by | Contents |
|---|---|---|
| `routing-decisions.jsonl` | Prompt hook, execution gate | Routing and gate decisions, reason codes |
| `lang-classifier-telemetry.jsonl` | Completion gate | Detected language, confidence, verdict, whether a write happened |
| `economy-events.jsonl`, `economy-savings.jsonl` | Economy scripts | Token and timing aggregates |
| `autonomy-audit.jsonl` | Autonomy commands | Consent grade changes |
| `quota-snapshots.jsonl` | Quota snapshot command | Host quota figures you recorded |
| `playbook-runs.md` | Playbook runner | When a playbook ran, with an optional note |
| Findings files | `/tech-debt-sweep`, `/deps-audit`, `/deep-analysis`, `/gh-alerts` | Scan results, including file paths and excerpts |

Three of these are ignored by the committed `.gitignore`
(`tech-debt-findings.json`, `deps-findings.json`, `deep-analysis-findings.json`).
The JSON Lines files above and `gh-alerts-findings.json` are **not** in either
ignore mechanism when memory is trackable, so they can be committed by a
`git add -A`.

The economics modules define a privacy posture with `metadataOnly: true`,
`optOut: false` and `retentionDays: 90`. Two limits, both verified in the code:
aggregate reports read metadata rather than transcript content, and the guard
function for content access exists — but **the `optOut` key has no consumer
outside its own default table and schema**, so setting it does not currently
suppress the appenders above. Treat those files as written unconditionally.

### Token report input

`/token-report` reads your host's own transcript files from
`~/.claude/projects/**/*.jsonl` to aggregate token counts. It reads them in place
and writes no copy of their content into the project. Those transcripts are written
by the host, not by the kit, and they contain your conversations.

### Dashboard and snapshots

| Artifact | Path | Tracked |
|---|---|---|
| Dashboard snapshot | `dashboard.html` at the repository root | **Neither ignored nor excluded** |
| Project snapshot | `.context-snapshot.md` | Ignored |
| Proposals | `.distillation-proposal.md`, `.agent-tuning-proposal.md` | Ignored |
| Governance digest | `_contextkit/governance-digest.{json,md}` | Ignored |

`dashboard.html` is a self-contained HTML file that renders your pipeline, decision
records, sessions, roadmap and changelog — so it embeds excerpts of all of them,
including session titles. It is the one artifact that aggregates everything into a
single shareable file, and it is the one artifact that neither ignore mechanism
covers. Check before you commit it, and check again before you attach it anywhere.

`/dashboard --watch` serves the same content from a listener bound to `127.0.0.1`
only. It applies no authentication, which is sound for a loopback-only bind and
stops being sound the moment you forward the port or run it inside a shared
container.

## Files written outside the repository

`--update` copies your critical state to
`~/.contextdevkit/projects/<projectId>/backups/<updateId>/` before mutating
anything, verifying each copy by hash. That includes **every file under
`.claude/.sessions/` and `.claude/.workspace/`** — so your edit history and claim
records are duplicated into your home directory on each update.

No pruning or age limit is applied. Each update adds a directory and none are
removed. `<projectId>` is a truncated hash of the project path, so the directory
name does not disclose the path itself, but the contents do.

## The public repository warning

The default posture keeps the install machinery out of git through a per-clone
exclude while leaving `contextkit/memory/` trackable. `--tracked` skips the exclude
block entirely, so every kit artifact becomes an ordinary untracked file that a
`git add -A` will stage.

**If you run `--tracked`, or simply commit the memory tree, on a repository that is
public or that will become public, then the following becomes publicly readable and
permanently present in the history:**

- **Request text.** Session records quote the request as it was made, in whatever
  language and with whatever detail it contained.
- **Code excerpts.** Findings files, decision records and workflow reports quote
  source, diffs and error output.
- **Session and workflow names.** Titles are descriptive by design and can name a
  client, a product that has not launched, or an incident.
- **Author identity.** Git attributes every commit to your configured
  `user.name` and `user.email`. The `pre-commit` hook regenerates the memory
  indices and pipeline board and stages them into the commit you are making, so
  those artifacts are attributed to you by the same mechanism as any other commit.
- **Working patterns.** If ledger or telemetry files are committed, they expose
  timestamps, per-file edit sequences and how work was spread across hours.
- **Decision history.** Rejected approaches, recorded dissent and the reasoning
  behind a design, which is often the most commercially sensitive prose in a
  repository.

Rewriting history to remove any of this after a push is expensive and unreliable —
forks, caches and clones persist. Decide the posture before the first push, not
after.

If you want the memory record shared with your team but never public, the
mechanism is a second remote: keep the public repository as it is and push the
memory tree to a private one. If you want it local only, run the installer without
`--tracked` and add `contextkit/memory/` to your own `.gitignore`.

## Removal, by mechanism

There is no retention seal here, only the operations that actually exist.

### Uninstall

`--uninstall` unwires the hooks and removes the three git hooks. `--purge`
additionally deletes the engine, tooling and host front-ends. **Both deliberately
keep `contextkit/memory/`, `CLAUDE.md` and `AGENTS.md`.** Neither touches
`.claude/.sessions/`, `.claude/.workspace/`, `contextkit/pipeline/state/`,
`dashboard.html` or anything under `~/.contextdevkit/`. The full list of what
survives, and the gaps in the removal path, is in
[reference/footprint.md](reference/footprint.md).

### Deleting recorded data

Every artifact on this page is a plain file. Deletion is a filesystem operation you
perform:

```shell
rm -rf .claude/.sessions .claude/.workspace        # edit ledger and claim records
rm -rf contextkit/pipeline/state                   # contracts, receipts, continuity
rm -f  contextkit/memory/*.jsonl                   # local telemetry
rm -f  dashboard.html .context-snapshot.md         # aggregated snapshots
rm -rf ~/.contextdevkit                            # out-of-repo backups
```

The memory tree is intentionally not in that list — it is the project's
documentation, and deleting it is a decision about your records, not cleanup.

If an artifact has already been committed, deleting the file does not remove it
from history. That requires a history rewrite and a force push, coordinated with
everyone who has a clone.

### The retention window

The economics modules implement retention as pure functions — a per-record window
check against `retentionDays` (default 90), a purge that filters expired records, a
dry-run preview, and a cascade across derived artifacts. Records with a missing or
unparseable timestamp are treated as expired, which is a deliberate fail-closed
choice.

**The limit, verified in the code: no command, hook or scheduled task calls those
functions.** They are available to a caller that does not yet exist. Nothing
expires on its own today, and the `retentionDays` default describes an intended
window rather than an enforced one. Until a caller is wired, retention is the manual
deletion above.

### Regeneration

Most derived artifacts rebuild from the durable record: the memory indices, the
registries, the project map, the governance digest, the dashboard and the project
snapshot. Deleting them costs a regeneration, not data.

## What this page is not

It is not a compliance statement, and the kit ships no compliance badge. The
mechanisms are described so that you can assess them against the obligations that
apply to you. Two points that assessment usually turns on:

- The artifacts here are recorded on your machine, in your repository, under your
  git identity and your remote. The kit's authors receive nothing and therefore
  cannot delete, export or produce anything on your behalf.
- Personal data enters these artifacts through your prompts and your code, not
  through a collection decision the kit makes. Whether a session record containing
  a customer's name is lawful to store, and for how long, is a question about your
  processing, answerable only by your controller.

For work involving personal data of Brazilian residents, the kit ships a specialist
agent (`privacy-lgpd`) that reviews a change against the relevant obligations. It
produces analysis and recommendations. It does not, and cannot, certify a result.

## See also

- [reference/footprint.md](reference/footprint.md) — file inventory, tracked and
  untracked, and the removal path.
- [reference/data-posture.md](reference/data-posture.md) — per-hook reads, writes
  and network calls; why hooks are not a security control.
- [../SECURITY.md](../SECURITY.md) — reporting a vulnerability.
