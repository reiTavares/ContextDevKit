# How to configure ContextDevKit

<!-- GENRE: How-to guide (task-oriented)
     Goal: reader makes a specific configuration change safely, by area.
     Voice: direct, imperative.
     CONTRACT: this page is task-shaped recipes. The exhaustive key/default listing
     belongs in the reference page, generated from the loader — never duplicated here. -->

## When to use this guide

You want to change one specific thing: which paths the impact gate protects, how much
the token economy does, whether the domain gates advise or block, which bridges are on.

For the full list of areas and what each governs, see the
[configuration reference](../reference/config.md). For the level itself, see
[install and choose a level](install-and-choose-a-level.md) — the level is changed with
its own command, not by editing the key.

## Prerequisites

- The kit installed, and `contextkit/config.json` present.
- Nothing else. Every area has a default, and an absent key means "use the default",
  never "disabled".

## Steps

### Read before you write

1. See the current value of any key.

   ```shell
   node contextkit/tools/scripts/context-config.mjs show
   node contextkit/tools/scripts/context-config.mjs show economy.mode
   ```

   Read live values here rather than trusting a document. This command reads the same
   loader the kit reads, so it cannot disagree with your install.

2. Confirm the file is internally coherent.

   ```shell
   node contextkit/tools/scripts/config-health.mjs
   ```

   It separates damage it can repair from damage that needs you. A path list flattened by
   a bad merge cannot be reconstructed from the file alone, so it reports
   `manual_repair_required` and names the key instead of guessing your original values.

### Change one value

3. Set a key in place.

   ```shell
   node contextkit/tools/scripts/context-config.mjs set economy.mode advisory
   ```

   Prefer this over a hand edit: it writes atomically and validates the shape.

### Protect your high-risk paths

4. Declare which paths carry outsized blast radius.

   The impact gate at level 5 only protects what you list. An empty
   `l5.highRiskPaths` means the gate has nothing to protect — that is honest, not safe.
   Good candidates: schema and migrations, shared contracts, the authentication surface,
   core services.

   ```shell
   node contextkit/tools/scripts/context-config.mjs show l5.highRiskPaths
   ```

   Then check a specific path behaves as you intend:

   ```shell
   node contextkit/tools/scripts/guard.mjs <path>
   ```

   Exit 0 means allowed; exit 1 means blocked pending an impact record.

### Declare your critical paths for QA

5. Point the QA coverage target at what matters.

   `qa.criticalPaths` drives coverage expectations. Like the high-risk list, an empty one
   means nothing has been declared critical yet.

### Tune drift detection to your layout

6. Fix the ledger lists when your project layout does not match the defaults.

   `ledger.important` decides which edits count, `ledger.irrelevant` filters noise, and
   `ledger.registration` names the files that count as registering a session. A monorepo
   with source in an unusual place needs the first list adjusted.

   Do not empty these to silence the session-end nudge. The nudge exists because
   unregistered work is how context gets lost between sessions.

### Turn a specific quality gate off

7. Disable by name, not by area.

   When one pre-push gate does not apply to your stack, add it to `qualityGate.disabled`
   rather than setting `qualityGate.enabled` to false. The same applies to the economy
   levers: turn off the single lever that misbehaves, not the whole area.

### Move an enforcement stage

8. Understand the direction before you touch it.

   The domain-engineering rollout stage is a **ceiling set by a human**. It lowers on its
   own when the gate cannot evaluate safely; it never raises on its own. Raising it is a
   deliberate decision and belongs in a recorded decision, not in a quick edit to unblock
   one file.

   When a gate blocks, it names the exact corrective command. Running that command is the
   intended path. Lowering the stage to get past one edit disables the gate for
   everything else too.

   Read [governance and enforcement](../explanation/governance-and-enforcement.md) before
   changing this.

### Enable a context bridge

9. Add the tool you use to `bridges.enabled`.

   Bridges project the same project memory into non-native tools. They carry context
   only — no hook layer, so they inform the agent and enforce nothing. Default is an
   empty list. See [work across hosts and bridges](work-across-hosts-and-bridges.md).

### Enable the structural graph

10. Turn on graph-backed queries instead of repeated searching.

    The relevant keys live under `projectMap.graph`. See
    [use the knowledge graph](use-the-knowledge-graph.md) for what each mode does and
    when the gate can block.

## Verify it worked

```shell
node contextkit/tools/scripts/context-config.mjs show <the key you changed>
node contextkit/tools/scripts/config-health.mjs
node contextkit/tools/scripts/doctor.mjs
```

The doctor additionally checks that the paths in your configuration lists exist on disk
— a typo in a high-risk path silently protects nothing, and this is where you catch it.

Changes to hook wiring require a host restart. Changes to values read at runtime do not.

## Troubleshooting

**Symptom:** A key you set appears to have no effect.
Fix: Confirm the spelling with `show` — an unknown key is not an error, it is simply
never read. Then check whether the behaviour depends on a level you are below.

**Symptom:** Strict validation reports as skipped.
Fix: Schema validation sits behind an optional dynamic import, so the kit never requires
it to run. Absent, it reports skipped — which is not a pass. Install the optional
validation dependency if you want it enforced.

**Symptom:** The health check reports a collapsed list.
Fix: Restore that list by hand; the originals are not recoverable from the file. Read the
finding in full with `--json` first.

For anything else, see [troubleshoot](troubleshoot.md).

## Related

- [Configuration reference](../reference/config.md) — every area and what it governs.
- [Install and choose a level](install-and-choose-a-level.md) — changing the level.
- [Tune autonomy and level](tune-autonomy-and-level.md) — the consent dial.
- [Governance and enforcement](../explanation/governance-and-enforcement.md) — what the
  enforcement modes do.
