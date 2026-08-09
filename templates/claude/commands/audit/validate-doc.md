---
description: Quality gate for our own planning artifacts (ADRs / roadmap) — measurability, trade-offs, no placeholders. Advisory, never blocks.
argument-hint: <path/to/doc.md> [--adr | --roadmap]
---

# 📋 Validate a planning document

Run the document-quality rubric against **$ARGUMENTS** [ADR-0030]. This is the
prose sibling of `selfcheck`: where selfcheck validates *code wiring*, this
validates the *quality of the decision* an ADR or roadmap records — adapted from
EVO-METHOD/BMAD's `steps-v` validation chain (MIT).

1. Run the checker:
   ```
   node contextkit/tools/scripts/validate-doc.mjs $ARGUMENTS
   ```
   It auto-detects the rubric from the path (ADRs under `memory/decisions/`,
   anything named `roadmap`), or force it with `--adr` / `--roadmap`.

2. **What the ADR rubric enforces:**
   - Required sections present (**Context**, **Decision**, **Consequences**).
   - A valid **Status** (Proposed / Accepted / Superseded).
   - No leftover template placeholders (`NNNN`, `YYYY-MM-DD`, `<who>`, …).
   - Context that states the *forces* without already giving the answer (depth).
   - Consequences that own a **trade-off / risk** — a decision with only upsides
     is under-examined.
   - Follow-ups noted (what the decision obligates next).

3. **What the roadmap rubric enforces:** items read as **measurable** (a number,
   date, or target), not aspirational.

4. **Act on the output.** Errors (❌) are real gaps — fix the artifact. Warnings
   (⚠️) are smells — judge each. This command is **advisory**: it never blocks a
   commit or push (constitution §8 — report honestly, don't gate silently).

> Tip: run it on a fresh ADR right after `/new-adr`, before you ask for the
> `Accepted` flip — it catches thin Context and missing trade-offs early.
