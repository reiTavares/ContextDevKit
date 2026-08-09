# Deliberation is advisory

<!-- GENRE: Explanation (understanding-oriented) -->

ContextDevKit can convene several specialist viewpoints when a decision benefits
from adversarial analysis. The council produces evidence, trade-offs, and a
recommended direction. It does not authorize a write, create an ADR, select a
model, or become a prerequisite for implementation.

## Why it exists

A single reasoning pass can anchor on the first plausible answer. Independent
specialists make assumptions and competing risks visible before the owner makes
the decision. This is especially useful for architecture, security, migrations,
privacy, and irreversible operational choices.

The output is working material. A durable decision is recorded separately in an
ADR only when the owner explicitly chooses to do so.

## Runtime contract

- Invocation is explicit or recommended by the current interaction; it is never
  triggered by an autonomy grade.
- The roster is a recommendation derived from the subject. Missing agents never
  block the caller and never change gate outcomes.
- Scouts, voices, and synthesis are optional phases. Routing and model choices are
  advisory metadata, not dispatch authority.
- Failure, timeout, or partial participation returns diagnostics and lets the
  caller continue.
- The council does not write project state. Any requested artifact is created by
  the canonical writer after an explicit mutation request.

## Relationship to governance

The central gate registry remains the only authority for guarded predicates.
Deliberation is not in the guarded allowlist and cannot deny work. The owner may
accept, revise, or ignore its recommendation while real platform confirmations
continue to protect destructive actions.

See [Governance and enforcement](governance-and-enforcement.md) for the gate
model and [Run a workflow](../how-to/run-a-workflow.md) for durable execution
state.
