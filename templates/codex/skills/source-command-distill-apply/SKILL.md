---
name: "source-command-distill-apply"
description: "L5 — apply a reviewed .distillation-proposal.md to AGENTS.md and record an ADR for the cycle."
---

# source-command-distill-apply

Use this skill when the user asks to run the migrated source command `distill-apply`.

## Command Template

# 🧬 Distill apply

Materialize the proposal produced by `/distill-sessions`.

1. Read `.distillation-proposal.md`. If it is missing, stop and tell the user to
   run `/distill-sessions` first.
2. Show the user the exact `AGENTS.md` edits you are about to make and get
   confirmation. Respect the constitution — keep `AGENTS.md` lean.
3. Apply the edits to `AGENTS.md`.
4. Create an ADR (`/new-adr`-style) recording the distillation cycle: which
   sessions informed it and what changed in the constitution, so the *why* is
   captured. ADRs are immutable once accepted.
5. Delete `.distillation-proposal.md` (it is consumed).
6. Stage `AGENTS.md` + the new ADR together so the decision and its rationale
   land in the **same commit**. Then run `/log-session`.
