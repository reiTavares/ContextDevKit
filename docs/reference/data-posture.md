# Reference: data posture

What each hook reads, what it writes, and whether it causes anything to leave the
machine. Companion to [footprint.md](./footprint.md), which lists the files the
installer creates.

Two statements govern the rest of this page, and both have a stated limit:

- **The kit operates no endpoint.** There is no telemetry service, no license
  check, no usage beacon, and no address belonging to the project's authors in any
  code path. Verified by searching the whole runtime and script surface for network
  primitives; the results are enumerated under
  [Network calls](#network-calls-and-what-triggers-them). The limit: the boot hook
  and the pre-push hook do run `git fetch` against **your own** configured remote,
  and several opt-in commands call third parties.
- **Hooks are governance, not a security control.** They fail open by design. See
  [Why hooks are not a security control](#why-hooks-are-not-a-security-control).

## Reading the tables

| Column | Meaning |
|---|---|
| Event | The host lifecycle event the script is wired to. |
| Reads | Files and process state the script inspects. |
| Writes | Files the script creates or updates. |
| Egress | `none` means no socket is opened by this script. Anything else names the destination. |

Paths are project-relative unless prefixed with `~`. "Ledger" means
`.claude/.sessions/<sessionId>.json` plus its `.last-touched` pointer.

## Host hooks

| Script | Event | Reads | Writes | Egress |
|---|---|---|---|---|
| `session-start.mjs` | `SessionStart` | `contextkit/config.json`, memory indices and the latest session digest, workflow and pipeline state, all session ledgers, squad and routing policy, `.engine-version` | Ledger, `.claude/.sessions/.engine-seen` | **`git fetch origin --quiet`** to your configured remote (5 s cap); other git reads are local |
| `compaction-continuity.mjs` | `PreCompact`, `SessionStart` | Ledger, the task's execution contract | `contextkit/pipeline/state/<taskId>/compaction.json` (obligation metadata, no transcript content) | none |
| `track-edits.mjs` | `PostToolUse` on `Edit\|Write\|MultiEdit` | Tool payload (the edited path), ledger | Ledger, `.claude/.workspace/<sessionId>.json` claim record | none |
| `auto-format.mjs` | `PostToolUse` on `Edit\|Write\|MultiEdit` | Tool payload, config, `PATH` probe | Rewrites the edited file, via the formatter you already have installed | none by itself; the spawned formatter is third-party code (60 s cap) |
| `domain-conformance.mjs` | `PostToolUse` on `Edit\|Write\|MultiEdit` | Config, ledger, domain artifacts | Conformance record and deviation note | none |
| `indirect-write-reconcile.mjs` | `PostToolUse` on `Edit\|Write\|MultiEdit\|Bash` | `git status --porcelain`, ledger | Ledger | none |
| `check-registration.mjs` | `Stop` | All ledgers, memory indices | Ledger, `.claude/.sessions/.distill-nudge`, `.claude/.sessions/.advisor-nudge` | none |
| `completion-gate.mjs` | `Stop` | Execution contract, stored receipts, ledger | Ledger, appends one line to `contextkit/memory/lang-classifier-telemetry.jsonl` | none |
| `done-sweep.mjs` | `Stop` | Workflow registry and workflow directories | **Moves concluded workflow directories into `done/`** under the memory tree | none |
| `concurrency-guard.mjs` | `PreToolUse` on `Edit\|Write\|MultiEdit` | Other sessions' ledgers and claim records | none | none |
| `domain-code-gate.mjs` | `PreToolUse` on `Edit\|Write\|MultiEdit` | Config, domain map, implementation packet | none | none |
| `simulate-gate.mjs` | `PreToolUse` on `Edit\|Write\|MultiEdit` | Ledger simulation records, the high-risk path list in config | none | none |
| `journey-gate.mjs` | `PreToolUse` on `Edit\|Write\|MultiEdit` | Journey policy, workflow registry, ledger, branch | none | none |
| `deliberation-nudge.mjs` | `PreToolUse` on `Edit\|Write\|MultiEdit` | Config, ledger | A once-per-session marker file | none |
| `execution-gate.mjs` | `PreToolUse` on `Read\|Edit\|Write\|MultiEdit\|Grep\|Glob\|Bash` | Execution contract, receipt store, ledger | Ledger, appends one line to `contextkit/memory/routing-decisions.jsonl` | none |
| `subagent-gate.mjs` | `PreToolUse` on `Task`, `SubagentStop` | Contract, ledger, spawn records | `contextkit/pipeline/state/<taskId>/` spawn record, ledger | none |
| `execution-contract-hook.mjs` | `UserPromptSubmit` | **The prompt text** from the event payload, config, work registries, branch | `contextkit/pipeline/state/<taskId>/execution-contract.json`, ledger, appends to `contextkit/memory/routing-decisions.jsonl` | none |
| `statusline.mjs` | Status line, every prompt | Config, directory counts, active task receipts | none | none |

### What the prompt-classification hook keeps

`execution-contract-hook.mjs` is the one hook that receives your prompt text. It
runs a deterministic classifier — token tables and thresholds, no model call — and
persists the **verdict**, not the input. A stored contract inspected on disk
contains `taskId`, `sessionId`, `branch`, host, the classification signals
(tier, domain, level, work nature and kind, confidence, the reason strings the
classifier emitted), the required-evidence lists, timestamps and history. No field
carrying the prompt text was present.

The limit on that statement: the classifier's `reasons` and any derived path list
are generated from your prompt, so a sufficiently specific prompt can be partially
inferred from them, and the free-text session file written later by `/log-session`
does quote the request directly. See [../PRIVACY.md](../PRIVACY.md).

## Git hooks

Installed at level 3 and above.

| Hook | Reads | Writes | Egress |
|---|---|---|---|
| `pre-commit` | Staged file list, memory sources, pipeline files, project map manifest | Regenerates the memory indices, pipeline board and project map, then **stages them into your commit** with `git add` | none |
| `commit-msg` | The commit message file | none | none |
| `pre-push` | Push range on stdin, local and remote refs | none | **`git fetch origin <mainBranch>`** to your configured remote (15 s cap, `CONTEXT_GIT_TIMEOUT_MS`) |

`pre-push` then runs the multi-language quality gates, which invoke your project's
own lint, typecheck, build and test commands. Those commands are third-party and
may reach the network on their own; the kit does not add or intercept that traffic.

## Network calls and what triggers them

Complete list of code paths that open a socket, with the trigger for each.

| Destination | Code path | Trigger | Default |
|---|---|---|---|
| Your configured git remote | `session-start.mjs` divergence check | Every session start at level 1 and above | **Active on a stock install** |
| Your configured git remote | `pre-push.mjs` conflict pre-check | Every `git push` at level 3 and above | **Active on a stock install** |
| `registry.npmjs.org` | `deps-audit.mjs` staleness check | `--registry` flag only; 8 s timeout; unreachable is reported as skipped, never as a pass | Off |
| `registry.npmjs.org` search endpoint | `mcp-discover-core.mjs` | `/mcp discover` | Off |
| The MCP server URL you configured | `mcp-doctor-probe-http.mjs` | `/mcp doctor` against an HTTP-transport server | Off |
| A local process, not a socket | `mcp-doctor-probe-stdio.mjs` | `/mcp doctor` against a stdio server — spawns the server command | Off |
| `generativelanguage.googleapis.com` | `runtime/providers/media/nano-banana.mjs`, `veo.mjs` | The media-generation script only; refuses with a no-credentials error when `GOOGLE_AI_API_KEY` is unset | Off |
| GitHub, through your authenticated `gh` CLI | `gh-alerts.mjs`, `git.mjs`, `sync-check.mjs` | Explicit commands; absent or unauthenticated `gh` degrades silently | Off |
| `127.0.0.1` listener, not outbound | `dashboard-server.mjs` | `/dashboard --watch`; binds loopback only, default port 4242 | Off |

The two entries marked active send git protocol traffic to a remote you chose. They
transmit no project content beyond what a `git fetch` requests, and they transmit
nothing to the kit's authors. If that traffic is unacceptable in your environment,
the divergence check is inside `session-start.mjs` and the pre-push fetch inside
`pre-push.mjs`; both fail open, so removing the remote or working offline degrades
them to silence rather than an error.

## Model Context Protocol servers

Enabling an MCP server is the only mechanism in the kit that grants a third party
access to your repository. It is opt-in: no server is enabled by a stock install.

### What adding a server actually does

`/mcp add` writes a manifest entry, and `/mcp sync` renders that entry into your
host's own configuration — the `mcpServers` block of `.claude/settings.json` for
Claude Code, `.agents/mcp.json` for Antigravity, and the per-project equivalent for
Codex. From then on the host, not the kit, starts the server and routes tool calls
to it. A server with repository read tools can read whatever the host will hand it,
including files the kit never touches.

### The controls that exist

| Control | What it does |
|---|---|
| Curated registry | `contextkit/mcp/registry.json` carries a small pinned catalogue with a declared risk class (R0 to R5), declared tools, declared allowed hosts and a version pin. |
| Secret-name-only manifests | The manifest stores the **name** of an environment variable, never its value; the writer throws when a value matching known token shapes is supplied. |
| Write-mode approval flag | Profile resolution returns a proposal, and any entry in write mode or marked as requiring human approval is flagged so the caller must gate it on explicit consent. |
| Health check | `/mcp doctor` initialises each enabled server and reports whether it responds. |
| Audit | `/mcp audit` flags servers that expose write-capable tools or reference secret-shaped environment keys, by name pattern. |

### What those controls are not

Curation, health-checking and auditing are **inventory and reachability
controls, not supply-chain vetting**. Specifically:

- The registry records a provenance block, but the integrity `hash` field is
  `null` for catalogued entries — nothing verifies that the package you install is
  the artifact that was reviewed.
- No signature, attestation or SBOM of the server is checked at any point.
- `/mcp audit` classifies by **matching tool names against a regular expression**.
  A server whose destructive tool is named innocuously is not flagged, and a
  read-only tool with a matching name is flagged when it should not be.
- `/mcp doctor` proves a server answers an initialise call. It says nothing about
  what the server does with the data it receives.
- `allowedHosts` is declared metadata in the catalogue. The kit does not enforce
  it at runtime; the server process is not sandboxed and its egress is not filtered.

Treat every server you enable as third-party code running with your credentials and
your filesystem access, and vet it the way you would vet any dependency.

## Why hooks are not a security control

Every hook exits 0 on error, stays silent when it has nothing to say, and reports a
check it could not run as skipped rather than as a pass. That is deliberate — a
governance layer that breaks a developer's commit when a JSON file is malformed
gets deleted. The consequence is that hooks constrain a **cooperating** agent and
cannot constrain an adversary. Concretely:

- Any unexpected exception is swallowed: the top-level handler is
  `main().catch(() => process.exit(0))`, and helper reads return safe defaults
  instead of throwing.
- In advisory mode nothing ever blocks. The default mode degrades to advisory
  whenever it cannot evaluate safely — no contract on disk, a fresh install,
  missing signals — so absence of data produces a warning, not a denial.
- The blocking checkpoints are a deliberately narrow allow-list. A gate that
  computes a negative verdict outside that list warns and lets the write through.
- Documented bypasses exist and are honoured: `git commit --no-verify`,
  `git push --no-verify`, `CONTEXT_ALLOW_CONFLICT_PUSH=1`,
  `CONTEXT_ALLOW_CLAIMED_EDIT=1`, `[skip-cc]` in a commit subject, and a covering
  simulation record standing a gate down.
- The wiring is plain JSON in a file the same agent can edit. Removing a hook entry
  from the host settings disables the check with no record.
- Hooks only see what the host reports. A write performed by a subprocess the host
  did not classify as an edit is reconciled after the fact, at best.

If you need a control that holds against an adversary, put it where it cannot be
skipped: branch protection and required status checks on the server, CI jobs, and
review. The kit's own CI-facing pieces — the scaffolded dependency-review,
CodeQL and Dependabot configuration from `/security-setup`, and the deterministic
`/deps-audit` — are advisory by default and become enforcement only when you mark
them as required checks.

## Dependency surface

The claim is scoped, and the scope is the point.

- **Zero third-party packages on the hot path.** No npm dependency is imported
  anywhere under `contextkit/runtime/hooks/` or by the configuration loader, so
  levels 1 to 3 run in a project with nothing installed. Everything there uses
  `node:` built-ins.
- `zod` is a development dependency of the kit's own repository, reached only
  through a dynamic import in the optional strict configuration validator. It is
  not required to run the kit, and it is absent from the hook path.
- The AST-based graph extractor optionally uses `web-tree-sitter` and pre-built
  grammar files through a dynamic import. When they are absent the extractor
  degrades instead of failing, and nothing on the hook path calls it.
- Everything else the kit runs is software you already have: `git`, `node`, your
  formatter, your test runner, and — only if you enable one — an MCP server.

## See also

- [footprint.md](./footprint.md) — the file inventory and the removal path.
- [../PRIVACY.md](../PRIVACY.md) — what the recorded artifacts contain.
- [../../SECURITY.md](../../SECURITY.md) — how to report a vulnerability.
