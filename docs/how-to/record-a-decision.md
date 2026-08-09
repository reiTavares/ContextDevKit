# Record a decision

<!-- GENRE: How-to (task-oriented) -->

Create an ADR when a material choice needs durable rationale. Deliberation can
help, but it is advisory and never authorizes the write.

## 1. Check for an existing decision

```shell
node contextkit/tools/scripts/adr-digest.mjs --search "decision topic"
```

If an accepted record already governs the choice, supersede it rather than
editing its conclusion in place.

## 2. Gather competing evidence when useful

Use `/debate` or the host equivalent for architecture, security, migration,
privacy, or other consequential trade-offs. Its output is working material; the
owner can accept, revise, or ignore the recommendation.

## 3. Create and review the ADR

```shell
node contextkit/tools/scripts/decision.mjs create \
  --id ADR-0001 \
  --kind ARCHITECTURE \
  --title "Decision title" \
  --primary-context OP-0001 \
  --apply
```

Fill Context, Decision, Alternatives, Consequences, rollback, and validation.
Keep unknown external facts explicit. Mark the record accepted only with the
owner's actual decision.

## 4. Link execution explicitly

If the decision creates implementation work, add tasks to one named workflow or
batch with `pipeline.mjs add --tasks <scope>`. ADR creation never seeds tasks or
dispatches agents automatically.

## Verify

- The ADR has a stable id, status, owner context, and factual rationale.
- Supersession links are reciprocal when applicable.
- Any execution task has an explicit `evidenceRefs` link to the ADR.
- No other project state changed unless it was part of the explicit request.

See [Deliberation is advisory](../explanation/deliberation-council.md) and
[Run a workflow](run-a-workflow.md).
