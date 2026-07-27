# Reference: installation footprint

Every file the kit writes into a project, every process it causes to run, and what
the removal path does and does not undo. Requires Node.js 18 or newer; all hooks
are `node` invocations of files inside the platform directory.

Verify the live wiring in any installed project with:

```shell
node contextkit/tools/scripts/doctor.mjs
```

## Host hook wiring

The kit writes hook entries into the host's own configuration file. Entries are
composed per activation level (1–7) and are recognisable by the command string
containing `contextkit/runtime/hooks`. User-authored hooks in the same file are
preserved; re-running the installer at a lower level removes the entries that
level no longer wires.

### Claude Code

Written to `.claude/settings.json`. One `statusLine` key is also set at level 1 or
above, pointing at `contextkit/runtime/statusline.mjs`; an existing non-kit
`statusLine` is left alone.

| Level | Event | Matcher | Script |
|---|---|---|---|
| 1 | `SessionStart` | — | `session-start.mjs` |
| 2 | `PostToolUse` | `Edit\|Write\|MultiEdit` | `track-edits.mjs` |
| 2 | `Stop` | — | `check-registration.mjs` |
| 3 | `PreToolUse` | `Edit\|Write\|MultiEdit` | `concurrency-guard.mjs` |
| 4 | `PostToolUse` | `Edit\|Write\|MultiEdit` | `auto-format.mjs` |
| 4 | `PreToolUse` | `Edit\|Write\|MultiEdit` | `domain-code-gate.mjs` |
| 4 | `PostToolUse` | `Edit\|Write\|MultiEdit` | `domain-conformance.mjs` |
| 5 | `PreToolUse` | `Edit\|Write\|MultiEdit` | `simulate-gate.mjs` |
| 5 | `PreToolUse` | `Edit\|Write\|MultiEdit` | `journey-gate.mjs` |
| 5 | `PreToolUse` | `Edit\|Write\|MultiEdit` | `deliberation-nudge.mjs` |
| 5 | `UserPromptSubmit` | — | `execution-contract-hook.mjs` |
| 5 | `PreToolUse` | `Read\|Edit\|Write\|MultiEdit\|Grep\|Glob\|Bash` | `execution-gate.mjs` |
| 5 | `PostToolUse` | `Edit\|Write\|MultiEdit\|Bash` | `indirect-write-reconcile.mjs` |
| 5 | `Stop` | — | `completion-gate.mjs` |
| 5 | `Stop` | — | `done-sweep.mjs` |
| 5 | `PreToolUse` | `Task` | `subagent-gate.mjs` |
| 5 | `SubagentStop` | — | `subagent-gate.mjs` |
| 5 | `PreCompact` | — | `compaction-continuity.mjs` |
| 5 | `SessionStart` | — | `compaction-continuity.mjs` |

The two level-4 domain hooks exit early unless `domainEngineering.enabled` is set
in `contextkit/config.json`; that key is `false` by default, so on a stock install
they are wired but inert.

### Antigravity and Codex

The other two native hosts get the equivalent wiring in their own files:
`.agents/hooks.json` (Antigravity) and `.codex/hooks.json` (Codex). The kit writes
one owned group per file and leaves user-owned groups untouched.

## Git hooks

Installed only at level 3 and above, into the resolved git directory's `hooks/`
folder (followed through the `.git` pointer file when the project is a worktree or
submodule). Each is a two-line POSIX shell wrapper that calls a `.mjs` file:

| Hook | Wrapper body | Blocks? | Bypass |
|---|---|---|---|
| `pre-commit` | `node contextkit/runtime/git-hooks/pre-commit.mjs` | Only via the workflow-invariant guard | `git commit --no-verify` |
| `commit-msg` | `node contextkit/runtime/git-hooks/commit-msg.mjs "$1"` | Yes — exit 1 on a non-conventional subject | `[skip-cc]` in the subject, or `--no-verify` |
| `pre-push` | `node contextkit/runtime/git-hooks/pre-push.mjs` | Yes — exit 1 on a real textual conflict, or a failed quality gate at the configured strict level | `CONTEXT_ALLOW_CONFLICT_PUSH=1`, or `--no-verify` |

