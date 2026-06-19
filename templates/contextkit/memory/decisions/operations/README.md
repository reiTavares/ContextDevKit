# Operation-owned Decisions (ADRs)

Authoritative Decision Records (schema v2) owned by an **Operation** work context
(`OP-####`). One Markdown file per decision: typed YAML front matter + body.

- Filename: `ADR-####-<slug>.md`.
- Front matter: validated by `contextkit/runtime/work/schema-decision.mjs`
  (`schemaVersion: 2`, `contextType: operation`, `primaryContext: { type:
  operation, id: OP-#### }`, …).

New decisions are human-accepted; the AI may only propose (`status: proposed`).
The `ROUTINE_OPERATION_GOVERNANCE` standing ADR (pre-authorizing recurring,
low-materiality operations) also lives under this subtree.
