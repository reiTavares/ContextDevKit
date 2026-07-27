# How to upgrade and update an install

<!-- GENRE: How-to guide (task-oriented)
     Goal: reader updates a real install, understands every branch the updater can
           take, and can roll back.
     Voice: direct, imperative — assume competence.
     Facts: status codes, preflight checks and the snapshot destination come from the
     updater's own status constants, preflight module and snapshot module. Never
     hand-invent a status name. -->

## When to use this guide

A new kit version is out and you want it in a project without losing your own work. Or
an update deferred and you need to know why and what to do about it.

## Prerequisites

- An existing install. If there isn't one, see
  [install and choose a level](install-and-choose-a-level.md).
- Your in-flight work saved. The updater will refuse to run over an active session, but
  saving first is what makes the override safe when you need it.

## What an update touches, and what it never touches

The update refreshes the engine, the host front-end assets (commands, agents, skills)
and the hook wiring for your **current** level. The level is preserved — it is read
from your configuration, not reset.

It never modifies:

- Your project memory — decisions, sessions, roadmap, business rules, project docs.
- Your boot instruction files.
- Your configuration.
- Your pipeline tasks.
- Anything you personalised. A file you changed and the kit also changed is a real
  conflict, and it is surfaced rather than overwritten.

Derived artifacts — the structural map, the symbol graph, the docs navigation index —
may be regenerated, but only when doing so is safe.

## Steps

### Run the update

1. Update in place.

   ```shell
   npx contextdevkit --update
   ```

   `--update` is non-interactive by design: it implies `--yes`, so it never stops to
   prompt for a level or a project name.

2. Read the summary. It ends in one of the outcomes in the table below. The outcome is
   the whole point — a deferral is a successful refusal, not a failure.

3. Restart your host.

   The refreshed hook wiring is only read at startup.

### The outcomes

| Outcome | Meaning | What to do |
| --- | --- | --- |
| `UPDATED` | Clean success. | Restart the host. |
| `UPDATED_WITH_PENDING_MERGES` | Applied, but conflicts were preserved unresolved because there was no terminal to ask. **Not a clean success.** | Merge by hand: your files were kept, the kit's versions are stashed under `contextkit/.updates/v<version>/`. |
| `DEFERRED_ACTIVE_SESSIONS` | Active sessions detected. **Zero files were written.** | Save and close your work, then re-run with `--allow-active-sessions`. |
| `DEFERRED_SELF_UPDATE` | The installer source overlaps the target — you are updating the kit's own repository. **Zero files were written.** | Re-run with `--allow-self-update`. |
| `FAILED_SNAPSHOT` | The pre-update snapshot could not be verified, so there would have been no rollback path. Aborted before any write. | Check that a home directory is resolvable and writable, then retry. |
| `FAILED_CONFLICT` | A conflict could not be resolved automatically. Aborted before any write. | Resolve the named file, then retry. |
| `FAILED_VALIDATION` | The target state is invalid — unreadable configuration, unresolvable path, insufficient permissions. Aborted. | Run `node contextkit/tools/scripts/doctor.mjs` and fix what it names. |

### Override a deferral

4. Proceed past detected active sessions.

   ```shell
   npx contextdevkit --update --allow-active-sessions
   ```

5. Proceed when updating the kit's own source repository.

   ```shell
   npx contextdevkit --update --allow-self-update
   ```

6. When both conditions apply, pass both.

   ```shell
   npx contextdevkit --update --allow-active-sessions --allow-self-update
   ```

   One consent never implies the other. This is deliberate: agreeing to update over
   your own live session says nothing about agreeing to mutate the installer while it
   runs.

### Why the session check errs on the side of stopping

The preflight scans the session ledger directory. If it cannot read a ledger file, it
treats that session as **active** and defers. A false stop costs you one command; a
false pass costs you in-flight work.

### Where the rollback lives

Before the first write, the updater snapshots critical state to:

```text
<your home directory>/.contextdevkit/projects/<project-id>/backups/<update-id>/
```

Deliberately **outside** the project, so a bad update cannot damage its own recovery
path. The project id is a deterministic hash of the canonical project path, so the same
project always maps to the same backup location. If the snapshot cannot be verified,
the update aborts rather than proceeding without a way back.

### Roll back

7. Find the snapshot for the update you want to undo.

   ```shell
   ls ~/.contextdevkit/projects/
   ```

8. Copy the snapshotted files back over the project.

   Rollback is a manual file copy today — the snapshot exists so the path is available,
   not so it is automated. Restore the files you need, then re-run the doctor to confirm
   the wiring is coherent:

   ```shell
   node contextkit/tools/scripts/doctor.mjs
   ```

### Resolve a personalisation conflict

9. Find what was stashed.

   ```shell
   ls contextkit/.updates/
   ```

   With a terminal attached, the updater asks you per conflict: keep both, replace with
   the kit's version, or keep yours. Without a terminal it keeps yours and stashes the
   kit's version — and reports `UPDATED_WITH_PENDING_MERGES` so the unresolved state is
   never silent.

10. Diff and merge the pieces you want.

    ```shell
    git diff --no-index contextkit/.updates/v<version>/<file> <file>
    ```

### Only rewire the hooks

11. When the engine is current but the hook wiring is stale — for example after a
    manual level edit — recompose the settings alone.

    ```shell
    npx contextdevkit --rewire --level <1-7>
    ```

    This writes the host settings file and stops. It touches nothing else.

## Verify it worked

```shell
cat contextkit/.engine-version
node contextkit/tools/scripts/doctor.mjs
```

The version file is stamped **last**, only after the engine, hosts, configuration,
conflicts and settings have all landed. That ordering is the guarantee: if the version
file shows the new version, the update completed. If an earlier step threw, the file
still shows the previous version, so an update never half-claims success.

## Troubleshooting

**Symptom:** The update reports `DEFERRED_ACTIVE_SESSIONS` but you have nothing open.
Fix: A previous session ended without registering, leaving its ledger looking live.
Register it (`/log-session`) or re-run with `--allow-active-sessions` once you are sure
nothing is in flight.

**Symptom:** The update said it succeeded but a command still behaves as it did before.
Fix: Restart the host. Hook wiring and command definitions are read at startup.

**Symptom:** The version file shows the new version but a file you personalised looks
untouched by the update.
Fix: That is the contract, not a bug. Check `contextkit/.updates/` for the kit's version
of that file.

**Symptom:** Every update reports `DEFERRED_SELF_UPDATE`.
Fix: You are running the installer from inside the kit's own source tree. That is the
one case where `--allow-self-update` is the normal path rather than an escape hatch.

For anything else, see [troubleshoot](troubleshoot.md).

## Related

- [Install and choose a level](install-and-choose-a-level.md) — the full flag list.
- [Footprint](../reference/footprint.md) — what is written and executed, and how to
  remove it.
- [Cut a release](cut-a-release.md) — the other side of the version story, for
  maintainers.
- [Changelog policy](../reference/changelog-policy.md) — how release history is
  recorded and rotated.
