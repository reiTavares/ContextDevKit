# Business Rule: <name> (v1)

- **Status**: Draft   <!-- Draft | Active | Superseded by <name>-vN -->
- **Version**: v1
- **Owner**: <team / role>   ·   **Updated**: YYYY-MM-DD
- **Related**: [GLOSSARY](../GLOSSARY.md) terms · ADR(s) · roadmap P-IDs

## Rule
State the rule precisely, in domain language — what MUST happen, for whom, and
when. A reader should be able to implement or verify it from this section alone.

## Inputs → outputs
- **Given**: <preconditions / inputs>
- **Then**: <the deterministic result>

## Edge cases & exceptions
- <boundary condition> → <expected behaviour>
- <conflict / failure mode> → <expected behaviour>

## Rationale (why)
Why the rule exists (business / legal / UX). If a technical decision enforces it,
link the ADR in `../decisions/`.

## Examples
| Input | Expected |
| --- | --- |
| <case> | <result> |

<!-- One file per cohesive rule, versioned (`-v1`, `-v2`). When a rule changes
     materially, add a new version and mark the old one "Superseded". Keep the
     business language consistent with GLOSSARY.md. This folder mirrors the
     source platform's docs/business-rules/, kept in contextkit/memory/ alongside
     the rest of the project's durable memory. -->
