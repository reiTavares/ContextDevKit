# Skill: tune-agents

> Propose evidence-backed refinements to agent briefings without applying them.
# Tune agents

Generate a review proposal from current roster data and authored session memory:

```text
node contextkit/tools/scripts/agent-tuning.mjs --json
```

Use concrete outcomes to identify false positives, blind spots, and unclear role
descriptions. Draft small before/after briefing edits in
`.agent-tuning-proposal.md`; apply nothing. Routing remains a recommendation, so
the proposal must not introduce required-agent floors, dispatch receipts, or
blocking behavior. A later user-approved application is a separate mutation.
