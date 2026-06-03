# ADR-0000: Record architecture decisions

- **Status**: Accepted
- **Date**: 2020-01-01
- **Deciders**: ContextDevKit

## Context

Significant architectural choices on a project get made in conversations, chat
logs, and people's heads — then forgotten. Six months later nobody remembers why
the datastore was chosen, why a library was rejected, or what constraint a
strange-looking design protects. AI coding sessions make this worse: each fresh
session starts blind unless the *why* is written down somewhere durable.

## Decision

We will record every significant architectural decision as an **Architecture
Decision Record (ADR)** — a numbered, immutable markdown file in
`contextkit/memory/decisions/`, following Michael Nygard's format
(Context / Decision / Consequences).

- Create one with `/new-adr <title>` **before** implementing the decision.
- ADRs are **immutable once Accepted**. To change a decision, write a NEW ADR
  that supersedes the old one and update the old one's status.
- The immutable rules in `CLAUDE.md` should each point to the ADR that justifies
  them.

## Consequences

- **Positive**: durable institutional memory; new sessions (human or AI) can
  reconstruct intent; debates don't get re-litigated.
- **Trade-off**: a small ritual cost per decision. Worth it — the alternative is
  silent drift.
- **Follow-up**: keep ADRs short. They capture *why*, not implementation detail.
