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
2. **Coding Constitution:** Strictly follow the constitution (no file-size limit — split on a real responsibility boundary; descriptive naming, fail-fast boundary validation).
3. **Model before building, proportionally:** dependencies point inward and a foreign shape (DB row, vendor SDK type) is never the domain model. When the resolved profile carries domain weight, `domain-modeler` names the bounded contexts, the ubiquitous language, and the invariant each aggregate protects *before* `implementation-engineer` writes the diff. At `simple`/`modular` that step is skipped on purpose — ceremony that protects nothing is waste.
4. **Lean by default:** the smallest reversible step; abstract on the **second** real case, not the first; reach for deletion before addition. Duplicated *business rules* are the debt, not two similar code paths.
5. **Review Protocols:** Every code change should be statically verified using local checks before commit. `code-reviewer` fires on every material diff; the domain checks block only against a *declared* map (ADR-0143), and propose against an auto-seeded one.
