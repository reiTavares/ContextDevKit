# Operation-owned Decisions (ADRs)

Authoritative Decision Records (schema v2) owned by an **Operation** work context
(`OP-####`). One Markdown file per decision: typed YAML front matter + body.

- Filename: `ADR-####-<slug>.md`.
- Authoring: use `decision.mjs create --context-type operation`; never copy a
  template or write front matter by hand.
- Front matter: validated by `contextkit/runtime/work/schema-decision.mjs`
  (`schemaVersion: 2`, `contextType: operation`, `primaryContext: { type:
  operation, id: OP-#### }`, …).

New decisions are human-accepted; the AI may only propose (`status: proposed`).
Platform-owned standing governance records use `contextType: platform` and are
filed under `../business/` by the canonical generator; folder placement does not
change their typed owner.
