---
description: Read-only, six-lane improvement scan across architecture, product, security, UX, and growth.
argument-hint: [--before <objective> | --after [--since <ref>]] [--lane <id>]
---

# Advise

Produce one bounded recommendation report without mutating project state.

## Modes

- `--after` (default): inspect the changed surface and suggest improvements.
- `--since <ref>`: use
  `git diff --name-only <ref>...HEAD`; refuse an invalid ref and never silently
  fall back to a broader scan.
- `--before <objective>`: identify opportunities and risks for a proposed change.
- `--lane <id>`: restrict the report to `architecture`, `features`, `deepen`,
  `security`, `ux`, or `growth`.

## Procedure

1. Read `advisor.lanes` from the resolved config. A lane without an owner is
   reported as `skipped - no owner`.
2. Build one bounded context pack for the selected surface:
   `node contextkit/tools/scripts/context-pack.mjs --for-subagent --objective "<surface>"`.
3. Ask only the relevant specialists for recommendations. Their participation is
   advisory and cannot block the owner's work.
   The growth lens may consult retention and SEO specialists when relevant.
4. Return one report grouped by lane. Each finding states impact, evidence, why it
   matters now, and a proposed next action. Silence is a valid lane result.
5. Offer a follow-up mutation for the highest-value finding, but do not perform it.

This command is exploration. It never creates tasks, workflows, or receipts, agent
obligations, or source edits. If the user later asks to act on a finding, run the
normal mutation intake and write through the explicit canonical JSON scope.