### Side effects worth knowing

`pre-commit` regenerates derived documents and **stages them into the commit you
are making** with `git add`: the memory indices (`SESSIONS.md`, `WORKSPACE.md`,
`DELIBERATIONS.md`), the pipeline board files, and the project map when the staged
changeset touches mapped source and `projectMap.autoRefresh` is not `false`. Each
regeneration is best-effort and a failure never blocks the commit.

`pre-push` runs `git fetch` against the configured main branch (`l3.mainBranch`,
default `main`) before comparing, then hands off to the multi-language quality
gates. Git subprocesses are capped at 15 seconds (`CONTEXT_GIT_TIMEOUT_MS`).

### Coexisting with an existing hook manager

The installer detects a custom `core.hooksPath`, Husky, Lefthook, a
`simple-git-hooks` key in `package.json`, or a non-kit hook already present, and
prints a chaining suggestion. It still installs its own wrappers: an existing
non-kit hook is renamed to `<name>.bak` first, and an already-present `.bak` is
never overwritten.

## The platform directory

The folder name is a single constant (`PLATFORM_DIR`) and defaults to
`contextkit/`. Contents on a full install:

| Path | Contents |
|---|---|
| `contextkit/runtime/` | Hooks, git hooks, config loader, status line, host adapters, providers |
| `contextkit/tools/` | The script surface invoked by slash commands |
| `contextkit/policy/` | Routing, squad, capability and domain policy tables |
| `contextkit/skills/`, `contextkit/squads/` | Agent and skill definitions |
| `contextkit/workflows/`, `contextkit/methodology/` | Lifecycle documents and playbooks |
| `contextkit/pipeline/` | Board files plus `state/` (per-task runtime state) |
| `contextkit/memory/` | Your durable record — decisions, sessions, workflows, glossary, registries |
| `contextkit/mcp/`, `contextkit/mcp-server/` | Curated server registry, profiles, schema |
| `contextkit/detectors/`, `contextkit/starters/`, `contextkit/scripts/`, `contextkit/docs/` | Stack detection, scaffolds, helper scripts, kit docs |
| `contextkit/config.json` | The project's kit configuration |
| `contextkit/.engine-version`, `contextkit/.install-manifest.json` | Version stamp and per-file hash manifest |
| `contextkit/.env.example` | Credential template; nothing in it is required by default |
| `contextkit/.cache/`, `contextkit/.updates/` | Disposable state |

## Root-level writes

| Path | When | Collision behaviour |
|---|---|---|
| `CLAUDE.md` | Always | Existing file kept; `CLAUDE.contextdevkit.md` written beside it |
| `AGENTS.md`, `cdx.mjs`, `.codex/` | Always (Codex host) | Same pattern via `AGENTS.contextdevkit.md`; `cdx.mjs` is always overwritten |
| `INSTRUCTIONS.md`, `ctx.mjs`, `.agents/` | Always (Antigravity host) | Same pattern via `INSTRUCTIONS.contextdevkit.md`; `ctx.mjs` is always overwritten |
| `.claude/commands/`, `.claude/agents/` | Always (Claude Code host) | Kit-owned, overwritten |
| `package.json` | When present | Adds `scripts.ctx`, `scripts.agy` (`node ctx.mjs`) and `scripts.cdx` (`node cdx.mjs`); no other key is touched |
| `.gitignore` | Always | Appends one managed block; a re-run only appends lines the block is missing |
| `.gitattributes` | Always | Appends one block once (line endings for engine scripts) |
| `.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/dependabot.yml`, `.github/workflows/quality.yml`, `.github/workflows/security.yml` | Write-if-missing | Never overwritten |
| `.github/workflows/squad-issue.yml` | Only with `--ci-squad` | Consumes API credit when triggered; opens draft pull requests |

## Files written outside the repository

Two locations sit in the user's home directory, not in the project:

