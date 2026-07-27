# Configuration reference

<!-- GENRE: Reference (information-oriented)
     Goal: reader finds what a configuration area governs and how to change it safely.
     Voice: dry, accurate, consulted rather than read.
     CONTRACT: the exhaustive key/default table is GENERATED between the marker pair
     below from the configuration loader. Never hand-maintain key defaults in prose —
     a hand-copied default drifts silently. Authored prose explains what an area
     governs and how to decide; it never restates the table. -->

The kit reads one file: `contextkit/config.json` in your project. Everything below
describes what each area governs and how to change it without breaking the install.

For live values in your own project, ask the config command rather than trusting a
document:

```shell
node contextkit/tools/scripts/context-config.mjs show
node contextkit/tools/scripts/context-config.mjs show economy.mode
```

To change one value in place:

```shell
node contextkit/tools/scripts/context-config.mjs set economy.mode advisory
```

To check the file is internally coherent:

```shell
node contextkit/tools/scripts/config-health.mjs
```

The health check reports repairable damage separately from damage that needs a human —
a list that was collapsed by a bad merge cannot be reconstructed from the file alone,
so it says so instead of guessing.

## How to read this page

- **Area** — the top-level key, and the subsystem it governs.
- **Change it when** — the situation that justifies touching it.
- **Leave it alone when** — the common mistake.

Nothing here needs to be set for the kit to run. The installer writes a working
configuration, and every area has a default. An absent key means "use the default",
never "disabled".

## Areas

### `level`

The activation level, 1 through 7. Governs **which** capabilities exist.

**Change it when** you want a different capability tier — but change it through
`context-level.mjs`, not by editing this key. The command also recomposes the host
hook wiring, which a hand edit does not. See
[install and choose a level](../how-to/install-and-choose-a-level.md).

**Leave it alone when** what you actually want is less AI autonomy. That is the consent
grade, a separate and independent dial.

### `setup`

Whether onboarding has completed. Written by the onboarding command.

**Change it when** never, by hand. It is a marker, not a preference.

### `practices`

Whether the coding-practices rubric is active in session context.

**Change it when** you want the rubric's guidance out of the boot context — for
example in a repository with its own established conventions documented elsewhere.

### `ledger`

Drift detection. Three lists: which paths count as important edits, which are
irrelevant noise, and which files count as session registration.

**Change it when** your project layout does not match the defaults — a monorepo whose
source lives somewhere unusual, or a build directory the defaults do not know about.

**Leave it alone when** you are only trying to silence the end-of-session nudge. The
nudge exists because unregistered work is how context gets lost between sessions.

### `l3`

Multi-session settings. Currently the main branch name, used by branch-scoped
behaviour.

**Change it when** your default branch is not the conventional one.

### `autoFormat`

The post-edit formatting hook: whether it runs, the minimum level at which it
activates, and paths it must not touch.

**Change it when** the project has its own formatter wired through a different
mechanism and you want exactly one authority formatting files.

### `qualityGate`

Pre-push quality gates: whether enabled, the minimum level, the level at which they
become strict, and specific gates you have disabled.

**Change it when** a specific gate does not apply to your stack. Disable that gate by
name rather than turning the whole area off.

### `bridges`

Which context bridges are enabled for non-native tools. Opt-in per tool; context only,
no enforcement.

**Change it when** you use a tool the kit does not natively host and want it to read
project context. See [work across hosts and bridges](../how-to/work-across-hosts-and-bridges.md).

### `qa`

Critical paths that must be covered, and the coverage targets for lines and branches.

**Change it when** you know which paths in your project carry real risk. An empty
critical-path list is honest — it means nothing has been declared critical yet, not
that everything is safe.

### `domainEngineering`

Whether the domain classifier runs, whether it classifies every request, whether
session start reports readiness, whether code work requires the development squad and
an implementation packet, whether receipts are persisted, and the enforcement rollout
stage.

**Change it when** you want to move the enforcement stage. The stage is a ceiling set
by a human and it only ever lowers automatically — it is not something the kit raises
on its own. See [governance and enforcement](../explanation/governance-and-enforcement.md).

**Leave it alone when** you are trying to unblock a single edit. A gate that blocked
names the exact corrective command; running that command is the intended path, and
lowering the stage to get past one edit disables the gate for everything else too.

### `architectureDebtGate`

The technical-debt adjudication gate: whether enabled, its mode, the baseline strategy,
per-dimension rule modes, the advisory line-count signals, the blocking floors, what an
intentional-debt declaration must carry, the scope it examines, and how unknown
evidence is treated.

Two things worth knowing before you touch this:

- **The line signals are advisory and cannot block.** They exist to prompt a look at a
  file, never to decide. File size is not technical debt. A small file can be badly
  designed and a large one can be clean.
- **Unknown evidence is not a pass.** When the gate cannot evaluate something it says
  so; it does not count silence as success.

**Change it when** you are declaring a floor for your project (which dimensions block)
or recording intentional debt with its owner and repayment trigger.

**Leave it alone when** you want a file-size limit. There isn't one, by design.

### `l5`

The proactive tier: high-risk paths the impact gate protects, contract globs watched
for drift, the distillation window, and the technical-debt sweep profiles and cadence.

**Change it when** you know which paths in your project have outsized blast radius —
schema, shared contracts, the authentication surface, core services. An empty
high-risk list means the gate has nothing to protect.

### `economy`

Token and cost economy: the master switch, the mode, and a toggle per lever (output
contract, findings protocol, agent contract, compaction, context profiles, boot delta,
resume pack, lean loop, loop breaker, patch economy, measurement).

**Change it when** a specific lever misbehaves in your project — turn off that lever,
not the whole area.

**Leave it alone when** you expect a cost saving from flipping the mode. The mode
governs whether economy findings advise or enforce; it is not a discount. Any claim
about savings needs a measured before-and-after in your own project.

### `projectMap`

The structural map and the symbol graph: whether the graph is enabled, its mode,
whether a human has flipped it on explicitly, and whether it re-indexes automatically.

**Change it when** you want graph-backed queries instead of repeated searching. See
[use the knowledge graph](../how-to/use-the-knowledge-graph.md).

### `workflowIntegrity`

The workflow invariant guard: whether enabled, its mode, and the phase it watches.

**Change it when** you are moving the guard from observation to enforcement, which is a
deliberate step and belongs in a recorded decision.

## Every key and its default

<!-- contextdevkit:generated:config-reference:start -->
_The exhaustive key/default table is generated from the configuration loader by
`docs-generate.mjs`. Until that generator covers this surface, read live values with
`node contextkit/tools/scripts/context-config.mjs show` — that command reads the same
loader this table will be generated from, so it cannot disagree with your install._
<!-- contextdevkit:generated:config-reference:end -->

## Validation

Strict schema validation is optional and sits behind a dynamic import, so the kit never
requires it to run. When the validation dependency is present, the config command
validates against the schema; when it is absent, validation reports as skipped rather
than as a pass.

## Related

- [Install and choose a level](../how-to/install-and-choose-a-level.md) — how the
  installer writes the initial configuration.
- [Configure ContextDevKit](../how-to/configure-contextkit.md) — task-shaped recipes
  for the common changes.
- [Governance and enforcement](../explanation/governance-and-enforcement.md) — what the
  enforcement modes actually do, and what happens when a gate cannot evaluate.
- [Troubleshoot](../how-to/troubleshoot.md) — when the configuration and the observed
  behaviour disagree.
