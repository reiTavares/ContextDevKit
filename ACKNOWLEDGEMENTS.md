# Acknowledgements

ContextDevKit is its own system, but it did not appear in a vacuum. This file is
the **single sanctioned place** to credit the projects and ideas that influenced
its design. Public documentation (the README, `docs/`, `instrucoes.md`) describes
ContextDevKit's *capabilities* and deliberately does not name inspirations inline;
the lineage lives here and in the internal decision records.

## Influences

- **nolrm/contextkit** — an early exploration of file-based, durable project
  context for AI coding assistants. It informed our thinking on persistent memory
  that survives across sessions. ContextDevKit takes a different path: a
  level-based platform with hook-enforced governance rather than convention alone.

- **Compozy** — a workflow-orchestration framework whose treatment of multi-step,
  multi-agent execution sharpened our view of how a deterministic engine should
  drive specialized agents. ContextDevKit applies that lens to the development
  lifecycle itself (PRD → SPEC → ADR → pipeline → ship).

## Foundations

ContextDevKit stands on widely shared engineering practice — Architecture Decision
Records (Michael Nygard's ADR pattern), the [Diátaxis](https://diataxis.fr/)
documentation framework, Conventional Commits, and the broader Claude Code,
Codex, Cursor, Antigravity and OpenCode host ecosystems it integrates with.

> Inspirations are credited here once. If you are looking for *why* a specific
> decision was made, that rationale lives in the project's internal decision
> records, not in the public docs.
