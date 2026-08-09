# How to run a business case from intent to an active workflow

## When to use this guide

You have a goal — a capability to build, a problem to fix — and you want it to enter
the project as governed work rather than as an untracked edit. This guide covers the
path from an unclassified objective to a workflow that is open, nested under its
owner, and ready for its phase ladder.

It covers both natures of work: a **business** context for a durable strategic
capability, and an **operation** context for work inside something that already
exists. For the model behind the split, read
[business-driven development](../explanation/business-driven-development.md); for
what happens once the workflow is open, read
[run a workflow](../how-to/run-a-workflow.md).

## Prerequisites

- ContextDevKit installed in the project, with the platform directory present at the repository root.
- Node.js 18 or newer on the path.
- A shell opened at the repository root. Every command below is relative to it.
- Familiarity with the two natures of work and the ceremony vocabulary — see the [glossary](../reference/glossary.md).

## Understand the posture before you start

Two rules govern every command here.

**Mutators are dry-run by default.** Without `--apply`, a command computes the full
plan, prints the exact paths it would write, and writes nothing. Run the dry-run
first, read the plan, then re-run with `--apply`. This is not a safety ritual you can
skip to save a step — the dry-run is the only place a wrong id or a wrong ceremony is
cheap to notice.

**Every command returns a receipt.** The receipt names the command, whether it
applied, the mode, and each path written or planned. Add `--json` for the structured
form. That receipt is the evidence a gate accepts; a message asserting success is not.

## Steps

1. **Confirm the toolchain answers before you commit to anything.** Both commands are
   read-only.

   ```shell
   node contextkit/tools/scripts/doctor.mjs
   node contextkit/tools/scripts/work.mjs intake --check --json
   ```

   The second prints `"ready": true` with the reason
   `work-classification policy loaded`. If it reports `ready: false`, stop — the
   classifier cannot resolve its policy and every classification after this point
   would be guesswork.

2. **Classify the objective.** Intake is read-only; it reads your objective and
   resolves nature, tier, execution mode, whether a governing decision is needed, and
   whether an existing business context looks like the owner.

   ```shell
   node contextkit/tools/scripts/work.mjs intake "Create a self-serve onboarding capability so small teams can start without a sales call" --json
   ```

   Read `detail.nature`, `detail.tier`, and `detail.executionMode`. If
   `needsClarification` is `true`, the classifier is telling you it could not separate
   the two natures confidently, and `clarifyQuestion` is the question to answer. The
   recorded default in that case is `operation` — the conservative choice, since an
   operation can be promoted later but a business filed as routine work would have
   bypassed its own approval.

3. **Choose the nature deliberately.** Intake advises; the create verb decides. Pick
   `business` when the work creates or changes a durable strategic capability with its
   own outcome to defend. Pick `operation` when it fixes, maintains, or executes inside
   something that already exists. Then follow step 4a or 4b — not both.

4. **(a) Create a business context.** Preview first, then apply. `--kind` is required
   and closed: `TRANSFORMATION`, `INITIATIVE`, `PROGRAMME`, `FEATURE`, or `ENABLER`.
   `--ceremony` is `decision` (one governed decision) or `workflow` (a multi-workflow
   programme). `--intent` is the value intent, defaulting to `CREATE`.

   ```shell
   node contextkit/tools/scripts/work.mjs business "Self-serve onboarding for small teams" --kind FEATURE --ceremony decision --intent CREATE
   node contextkit/tools/scripts/work.mjs business "Self-serve onboarding for small teams" --kind FEATURE --ceremony decision --intent CREATE --apply
   ```

   The identifier is allocated for you across the whole worktree fleet, so parallel
   sessions cannot mint the same one. The dry-run lists the case files the context
   will carry — the business case, the growth model, the investment decision — plus the
   ceremony directory for the shape you chose. Applying it publishes the whole
   aggregate through a single atomic rename, so you never see a half-written context.

5. **(b) Create an operation context — and pass the identifier explicitly.** Same
   dry-run-then-apply posture. `--mode` is `direct` or `batch`; the `workflow` mode is
   refused here on purpose, because a workflow-mode operation is materialized by the
   workflow engine in step 7.

   ```shell
   node contextkit/tools/scripts/work.mjs operation "Fix the broken retry counter in the billing webhook" --id OP-0042 --mode direct --intent RECOVER
   node contextkit/tools/scripts/work.mjs operation "Fix the broken retry counter in the billing webhook" --id OP-0042 --mode direct --intent RECOVER --apply
   ```

   > **Always pass `--id OP-####` for an operation.** There is a real defect in the
   > operation create path: when `--id` is omitted it falls back to a hardcoded first
   > identifier instead of calling the fleet-aware allocator that the business path
   > uses. The failure is silent — the create succeeds, the receipt looks clean, and you
   > end up with a second context wearing an identifier that already belongs to
   > another. This has already happened in this repository, which carries three
   > distinct operations all numbered `OP-0001`. Duplicate identifiers break the link
   > between a decision and the work it governs, and nothing downstream detects it for
   > you. Until the allocator is wired in, ask it for the next free identifier yourself
   > and pass the answer:

   ```shell
   node -e "import('./contextkit/tools/scripts/registry/ids.mjs').then(m=>console.log(m.nextOperationId(process.cwd())))"
   ```

6. **Link the operation to the business whose value it borrows.** Optional, and only
   for an operation. This is how a fix stays connected to the capability it protects.
   The command is idempotent — a second run against the same pair writes nothing.

   ```shell
   node contextkit/tools/scripts/work.mjs link --id OP-0042 --biz BIZ-0001
   node contextkit/tools/scripts/work.mjs link --id OP-0042 --biz BIZ-0001 --apply
   ```

