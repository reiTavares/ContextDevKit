# Migrating ContextDevKit 3.x to 4.0

ContextDevKit 4 removes runtime compatibility with the 3.x governance and state
model. This is an offline data migration, not an in-place compatibility mode.

Read this guide completely before using `--write`, `--freeze`, `--cutover`,
`--rollback`, or `--retire-v3`.

## What changes

- Markdown pipeline lanes stop being task authority.
- `workflow-plan.json` stops being workflow authority.
- task state moves to `pipeline/tasks.json` with schema version 2.
- workflow topology moves to `workflow.json`; aggregate state remains in the
  smaller `workflow-state.json` schema version 2.
- the multi-hook 3.x chain is replaced by one dispatcher per governance event.
- autonomy grades, required-agent receipts, rigid routing, and semantic swarm
  caps stop authorizing or denying work.
- normal runtime readers do not fall back to any 3.x path after cutover.

The migrator conserves cards/tasks, normalizes statuses, identifies ownerless
records, rejects unresolved duplicate identities, stages a complete v4
generation, verifies schema and parity, exercises a rollback copy, and fences
old writers before authority changes.

## Workflow placement in 4.0.1 and later

`workflow-state.json` remains the sole workflow lifecycle authority. Directory
placement is only a human navigation projection:

- active owner-scoped workflow: `<BIZ|OP>/workflows/<WF>/`;
- completed owner-scoped workflow: `<BIZ|OP>/done/<WF>/`;
- active neutral workflow: `memory/workflows/<WF>/`;
- completed neutral workflow: `memory/workflows/done/<WF>/`.

Every location contains the complete Workflow v2 package, including
`workflow.json`, `workflow-state.json`, `pipeline/tasks.json`, generated
`pipeline/tasks.md`, authored planning documents, reports, manifest, and index.
The migrator preserves completed placement; it never creates task status
directories or derives lifecycle state from a folder name.

ContextDevKit 4.0.0 could leave an already-completed v2 package in its active
directory. After updating to 4.0.1, preview and apply the idempotent placement
repair from the target project root:

```powershell
node .\contextkit\tools\scripts\workflow.mjs done-move WF-####
node .\contextkit\tools\scripts\workflow.mjs done-move WF-#### --apply
```

The command refuses a non-`done` JSON state and never changes lifecycle state.

## Preconditions

1. Use a tested 4.0 checkout or package on the same filesystem volume as the
   installed `contextkit` directory.
2. Stop other writers to the project for the migration window.
3. Back up the project independently according to your normal recovery policy.
4. Choose an empty migration workspace **outside** the installed
   `contextkit` root. Keep it until the migration has been accepted.
5. Resolve every duplicate or ambiguous legacy task id reported by dry-run.

The tool refuses reparse/symlink traversal, cross-volume atomic swaps, changed
source hashes, incomplete stage receipts, marker revision conflicts, invalid
JSON, and unmatched status parity.

## Command

From the target project root, use the installed offline entrypoint:

```powershell
$platformRoot = (Resolve-Path .\contextkit).Path
$workspaceRoot = Join-Path (Split-Path $platformRoot -Parent) '.contextdevkit-v4-migration'
$migrator = Join-Path $platformRoot 'tools\migrations\v3-to-v4\cli.mjs'
```

The migration workspace must not be inside `$platformRoot` and must be on the
same volume.

### 1. Inventory and dry-run

```powershell
node $migrator --platform-root $platformRoot
```

This writes nothing. Review the manifest summary and resolve every refusal.

### 2. Stage and validate

```powershell
node $migrator `
  --platform-root $platformRoot `
  --workspace-root $workspaceRoot `
  --write
```

Staging writes only under the external migration workspace. It creates:

- `migration-manifest.json`;
- `migration-plan.json`;
- `stage-receipt.json`;
- the candidate v4 generation;
- a hash-verified rollback generation.

The receipt must report `schemaValidated`, `parityValidated`, and
`rollbackExercised` as `true`. Repeating an identical stage is a verified no-op.

### 3. Freeze v3 writers

The initial fence revision is `0`:

```powershell
node $migrator `
  --platform-root $platformRoot `
  --freeze `
  --expected-revision 0
```

The source digest computed during freeze must match the staged plan. From this
point, old writers remain fenced even if a later v4 rollback is used.

### 4. Cut over authority

The initial authority-marker revision is `0`:

```powershell
node $migrator `
  --platform-root $platformRoot `
  --workspace-root $workspaceRoot `
  --cutover `
  --expected-revision 0
```

Cutover is an atomic marker compare-and-swap. It can only point to the validated
v4 generation. It never emits a v3, dual-read, or dual-write mode.

After cutover, verify the normal CLI, MCP read resources, dashboard, and
statusline all report the same statuses as canonical JSON.

### 5. Exercise rollback

After the first cutover the authority revision is `1`:

```powershell
node $migrator `
  --platform-root $platformRoot `
  --workspace-root $workspaceRoot `
  --rollback `
  --expected-revision 1
```

Rollback changes authority to the independently copied, byte-verified v4
rollback generation. It does not reactivate v3 readers or writers and does not
remove the old-writer fence. The migration workspace and its manifest remain
the recovery evidence.