| Path | Written by | Contents |
|---|---|---|
| `~/.contextdevkit/projects/<projectId>/backups/<updateId>/` | `--update`, before any file mutation | Copies of `.claude/settings.json`, `contextkit/config.json`, `contextkit/.install-manifest.json`, `contextkit/.engine-version`, and every file under `.claude/.sessions/` and `.claude/.workspace/`, each verified by sha256 after copy |
| `~/.contextdevkit/` (root) | Cross-repo helpers such as the fleet registry | Per-machine JSON state and regenerable caches |

`<projectId>` is the first 16 hex characters of the sha256 of the canonicalised
project path. The base directory can be redirected with `CONTEXTDEVKIT_HOME`.

No pruning or age limit is applied to these backups: each `--update` adds a new
`<updateId>` directory and none are removed. Deleting them is a manual
filesystem operation.

## Tracked and untracked

Two independent mechanisms decide what reaches git.

The **committed** `.gitignore` block covers state that is disposable or
regenerable, so it is ignored for everyone who clones the project:

`_contextkit/`, `.claude/.sessions/`, `.claude/.workspace/`, `.codex/.sessions/`,
`.codex/.workspace/`, `contextkit/pipeline/state/`, `.context-snapshot.md`,
`.distillation-proposal.md`, `.agent-tuning-proposal.md`,
`contextkit/memory/tech-debt-findings.json`,
`contextkit/memory/deps-findings.json`,
`contextkit/memory/deep-analysis-findings.json`,
`contextkit/memory/SESSIONS.md`, `contextkit/memory/WORKSPACE.md`,
`contextkit/memory/DELIBERATIONS.md`,
`contextkit/memory/work-context-registry.json`,
`contextkit/memory/workflow-registry.json`,
`contextkit/memory/decision-registry.json`,
`contextkit/memory/project-map/`, `contextkit/.cache/`, `contextkit/.updates/`.

The **per-clone** managed block, written to the git directory's `info/exclude`,
covers the install machinery. That file is never committed, so this posture does
not travel to anyone else's clone, and because git's exclude rules apply only to
untracked paths, a project that already commits the kit sees no behaviour change —
the installer never touches the index. `--tracked` skips the block entirely.

| Surface | Default status | Mechanism |
|---|---|---|
| `contextkit/runtime/`, `tools/`, `policy/`, `skills/`, `squads/`, `workflows/`, `pipeline/`, `detectors/`, `starters/`, `scripts/`, `mcp/`, `mcp-server/`, `config.json`, kit root docs, `.engine-version`, `.install-manifest.json`, `.env.example` | Untracked | `info/exclude` managed block |
| `.claude/`, `_contextkit/`, `CLAUDE.md`, `.agents/`, `INSTRUCTIONS.md`, `ctx.mjs`, `.codex/`, `AGENTS.md`, `cdx.mjs`, scaffolded `.github/` templates, `docs/CHANGELOG.md`, `.context-snapshot.md` | Untracked | `info/exclude` managed block |
| `contextkit/memory/` durable record — `decisions/`, `sessions/`, `business/`, `operations/`, `workflows/`, `deliberations/`, `GLOSSARY.md`, `roadmap.md` | **Trackable and visible to `git status`** | Deliberately omitted from the exclude block, so a teammate's clone carries the project's memory |
| `contextkit/memory/` regenerable indices, registries and findings listed above | Untracked | Committed `.gitignore` block |
| `dashboard.html` (written by the dashboard snapshot at the repo root) | **Neither ignored nor excluded** | Appears as an untracked file in `git status` and can be committed by a `git add -A` |
| `contextkit/memory/gh-alerts-findings.json` | **Neither ignored nor excluded** | Same as above |
| `~/.contextdevkit/**` | Outside the repository | Not reachable by git |

When the install target is the kit's own repository, self-host detection replaces
the enumerated machinery block with a wholesale exclusion of `/contextkit/`, which
also excludes the memory record.

## Processes the kit causes to run

Beyond the hook `node` processes above: `git` subprocesses (branch, status,
worktree list, fetch, merge-base, merge-tree), formatter or linter binaries that
`auto-format.mjs` finds on `PATH` at level 4 and above, the stack-appropriate
lint/typecheck/build/test commands that the pre-push quality gates select, and —
only when a Model Context Protocol server is enabled — the server command that the
health probe spawns. Network behaviour is enumerated in
[data-posture.md](./data-posture.md).

