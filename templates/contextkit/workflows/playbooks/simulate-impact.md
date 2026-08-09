---
phases:
  - planning
squads:
  - devteam
---
# Playbook — explicit impact simulation

`/simulate-impact` is an advisory blast-radius analysis for a material change. It
may use Project Map, code search, and optional specialists. It does not grant write
authority and is not a universal precondition.

The command is dry-run by default. `--write` creates one prediction artifact under
`contextkit/memory/predictions/`; no session marker or bypass token is written.
`/predictions-review` later compares the prediction with Git changes and factual
reports, again writing only when explicitly requested.

A useful report distinguishes observed dependencies, inferences, unknowns, rollback
surface, and the smallest focused verification set.
