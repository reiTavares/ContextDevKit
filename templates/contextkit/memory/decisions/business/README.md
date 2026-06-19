# Business-owned Decisions (ADRs)

Authoritative Decision Records (schema v2) owned by a **Business** work context
(`BIZ-####`). One Markdown file per decision: typed YAML front matter + body.

- Filename: `ADR-####-<slug>.md`.
- Front matter: validated by `contextkit/runtime/work/schema-decision.mjs`
  (`schemaVersion: 2`, `contextType: business`, `primaryContext: { type:
  business, id: BIZ-#### }`, …).
- Exemplar: `ADR-0102-business-driven-methodology.md`.

Legacy plain-markdown ADRs are NOT placed here — see `../legacy/`. New decisions
are human-accepted; the AI may only propose (`status: proposed`).
