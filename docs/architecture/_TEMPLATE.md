# Architecture: <Subsystem or feature name>

<!-- GENRE: Architecture (system-shape / design)
     Goal: describe components, boundaries, data flow, and the decisions that
           shaped the current design — enough for a new contributor to build a
           correct mental map and to reason about safe change points.
     Voice: precise and structural; diagrams preferred over long prose.
     Rule: no tutorial steps, no API reference rows.  Link to those. -->

## Purpose and scope

<!-- One paragraph: what this subsystem does and where its boundary lies.
     Name the consumers (who calls it) and the dependencies (what it calls). -->

## Component map

<!-- ASCII diagram or prose list of the major components and their relationships.
     Keep to the level of detail a developer needs to navigate the code.
     Example format: -->

```
[Component A] --> [Component B] --> [Store]
      |
      v
[Component C]
```

## Data flow

<!-- Walk through the primary happy-path data flow from trigger to output,
     referencing the components named above.  One numbered step per hop.
     Highlight any async boundaries, queues, or external I/O points. -->

1. Trigger: <event or call site>.
2. Component A receives X and produces Y.
3. Component B persists Y to Z.

## Key interfaces

<!-- The public contracts (function signatures, event shapes, config keys) that
     cross the subsystem boundary.  Do NOT duplicate the full reference here —
     link to the reference page and quote only the load-bearing types/shapes. -->

## Constraints and invariants

<!-- Non-negotiable rules the implementation must respect (e.g., "must exit 0
     on error", "single writer", "idempotent").  Each as a brief bullet. -->

- Invariant one.
- Invariant two.

## Significant past decisions

<!-- Two to five decisions that are "load-bearing" for the current shape.
     Each gets a bold label, a one-sentence summary, and a link to the ADR
     or explanation doc where the reasoning lives.  Do not repeat the reasoning. -->

**Decision: <label>** — summary. See the relevant `docs/explanation/<topic>.md`.

## Open questions / known limitations

<!-- Honest list of unresolved design questions or known constraints that the
     next person to change this subsystem should be aware of. -->

## Related

<!-- Links to how-to guides for operating this subsystem, the reference page for
     its API, the explanation doc for the core concept, and any ADRs. -->
