# Skill — Modular design

> Trigger (§11): DAS in the modular band (25–44) OR the change crosses more
> than one module. Structural discipline **without** domain-model ceremony.

## boundaries

- Each touched module keeps a deliberate public surface; callers depend on the
  contract, not the guts (S2). If a caller needs an internal, promote it on
  purpose.
- Dependencies point inward (S1): shared pieces are extracted, never reached
  into.

## coupling

- No import cycles; break one by extracting what both sides need or inverting
  a direction with an interface (S3).
- High fan-out is a missing decomposition; high fan-in on a *changing* module
  is the smell (stable primitives are fine).

## contracts

- A cross-module change states its contract impact in `contract-notes`: what
  is exported, what changed shape, who consumes it.
- Derived data is computed, not stored twice (S4).

## refusals

- Refuse barrel/index ceremony on a two-file feature.
- Refuse an abstraction that only adds bouncing (H1 fragmentation).
- Refuse domain-model ceremony (aggregates, repositories) at this band —
  escalate the profile instead if the domain genuinely demands it.
