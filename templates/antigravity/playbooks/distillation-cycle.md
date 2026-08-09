# Playbook: distillation-cycle

> Reusable procedure. Follow the steps below when invoked.

---
phases:
  - conclusion
squads:
  - devteam
---
# Playbook — explicit distillation cycle

Distillation turns repeated evidence from authored session reports into a reviewed
proposal. It is never started by a Stop hook and never infers facts from a hidden
edit ledger.

1. A human explicitly runs `/distill-sessions` when enough authored reports exist.
2. The command cites concrete recurring observations and writes
   `.distillation-proposal.md`.
3. The human edits, rejects, or approves the proposal.
4. `/distill-apply` records the material decision and applies the approved rule.

A useful rule is frequent, concrete, non-duplicative, actionable, and reversible.
Sparse or contradictory evidence produces no proposal. Back-to-back cycles without
new evidence are noise.
