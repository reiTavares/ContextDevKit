# ADR reference template — do not copy

> Compatibility/reference document only. Create every new ADR with
> `node contextkit/tools/scripts/decision.mjs create ...`; the generator owns
> schema-v2 front matter, document-versioning, required sections, and validation.
>
> Documento apenas de referência/compatibilidade. Não copie este arquivo. Use o
> gerador canônico para criar uma ADR nova.

## Context

The generator creates a proposed record under the owning Business, Operation,
or Platform context. It refuses legacy creation and incomplete classifications.

## Decision

Use the canonical Decision CLI and the contract documented in `README.md`.
Human acceptance is explicit and stamps a deterministic decision hash.

## Consequences

- Generated ADRs share one machine and human-readable standard.
- Accepted records remain immutable and are changed through supersession.
- This compatibility template is not a second authoring path.
