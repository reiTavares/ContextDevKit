# Skill — Domain modeling

> Trigger (§11): DAS ≥ 45 OR a domain hard trigger. Never fires for simple
> CRUD (proportionality invariant — profile floor lives in the DAS bands).

## model-the-intent

- Turn intent and rules into an **explicit model**: bounded contexts,
  ubiquitous language (record it in `GLOSSARY.md`), entities vs value objects,
  commands / queries / events.
- Name the **state authority** for every piece of state — one source of truth
  (S4); immediate vs eventual consistency is a modeling decision, not an
  accident.
- Draw **transactional boundaries** around real invariants; cross-context
  relations go through explicit contracts, never deep imports (S2).

## aggregates-earn-their-place

- An aggregate exists ONLY to protect an invariant. No invariant → no
  aggregate — a plain record is fine.
- Not every table is an entity; not every noun needs a repository.

## refusals

- Refuse to invent rules the business never stated.
- Refuse to make every table an entity.
- Refuse to create an aggregate without an invariant.
- Refuse to demand a repository by default.
- Refuse to apply full hexagonal ceremony to simple CRUD.
