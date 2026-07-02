# Skill — DDD architecture review

> Trigger (§11): domain-driven/distributed profile OR a state-authority change
> OR a public contract OR cross-cutting blast radius.

## layer-honesty

- Domain importing infrastructure (DB/ORM client, transport, router,
  generated persistence types as the domain model) — flag it (S1).
- Business rule in a controller/route/component — it belongs in a
  service/domain layer (H3).
- Persistence leaking into the domain (row shapes, query fragments).

## state-and-contracts

- A **second state authority** for data that already has one is a defect, not
  a style choice (S4).
- A public-contract change without a governing Decision is a refusal, not a
  warning (constitution §8; playbook step `decide`).
- A transaction crossing aggregate boundaries breaks the invariant the
  aggregate exists for.

## structure

- Cross-context deep imports (`context/x/internal/...`) — the contract goes
  through the public surface (S2).
- Technical-only events (CRUD echoes with no domain meaning) add coupling
  without value.
- Packet-vs-diff divergence: every changed line traces to the packet.
- Abstraction or fragmentation without benefit is debt in either direction (H1).

## don't-over-apply

- A thin CRUD app doesn't need a hexagonal cathedral — the *direction* rule
  holds; the *depth* of layering scales with the profile.
