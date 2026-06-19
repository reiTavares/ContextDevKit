# Legacy Decisions (plain-markdown ADRs)

Home for pre-methodology, plain-markdown ADRs (`NNNN-slug.md`) that carry **no**
YAML front matter. They remain valid, resolvable Decisions.

- The runtime/registry classify them **logically only** — `contextType: legacy`,
  `status: legacy`, `primaryContext: null` — WITHOUT editing the files
  (compatibility-plan §"Legacy classification").
- The legacy filename shape is `^(\d{4})-([a-z0-9._-]+)\.md$` and MUST NOT change
  (compatibility-plan §"Do-not-touch list").
- Never migrate, rename, move, or rewrite a legacy ADR implicitly. Migration is
  opt-in and staged (`discover → audit → propose → dry-run → apply → verify →
  receipt`).