If you cut over or roll back again, read the current marker revision first and
pass that exact value. Stale revisions are refused.

### 6. Cut over to the accepted generation

After the rollback drill, either accept the rollback generation as the active
v4 authority or switch back to the staged candidate. To make the candidate
active again after the first rollback, use the current marker revision (`2` in
an uninterrupted first run):

```powershell
node $migrator `
  --platform-root $platformRoot `
  --workspace-root $workspaceRoot `
  --cutover `
  --expected-revision 2
```

Read `.contextdevkit-authority.json` after the command. Its `generationRoot`
must name the accepted external v4 generation, `oldWriterFence` must remain
`true`, and the normal authority reader must report the staged task count with
zero diagnostics.

### 7. Retire active v3 sources

Only after runtime parity and recovery have been accepted:

```powershell
node $migrator `
  --platform-root $platformRoot `
  --workspace-root $workspaceRoot `
  --retire-v3
```

Inventoried v3 data is moved by same-volume rename to
`legacy-source-bundle/<migration-id>/` inside the external workspace. The
bundle is audit/recovery input only: it contains no registered runtime entrypoint.
The entire legacy `contextkit/pipeline/` root is included in the hash-gated
move; a successful retirement leaves no physical lane tree in the installation.

Repeating `--retire-v3` must report every source as already retired and move
zero additional files.

### 8. Regenerate derived indexes

With v4 authority active, regenerate Project Map from the project root:

```powershell
node .\cdx.mjs project-map
```

The resulting `00-index.md` must be written under the active generation's
`memory/project-map/`. The former in-place memory tree is inactive historical
input and must not receive new workflow/task state.

Do not delete the workspace until your retention policy permits it.

## Status conversion

The migrator maps legacy lane and task values to the closed v4 set:
`backlog`, `working`, `blocked`, `testing`, `done`, and `cancelled`. A legacy
`conclusion` card becomes `done`. Unknown status values are refused; the tool
does not invent an event history to bridge them.

Ownerless records are conserved as neutral work. Ambiguous or duplicate ids
must be resolved explicitly because silently choosing an owner would change
identity.

## Configuration conversion

Compatibility names are accepted only by the upgrade parser/migrator. The v4
runtime schema contains no switch that can re-register a legacy hook, writer,
autonomy gate, or routing requirement.

| 3.x key/value | 4.0 result | Migration behavior |
| --- | --- | --- |
| `enforcement.mode: "advisory"` | `governance.defaultMode: "canary"` | convert and warn |
| `enforcement.mode: "strict"` | `governance.defaultMode: "guarded"` | convert and warn; the central allowlist still clamps blocking to three gates |
| missing or invalid enforcement mode | `governance.defaultMode: "canary"` | replace with safe default and warn |
| per-gate `advisory` | `canary` | convert and warn |
| per-gate `strict` | `guarded` | convert and warn; non-allowlisted gates resolve to canary |
| `autonomy.grade` or `autonomy.level` | removed | discard and warn; there is no authorization equivalent |
| `autonomy.extraSecretPaths` | `riskAcknowledgement.extraSecretPaths` | copy unique normalized paths |
| autonomy floors/readiness/self-edit authority | removed | discard and warn |
| `swarm.maxWorkstreams` | removed | discard; only a real host limit may constrain parallelism |
| `swarm.maxWavesPerRun` | removed | discard |
| `swarm.tokenBudgetPerRun` | `swarm.tokenBudgetPerRun` | preserve as advisory planning data |
| `swarm.staleMinutes` | `swarm.staleMinutes` | preserve as operational cleanup data |
| rigid routing/required-agent flags | recommendation-only routing | discard authority semantics and warn |
| LGPD required-agent/floor flags | `privacy-lgpd: "shadow"` | discard blocking semantics and warn |

The upgrade report is the authoritative record of discarded keys. Do not copy
old objects wholesale into `config.json`.

## Verification checklist

- dry-run writes zero files;
- staged task count equals inventoried task count;
- duplicate and ownerless decisions are explicit;
- every staged JSON document validates;
- status parity passes;
- rollback is exercised before cutover acceptance;
- cutover marker has `authority: "v4"` and `oldWriterFence: true`;
- attempts to use an old writer are refused;
- normal boot does not load the migrator or any legacy module;
- CLI, MCP, dashboard, and statusline agree with `pipeline/tasks.json`;
- completed workflow packages and their tasks remain readable from the derived
  `done/` location;
- second dry-run/stage/cutover operation is idempotent or revision-refused, not
  a duplicate mutation;
- final authority points to the accepted v4 generation after the rollback drill;
- active v3 paths are retired only after acceptance, `contextkit/pipeline/` is
  absent, and the external bundle contains its hash-matched replacement;
- Project Map is regenerated under the active generation root;
- the release gate reports no reachable legacy path.

## Important non-goals

- The migrator is not a normal `pipeline` or `workflow` command.
- It is not imported by boot, hooks, MCP, dashboard, statusline, or host adapters.
- It does not support live dual-write, dual-read, or automatic fallback.
- A legacy backup bundle is not an executable compatibility runtime.
- Rollback never weakens the v3 writer fence.
