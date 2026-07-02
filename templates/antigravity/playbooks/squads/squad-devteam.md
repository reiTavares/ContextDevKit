# Playbook: squad-devteam

> Reusable procedure. Follow the steps below when invoked.

# 🛠️ Playbook: devteam

This playbook coordinates the constructive team responsible for designing, building, and reviewing code.

## 👥 Members
* `architect`: Cross-cutting patterns, architecture decisions, plans migrations.
* `code-reviewer`: Reviews code changes against the Coding Constitution (`CLAUDE.md`).
* `context-keeper`: Manages durable project memory (ADRs, sessions, glossary).
* `domain-modeler`: Turns intent and rules into an explicit domain model (bounded contexts, invariants, state authority) — only at domain-driven+ profiles (ADR-0128 §9).
* `implementation-engineer`: Converts approved contracts/packets into the smallest safe diff, tests with the code — the minimum squad for any code work (ADR-0128 §9).
* `security`: Evaluates security impacts on auth, secrets, and trust boundaries.
* `test-engineer`: Generates test specifications and checks coverage rules.

## 📝 Best Practices
1. **Design before Syntax:** For non-trivial modifications, always write/update ADRs or PRD/SPEC files in `contextkit/memory/workflows/`.
2. **Coding Constitution:** Strictly follow standard limits (e.g. 280 lines limit per file, descriptive naming, fail-fast boundary validation).
3. **Review Protocols:** Every code change should be statically verified using local checks before commit.
