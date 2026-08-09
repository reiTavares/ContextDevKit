# Decision records (ADRs)

This directory stores durable decisions. New records are generated through the
canonical Decision CLI; do not copy `_TEMPLATE.md` or hand-build YAML front
matter. JSON-backed workflow and task state remain separate authorities.

This contract supersedes the authoring instructions in the historical
`0000-record-architecture-decisions.md` seed. Existing copies remain preserved
as accepted project memory, but they are not a current generator or template.

## Canonical document contract

Every newly generated ADR has:

- `schemaVersion: 2` for the machine-readable front matter;
- `documentVersion: 1` for the human-readable Markdown body;
- one explicit owner: `business`, `operation`, or `platform`;
- one closed decision kind and value intent;
- the ordered sections `Decision`, `Decision authority`, `Scope`, `Context
  references`, `Decision drivers`, `Alternatives considered`, `Consequences`,
  `Constraints and invariants`, `Verification`, and `Supersession conditions`;
- a human acceptance source and deterministic SHA-256 decision hash when its
  status becomes `accepted`.

The lifecycle is `proposed -> accepted | rejected -> superseded`. An accepted
record is immutable. Change it by creating a new ADR and linking supersession in
both directions. The `legacy/` subtree is read-only compatibility input and is
never a destination for new decisions.

Physical placement is `business/` for Business and Platform records and
`operations/` for Operation records; `contextType` remains the ownership
authority, never the folder name.

## Canonical commands

```shell
# Discover coverage and the fleet-safe next ADR number.
node contextkit/tools/scripts/decision.mjs search --objective "decision topic" --json
node contextkit/tools/scripts/intake-collision-gate.mjs --json

# Preview, create, validate, and explicitly accept.
node contextkit/tools/scripts/decision.mjs create --id ADR-0001 --kind ARCHITECTURE --context-type operation --primary-context OP-0001 --title "Decision title" --json
node contextkit/tools/scripts/decision.mjs create --id ADR-0001 --kind ARCHITECTURE --context-type operation --primary-context OP-0001 --title "Decision title" --apply --json
node contextkit/tools/scripts/decision.mjs validate --file contextkit/memory/decisions/operations/ADR-0001-decision-title.md --json
node contextkit/tools/scripts/decision.mjs accept --id ADR-0001 --actor human --apply --json
```

Acceptance is permitted only after an explicit human decision. Deliberation and
swarm are not universal ADR prerequisites, but they are required when the
current owner instruction, selected workflow/skill, or governed classification
explicitly activates them. Specialist routing recommends the executor and never
authorizes the coordination; missing legacy receipt fields cannot veto it.

## Contrato canônico (pt-BR)

Toda ADR nova deve ser criada pelo comando `decision create`, nunca copiando
`_TEMPLATE.md`. O front matter usa `schemaVersion: 2`; o corpo usa
`documentVersion: 1` e as seções obrigatórias acima. O aceite humano grava um
hash SHA-256 determinístico. ADR aceita não é reescrita: uma mudança exige outra
ADR com vínculo de substituição. A pasta `legacy/` serve apenas para leitura de
compatibilidade. Debate e swarm não são requisitos universais, mas tornam-se
obrigatórios quando a instrução atual, o workflow/skill selecionado ou a
classificação governada os ativa. O roteamento apenas recomenda o executor e
não pode vetar a coordenação por falta de campos legados.
