# How to troubleshoot an install

<!-- GENRE: How-to guide (task-oriented)
     Goal: reader turns a confusing symptom into a named cause and a command.
     Voice: direct, imperative.
     CONTRACT: every symptom here was OBSERVED, not imagined. If a failure mode
     cannot be reproduced, it does not belong on this page. -->

## When to use this guide

Something disagrees: a command you were told to run does not exist, an edit is blocked
and you do not know why, the kit reports a level that is not the one you set, or a gate
fails without naming a cause you recognise.

Start here, then use the specific guides:
[install and choose a level](install-and-choose-a-level.md),
[upgrade and update](upgrade-and-update.md),
[configuration reference](../reference/config.md).

## First: ask the kit what it thinks

Two read-only commands answer most questions before you change anything.

```shell
node contextkit/tools/scripts/doctor.mjs
node contextkit/tools/scripts/config-health.mjs
```

The doctor reports the node version, whether the configuration is valid and at which
level, whether the paths in your configuration lists actually exist, whether the hook
wiring matches the level, which git hooks are installed, and the install mode. Treat
each line it flags as the next task.

The health check separates damage it can repair from damage that needs you. That
distinction is the point: a list flattened by a bad merge cannot be reconstructed from
the file alone, so it says `manual_repair_required` and names the key rather than
guessing at your original values.

## An edit is blocked

### The blast-radius gate stopped a high-risk path

**Symptom:** An edit to a path is refused with a message about the impact gate.

**Cause:** From level 5, paths listed in `l5.highRiskPaths` require a recorded impact
analysis before they can be edited.

**Fix:** Check the path directly, then satisfy the gate rather than removing it.

```shell
node contextkit/tools/scripts/guard.mjs <path>
```

Exit 0 means allowed; exit 1 means blocked. When it blocks, run the impact-simulation
skill for that path — the refusal names the corrective command. Lowering the gate to get
past one edit disables it for every other path too.

### A workflow phase is blocking source edits

**Symptom:** Any source edit is refused, citing an active workflow parked before its
ship phase — and sometimes a workflow you did not create.

**Cause:** The phase-aware guard blocks source edits while a pre-ship workflow exists on
the current branch. It stops at the first active workflow it finds on that branch, which
may belong to a **parallel session** sharing the same working tree.

**Fix:** First see what is actually active and where each workflow is parked.

```shell
node contextkit/tools/scripts/workflow-assist.mjs --list
```

Then, depending on whose workflow it is:

- **Yours, and the design work is done.** Advance it. Missing deliverables are named in
  the refusal, so the message tells you what to fill.

  ```shell
  node contextkit/tools/scripts/workflow.mjs advance <slug>
  ```

- **Yours, but you need the roadmap phase to pass and the work is not a roadmap item.**
  Pass an explicit non-applicable reference rather than forcing the phase.

  ```shell
  node contextkit/tools/scripts/workflow.mjs advance <slug> --ref not-applicable
  ```

- **Another session's.** Do not advance or force it. Forcing marks phases as satisfied
  that were never done, which corrupts that context's governance record. Coordinate with
  whoever owns it, or move your work to its own branch or worktree.

Note that markdown files are exempt from this guard, so documentation work continues
while source edits are blocked.

### A completion gate refuses to let the task close

**Symptom:** You are told the task lacks completion evidence and cannot be declared
done.

**Cause:** The gate wants receipts, not prose. "The tests passed" is not evidence; only
script output satisfies it.

**Fix:** Produce the named evidence. The refusal lists exactly which pieces are missing
— typically a test plan, a test run, a QA sign-off and a session log. Run each one; the
gate clears itself when the receipts exist. A refusal here is the gate working, not a
bug.

## A command does not exist

**Symptom:** `Cannot find module` for a script a document or an agent told you to run.

**Cause:** A drifted reference. Script names are not guessable.

**Fix:** List what is actually there before trusting any name.

```shell
ls contextkit/tools/scripts/
```

Two specific traps worth naming, because they are easy to assume:

- The diagnostic is `doctor.mjs`. There is no `context-doctor.mjs`, despite the command
  being called from the host by a similar name.
- There is no `state.mjs`. The bounded context summary is `context-pack.mjs`.

If a document in this repository sends you to a script that does not exist, that is a
documentation defect — the reference pages are generated from the registry precisely to
stop this, and a hand-written command reference is exactly where it recurs.

