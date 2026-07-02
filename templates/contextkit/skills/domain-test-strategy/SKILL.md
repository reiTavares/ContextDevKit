# Skill — Domain test strategy

> Trigger (§11): DAS ≥ 25 OR behavioral acceptance criteria OR state
> transitions OR a contract change — on code work.

## what-to-test

- **Invariants** — the rule an aggregate protects gets a test that fails when
  the rule is broken, not a snapshot.
- **Value objects** — equality, validation, immutability at the boundary.
- **State transitions** — every declared transition, plus the forbidden ones
  (the negative path is the point).
- **Commands** — valid and invalid inputs; failure modes are first-class (H4).
- **Events** — emitted exactly when the domain says so; idempotency where the
  contract declares it.

## contracts-and-adapters

- Cross-context contracts get consumer-driven checks: shape, required fields,
  compatibility with the previous version.
- Adapters/migrations get integration tests against real IO or high-fidelity
  fakes; compatibility both ways on a migration.

## behavior-not-internals

- Assert observable outcomes, never internal call sequences (H7). The test
  that would catch the bug beats the test that pads coverage.

## refusals

- Refuse happy-path-only suites for domain work.
- Refuse coverage-percentage goals detached from risk.
