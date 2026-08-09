<!-- ContextDevKit PR template — edit freely for your project. -->

## What & why

<!-- What does this change do, and why? Link the issue/ADR if any. -->

## Type

- [ ] feat
- [ ] fix
- [ ] refactor
- [ ] docs
- [ ] test
- [ ] chore

## Checklist

- [ ] Follows the constitution in `CLAUDE.md` (file size, SRP, naming, language policy)
- [ ] No new file over the line limit without a recorded coherence reason
- [ ] Tests added/updated for the change (and they would catch the bug)
- [ ] Architectural decision recorded with `/new-adr` (if applicable)
- [ ] Session registered with `/log-session`
- [ ] `CHANGELOG.md` `[Unreleased]` updated

## Documentation boundary

<!-- Public docs (README.md, docs/, instrucoes.md) are capability-only — what the
     feature does and how to use it. Internal lineage (why a decision was made,
     decision ids, inspiration credits) stays in internal memory, not in docs/. -->

- [ ] Public docs are capability-only — no internal decision ids in prose, no inspiration names
- [ ] New/changed features have (or have a tracked gap for) a reference entry + a how-to or explanation
- [ ] The docs index is up to date; any README inventory claims still match reality

## Notes for reviewers

<!-- Anything reviewers should focus on, risks, follow-ups. -->