## The level or the hooks look wrong

### The level reported differs from the level you set

**Symptom:** `context-level.mjs` and the boot banner disagree.

**Cause:** Hook wiring is read once when the host starts.

**Fix:** Restart the host. If they still disagree afterwards, the configuration is
likely unreadable — run the doctor, which validates it and reports the level it managed
to parse.

### Hooks behave as they did before a change

**Symptom:** You changed the level or updated the kit, and behaviour is unchanged.

**Fix:** Restart the host. If the engine is current but the wiring is stale — for
example after editing the level key by hand instead of using the command — recompose
just the settings:

```shell
npx contextdevkit --rewire --level <1-7>
```

### The level moved on its own after a re-run

**Symptom:** Re-running the installer appeared to change the level.

**Cause:** Without an explicit `--level`, the installer reads the current level from the
configuration and preserves it. A level that moved anyway means the configuration could
not be read.

**Fix:** Run the doctor, fix what it names, then set the level explicitly.

## A configuration list is damaged

**Symptom:** `config-health.mjs` reports `manual_repair_required` and names a key —
commonly a path list whose entries collapsed into a bare directory.

**Cause:** A merge or a hand edit flattened the list. The original entries are not
recoverable from the file.

**Fix:** Restore the affected list by hand in `contextkit/config.json`. Read the finding
in full first:

```shell
node contextkit/tools/scripts/config-health.mjs --json
```

Then confirm the shape of what you wrote:

```shell
node contextkit/tools/scripts/context-config.mjs show <key>
```

## Kit files appear in git and you did not want that

**Symptom:** Platform files show up in `git status`.

**Cause:** The install used `--tracked`, which skips the local exclude block.

**Fix:** Re-run without the flag. It rewrites the exclude block and never touches your
index or your edits.

```shell
npx contextdevkit --target . --update
```

The reverse warning also exists and is deliberate: the doctor flags a local-only install
in a repository that has a remote, because teammates, other machines and CI will never
see the kit. That is correct for solo work and wrong for a team.

## A documentation gate fails

**Symptom:** The public-docs lint exits fatally with a path outside your project — a
drive root rather than the repository.

**Cause:** In an installed copy, the lint resolves its policy file relative to its own
location, which is correct for the source tree and wrong for the installed one.

**Fix:** Pass the root explicitly.

```shell
node contextkit/tools/scripts/docs-public-lint.mjs --root .
```

**Symptom:** The docs self-check reports the navigation index as non-idempotent, or a
page as unclassified.

**Cause:** New pages exist that are not yet classified into the projection scopes, or
the generated index has not been regenerated since they landed.

**Fix:** Classify each new page in the projection policy, then regenerate the index:

```shell
node contextkit/tools/scripts/docs-reindex.mjs
```

Regeneration is idempotent and never moves or deletes a content file, so running it is
safe. An unclassified page is a real gap, not noise — an unscanned page is how a leak
reaches a public path.

## Workflow numbers are not contiguous

**Symptom:** Two workflows under the same owner are numbered with a gap between them.

**Cause:** Workflow numbering is a single global sequence across every context, not a
per-owner counter. A parallel session allocating numbers in between produces a legitimate
gap.

**Fix:** Nothing. This is correct behaviour. Never renumber to close a gap — the number
is an identity, and other artifacts reference it.

## An update refuses to run

See [upgrade and update](upgrade-and-update.md) for the full outcome table. The short
version: a deferral is a successful refusal that wrote nothing, and the two override
flags are separate consents on purpose.

## Still stuck

Collect the machine-readable state before asking for help, so the answer does not start
with guesswork:

```shell
node contextkit/tools/scripts/doctor.mjs --json
node contextkit/tools/scripts/config-health.mjs --json
node contextkit/tools/scripts/workflow-assist.mjs --list
```

For a suspected vulnerability rather than a defect, follow [the security
policy](../../SECURITY.md) instead of opening a public issue.

## Related

- [Install and choose a level](install-and-choose-a-level.md)
- [Upgrade and update](upgrade-and-update.md)
- [Configuration reference](../reference/config.md)
- [Footprint](../reference/footprint.md) — what is on disk, and how to remove it
- [Governance and enforcement](../explanation/governance-and-enforcement.md) — why a
  gate blocks, and what `skipped` means
