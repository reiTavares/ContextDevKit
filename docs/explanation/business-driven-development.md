# Business-driven development

ContextDevKit preserves durable business and operation contexts when the work
actually needs them, but most requests do not.

Interaction classification happens first. Conversation and exploration are
inert. A confirmed mutation resolves existing work, then classifies nature as
`business`, `operation`, `none`, or `unclassified`:

- `business`: a durable strategic capability/decision with outcome, sponsor,
  KPI, and horizon;
- `operation`: durable maintenance, incident, or refactor work inside an
  existing capability;
- `none`: ordinary feature, bug, docs, or small direct change;
- `unclassified`: insufficient evidence, requiring one short clarification.

Execution shape is independent: one to three cohesive tasks are direct; four to
twelve related unordered tasks are a batch; dependencies, waves, multi-session
work, cutover, rollback, or mandatory ordering require a workflow. Business,
architecture vocabulary, ADRs, or compliance words do not force a workflow by
themselves.

Durable context is created only after existing-work resolution and explicit
mutation intent. There is no default Operation fallback.