## Uninstall

```shell
npx contextdevkit --uninstall            # unwire hooks, keep the engine on disk
npx contextdevkit --uninstall --purge    # also delete the engine, commands and agents
```

Add `--target <path>` when running from outside the project.

### What `--uninstall` removes

- Every hook entry whose command contains `contextkit/runtime/hooks` from
  `.claude/settings.json`, `.codex/hooks.json` and `.agents/hooks.json`. The kit's
  group is stripped; user-owned groups survive, and the two non-Claude files are
  deleted outright when nothing user-owned remains.
- The three files `pre-commit`, `commit-msg` and `pre-push` under
  `<project>/.git/hooks/`.

If `.claude/settings.json` cannot be parsed, it is left untouched and the command
says so.

### What `--purge` additionally deletes

`contextkit/runtime/`, `contextkit/tools/`, `contextkit/policy/domain-engineering/`,
`contextkit/policy/devteam/`, `contextkit/policy/domain-artifacts/`,
`contextkit/skills/`, `.claude/commands/`, `.claude/agents/`, `.agents/`,
`.antigravity/` and `.codex/`.

### What is left in place either way

`contextkit/memory/` (the decisions and session history), `CLAUDE.md` and
`AGENTS.md` are kept by design. Also left behind, and not reported by the command:

- `contextkit/config.json` and the flat policy registries, which are treated as
  user-editable stores.
- `contextkit/pipeline/`, `contextkit/workflows/`, `contextkit/squads/`,
  `contextkit/starters/`, `contextkit/mcp/`, `contextkit/detectors/`,
  `contextkit/docs/`, `contextkit/methodology/`, `contextkit/scripts/`,
  `contextkit/.engine-version`, `contextkit/.install-manifest.json`.
- `ctx.mjs`, `cdx.mjs`, `INSTRUCTIONS.md`, and the `ctx` / `agy` / `cdx` keys added
  to `package.json`.
- `.claude/.sessions/` and `.claude/.workspace/` session state, `_contextkit/`,
  `dashboard.html`, `.context-snapshot.md`.
- The `.gitignore` and `.gitattributes` blocks, the `info/exclude` managed block,
  and the scaffolded `.github/` files.
- Everything under `~/.contextdevkit/`.

### Known gaps in the removal path

These are properties of the current code, not recommendations:

- **The `statusLine` key is not removed.** Uninstall rewrites only
  `settings.hooks`. After `--purge` the key still points at
  `contextkit/runtime/statusline.mjs`, which no longer exists.
- **Git hooks are looked up at `<project>/.git/hooks/` literally.** Installation
  resolves the `.git` pointer file, so in a worktree or submodule the wrappers were
  written elsewhere and uninstall will not find them.
- **Backed-up hooks are not restored.** A `<name>.bak` created at install time
  stays a `.bak`.
- **The three hook filenames are deleted unconditionally.** Whatever occupies
  `pre-commit`, `commit-msg` or `pre-push` at that moment is removed, including a
  hook you restored by hand.

### Finishing by hand

```shell
# 1. drop the dangling status line (edit the file, remove the statusLine key)
#    .claude/settings.json
# 2. worktree or submodule: find where the wrappers actually landed
git rev-parse --git-dir
# 3. restore your own hooks, if the installer backed them up
#    mv <git-dir>/hooks/pre-commit.bak <git-dir>/hooks/pre-commit
# 4. remove the managed exclude block between its BEGIN/END markers
#    <common-git-dir>/info/exclude
# 5. remove the appended blocks in .gitignore and .gitattributes
# 6. remove the out-of-repo state
rm -rf ~/.contextdevkit
```

## See also

- [data-posture.md](./data-posture.md) — per-hook reads, writes and network calls.
- [../PRIVACY.md](../PRIVACY.md) — what the recorded artifacts contain.
- [hosts.md](./hosts.md) — the supported hosts.
