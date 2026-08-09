# Playbook: squad-devteam

> Reusable procedure. Follow the steps below when invoked.

# Playbook: devteam

The development specialists are optional perspectives for designing, building,
testing, and reviewing code. The current agent selects only the roles that add
value and continues alone when delegation is unavailable.

## Members

- `architect`: cross-cutting design and migration trade-offs.
- `code-reviewer`: contract, clarity, and maintainability review.
- `context-keeper`: durable project memory and projections.
- `domain-modeler`: bounded contexts, language, invariants, and state authority
  when the domain actually warrants it.
- `implementation-engineer`: bounded production implementation with tests.
- `security`: trust boundaries, auth, secrets, and technical security risks.
- `test-engineer`: focused regression and coverage strategy.

## Working agreement

1. Keep design proportional to the change.
2. Preserve one state authority and explicit public contracts.
3. Implement the smallest reversible diff and test it with the code.
4. Treat specialist output as advice; absence of a role never denies work.
5. Record durable decisions only when the owner requests or accepts them.
