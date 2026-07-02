# Skill — Senior implementation discipline

> Trigger (§11): CMIS ≥ 50 OR a real write attempt — always active for code work.
> Registered in `policy/devteam/skills-registry.json`; applied-sections are
> recorded via the §18 skill-application receipt.

## discipline

- Implement the **smallest safe diff** for the approved use case — nothing
  speculative, no unrequested options (constitution §9, behaviors §2).
- Respect the owner, the governing Decision and the implementation packet: if
  the packet is missing or stale, STOP and say so — never write blind.
- Preserve dependency direction (S1) and declared invariants; infrastructure
  stays out of the domain.
- Match the surrounding style; every changed line traces to the request.

## tests-with-code

- Tests ship in the same diff as the behavior they cover (rule 3). For a fix,
  the reproducing test comes first.
- Test behavior and contracts, not internals (H7).

## evidence

- Record deviations from the packet explicitly — a silent deviation is a
  governance violation.
- Done means a receipt: suite output, QA sign-off, skill-application record.
  "Tests passed" as prose does not count.

## refusals

- Refuse to write before knowing the packet.
- Refuse to break a public contract silently.
- Refuse to put business rules in a controller/route/component.
- Refuse speculative abstraction (a second real consumer earns it).
- Refuse to mark done without a receipt.