7. **Open the workflow, declaring its owner.** The owner flag is what nests the
   workflow inside its parent context. Pass exactly one.

   ```shell
   node contextkit/tools/scripts/workflow.mjs new onboarding-first-slice --business BIZ-0001
   node contextkit/tools/scripts/workflow.mjs new retry-counter-fix --operation OP-0042
   ```

   The command prints the created slug and the next phase. Never hand-pick the
   workflow number: it comes from one global sequence, reconciled across worktrees and
   inclusive of concluded work, so an identifier is never reused.

8. **Rebuild the registries from disk.** Creating a context or a workflow writes the
   artefacts but does not update the three registries the gates and the projection
   read. Rebuild them explicitly. The dry-run reports the counts it found; `--apply`
   writes the three files atomically, and a second run on the same disk state produces
   the same bytes.

   ```shell
   node contextkit/tools/scripts/work.mjs reconcile
   node contextkit/tools/scripts/work.mjs reconcile --apply
   ```

   Do this after every create step, not once at the end. A registry that has not caught
   up is why a freshly created context can look invisible to the commands in step 9.

9. **Ask the engine for the next step rather than guessing it.** Both commands are
   read-only and derive their answer from the journey the owner's ceremony resolved to.

   ```shell
   node contextkit/tools/scripts/work.mjs map --id BIZ-0001
   node contextkit/tools/scripts/work.mjs next --id BIZ-0001
   ```

   `map` prints the resolved shape, journey branch, current phase, current stage, and
   the next command. `next` prints the next command alone, which makes it the one to
   use in a script. Both need the registries to exist — see the first verification
   check below.

   > **Read the projected shape for a business context with care.** The projection
   > derives the shape from a classification block that the create path does not
   > persist, so a business context reports `decision-only` and the
   > `business-decision` branch even when you created it with `--ceremony workflow`.
   > The authoritative record of the ceremony you chose is the create receipt and the
   > directory layout on disk: a `workflow` ceremony materializes a
   > `workflows/WF-####-<slug>/` pack, while a `decision` ceremony materializes
   > `ceremony/decision-only/`. Trust those over the projected line until the create
   > path records the classification.

## Verify it worked

Three checks, in order of what they prove.

The workflow is nested under its owner, not loose. List the owner's workflow
directory and confirm the pack is inside it — an owned workflow that lands anywhere
else has lost its ownership record.

```shell
node contextkit/tools/scripts/workflow.mjs status onboarding-first-slice
```

The expected shape is one line naming the slug and its current phase, followed by the
nine phases with their status. A newly opened workflow reads
`current: intake` with every phase `pending`.

The context itself is schema-valid, and the registries the gates read are present:

```shell
node contextkit/tools/scripts/work.mjs validate --id BIZ-0001 --json
node contextkit/tools/scripts/work.mjs reconcile --check --json
```

`validate` returns `"valid": true` with an empty `errors` array. `reconcile --check`
returns `"allPresent": true` across the work-context, workflow, and decision
registries. A registry reported as absent means the gates that consult it will report
`skipped` — which is never a pass, and will not stand in for one.

And the governance gate tells you honestly what the context still owes:

```shell
node contextkit/tools/scripts/work.mjs status --id BIZ-0001 --json
```

For a freshly created case, `gate.pass` is `false` and `gate.reasons` names each
missing precondition: the status is still `draft` rather than human-approved, no
approval actor is stamped, and no governing decision is attached yet. That is the
correct state for a case nobody has approved. A gate that passed here would be the
bug.

## Troubleshooting

**Symptom:** `approve` fails with `transitions "draft" → "confirmed" which is not a
legal move. Allowed targets from "draft": proposed`.
The lifecycle requires the case to be proposed before it can be approved, and the
command surface wired today exposes `approve`, `revise`, and `reject` but no verb that
performs the `draft` to `proposed` transition. A case created through the create verb
therefore cannot be advanced to approval through the CLI alone. Treat the `draft`
context as the artefact to fill in — the business case, growth model, and investment
decision files — and raise the missing transition rather than editing the status field
by hand. Hand-editing lifecycle state defeats the revision history that makes the
approval auditable.

**Symptom:** `approve` fails with `actor "agent" is not "human"`.
Working as designed, and not overridable. Approving a business case requires
`--actor human`; no autonomy grade or configuration weakens it. The same floor applies
to closing a case and to re-parenting a governed entity. If you are an agent reading
this: the answer is to ask, not to find another route.

**Symptom:** `status --id OP-0042` fails looking for a `business.json`.
The `status` verb reads business contexts only. For an operation, use
`validate --id OP-0042` for schema validity and `map --id OP-0042` for its journey
position.

**Symptom:** `next` or `map` prints nothing and reports `"status": "skipped"`.
The command could not resolve a single unambiguous active context, or the journey and
ceremony manifest were unreadable. Pass the identifier explicitly with `--id`. The
silence is deliberate: discoverability degrades to skipped rather than inventing a
next step it cannot derive.

**Symptom:** a `close` on a business case is refused for its outcome reference.
Closing is a governed outcome decision. It requires `--actor human`, a `--status` of
`validated`, `partially-validated`, or `closed`, and an `--outcome-ref` pointing at a
report file that actually exists inside the repository. You cannot close a case by
asserting the outcome.

## Related

- [Business-driven development](../explanation/business-driven-development.md) — the model, the ceremonies, and the invariants behind these commands.
- [Your first business case](../tutorials/first-business-case.md) — the same path as a guided first pass.
- [Run a workflow](../how-to/run-a-workflow.md) — the phase ladder once the workflow is open.
- [Governance and enforcement](../explanation/governance-and-enforcement.md) — what the gates block, what they only warn about, and how they degrade.
- [Glossary](../reference/glossary.md) — each term above mapped to its identifier in the code.
