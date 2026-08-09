# Run a governed business or operation case

Use this guide when a confirmed mutation needs durable Business or Operation memory. Most code changes do not.

For the model behind the split, read [Business-Driven Development](../explanation/business-driven-development.md). For execution loops, read [Evidence-Driven Loop Engineering](../explanation/loop-engineering.md).

## 1. Let interaction classification happen first

Do not create a Business, Operation, task, or Workflow for conversation or read-only exploration.

A real mutation should first resolve through the normal intake path. You can inspect classification without creating work:

```shell
node contextkit/tools/scripts/work.mjs intake "<objective>" --json
```

The receipt can report interaction/work signals such as:

- work nature: `business | operation | none | unclassified`;
- execution shape: `direct | batch | workflow`;
- complexity/tier;
- decision need/match;
- suggested Business relationship;
- clarification when evidence is genuinely ambiguous.

`work intake` is read-only by design.

## 2. Treat `none` as a valid answer

Do **not** create an Operation merely because the request changes code.

Use `none` for ordinary work that does not benefit from durable strategic or operational ownership, such as a focused feature, localized bug, docs edit, or small technical improvement.

A Business or Operation exists only when forgetting that durable context would harm the project.

## 3. Choose Business when the durable why matters

Create a Business when the work represents a long-lived strategic capability, product, initiative, or decision with an outcome worth preserving across future work.

Examples:

- a new product or market;
- a strategic platform capability;
- a multi-month initiative;
- a durable compliance capability;
- a portfolio/roadmap outcome with independent value.

Use the `work business` command and follow its current CLI help for required fields:

```shell
node contextkit/tools/scripts/work.mjs business --help
```

Preview/apply behavior belongs to the command itself; do not infer a universal write switch from older documentation.

## 4. Choose Operation when the durable operational reason matters

Create an Operation for work such as:

- incident/recovery activity;
- a maintenance programme;
- dependency modernization;
- reliability work;
- a durable group of related refactors or corrections.

Use:

```shell
node contextkit/tools/scripts/work.mjs operation --help
```

Operation is not the fallback for every technical change.

## 5. Link an Operation to Business only with sufficient evidence

The Business matcher may suggest a likely parent for an Operation. It uses deterministic evidence and refuses weak matches.

A suggestion is not confirmation.

If the relationship is correct, confirm/link it through the supported work command rather than editing JSON by hand:

```shell
node contextkit/tools/scripts/work.mjs link --help
```

The matcher never sets `confirmed` ownership by itself.

## 6. Choose execution shape independently

Work nature and execution shape are separate decisions.

### direct

Use for a small set of cohesive tasks, usually one to three.

### batch

Use for several related tasks, usually four to twelve, that do not need strong ordering.

### workflow

Use a Workflow for real execution topology:

- multiple waves;
- dependencies between task groups;
- required ordering;
- multi-session work;
- coordinated integration;
- cutover/rollback;
- explicit Workflow intent.

Business does not imply Workflow. Operation does not imply Workflow.

## 7. Resolve existing work before creating another Workflow

A confirmed mutation may already belong to explicit or likely existing work.

The existing-work signal can distinguish:

```text
explicit | inferred | ambiguous | new | none
```

Do not silently select an ambiguous item. Do not silently reopen completed work.

If the user explicitly wants to continue/reopen existing work, resolve that item first.

## 8. Create a Workflow only when needed

For real Workflow topology:

```shell
node contextkit/tools/scripts/workflow.mjs new <slug> --operation OP-####
node contextkit/tools/scripts/workflow.mjs new <slug> --business BIZ-####
```

Use one owner flag when the Workflow is owned. Neutral Workflows are also valid when no Business/Operation ownership is justified.

The Workflow creator writes the complete v2 package atomically, including canonical definition/state, task store, authored context, context manifest, and reports directory.

## 9. Execute from the canonical package

Before mutation, load the Workflow context rather than relying on memory of a prior prompt:

```shell
node contextkit/tools/scripts/workflow.mjs load <ref>
```

The package carries PRD, SPEC, decisions, task state, context manifest, and reports.

Run tasks through the canonical task store. `pipeline/tasks.json` is task authority; `tasks.md` is a projection.

## 10. Let evidence drive completion

The normal engineering cycle is:

```text
implement
  ↓
evaluate
  ↓
findings
  ↓
correct
  ↓
fresh evaluation
  ↓
done
```

QA rejection can return a task from `testing` or `done` into a fresh backlog cycle. Current-cycle evidence is reset where required so prior green evidence cannot approve the corrected implementation automatically.

A completed Workflow can reopen when later feedback invalidates one of its completed tasks.

## 11. Quality floors and owner authority

Three domains are guarded by default:

- QA sign-off;
- applicable deterministic DDD Class A invariants;
- new high/critical Technical Debt introduced by the current diff.

Architecture Debt remains canary, and Privacy/LGPD remains shadow by default.

The owner can configure modes and use a scoped override without rewriting evidence into a pass.

## Verify the case

Useful read-only checks include:

```shell
node contextkit/tools/scripts/work.mjs intake "<objective>" --json
node contextkit/tools/scripts/workflow.mjs status <ref> --json
node contextkit/tools/scripts/workflow.mjs validate <ref>
node contextkit/tools/scripts/pipeline.mjs validate --tasks <scope>
```

When a command or optional registry is unavailable, report that honestly. Do not invent ownership, state, or a next step from stale documentation.

## Related

- [Business-Driven Development](../explanation/business-driven-development.md)
- [Evidence-Driven Loop Engineering](../explanation/loop-engineering.md)
- [Anatomy of a Business, Operation & Workflow](anatomy-of-business-operation-workflow.md)
- [Run a Workflow](run-a-workflow.md)
- [Governance and enforcement](../explanation/governance-and-enforcement.md)
- [Glossary](../reference/glossary.md)
