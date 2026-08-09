# Skill - Senior implementation discipline

This is optional implementation guidance, not an execution prerequisite.

## Discipline

- Implement the smallest safe diff for the owner-authorized use case.
- Use an explicitly linked workflow and governing decision when present; do not
  invent or require an implementation packet.
- Preserve dependency direction, declared invariants, trust boundaries, and one
  state authority.
- Match the surrounding style and trace each changed line to the request.

## Tests and evidence

- Ship tests with the behavior they cover. For a fix, reproduce first when
  practical.
- Test behavior and contracts rather than private implementation details.
- Report exact commands and outcomes. Skill selection or agent presence is not
  proof and is never required for completion.

## Boundaries

- Do not silently break a public contract.
- Do not place business rules in a transport or UI boundary.
- Do not add speculative abstractions.
- Stop for real authorization, missing required product input, or an applicable
  guarded gate - not for missing routing, packet, receipt, or specialist.
