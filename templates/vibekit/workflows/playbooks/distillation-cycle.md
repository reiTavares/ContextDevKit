# Playbook — Distillation cycle (L5 Stage 2)

> Operational: `.claude/commands/{distill-sessions,distill-apply}.md` + the Stage 2
> nudge in `check-registration.mjs`. This page is the **end-to-end flow**,
> **anti-patterns**, and **calibration**.

## The cycle in one sentence

> Stage 1 observes silently. Stage 2 proposes (`/distill-sessions`) and applies with
> human approval (`/distill-apply`). Each applied cycle becomes an ADR.

## Prerequisites before the first Stage 2

Do **not** run `/distill-sessions` before:
- several weeks of Stage 1 active;
- enough registered sessions to have signal;
- the boot context consistently showing the "observed patterns" section with real
  data (≥ 2 entries in at least one category).

Earlier than that, Stage 2 produces speculative rules — and a bad rule applied via
ADR is costlier to remove than to avoid.

## End-to-end flow

```
[soak] → Stop hook counts registered sessions ≥ proposeAfterSessions → nudge suggests /distill-sessions
USER runs /distill-sessions
  → observe patterns · read 5–10 session excerpts · delegate the proposal to context-keeper
  → write .distillation-proposal.md (gitignored) · show the user
USER reviews (edits / removes rules)
USER runs /distill-apply   (or deletes the proposal)
  → create ADR "Distillation cycle X" · update the ADR index · apply the CLAUDE.md diff
  → clean up the proposal · show git diff --stat
USER commits
[next cycle gated by another soak]
```

## What makes a good distilled rule

- **Frequency** — ≥ 3 sessions mention the same pattern.
- **Concreteness** — fits in 1–3 lines in CLAUDE.md.
- **Non-duplication** — not already in CLAUDE.md or an ADR.
- **Actionability** — the next session behaves differently because of it.
- **Mentally testable** — you can picture the error it prevents.

## Anti-patterns

1. **Skipping Stage 1.** Stage 1 feeds Stage 2 statistical signal; without it, Stage
   2 is an agent guessing — the very anti-pattern L5 avoids.
2. **Applying without reading the proposal.** The propose/apply split exists to force
   a read in the middle. Skipping it is applying a diff blind.
3. **A "rule" that's really an ADR.** If it needs 50 lines to explain, it's an
   architectural decision — `/new-adr`, then reference it in one line.
4. **Back-to-back cycles.** The soak window exists so patterns are stable, not
   emergent. Respect `proposeAfterSessions`.
5. **Editing the proposal to force a rule the agent rejected.** It was rejected for a
   reason (contradiction, duplication, vagueness). Ask why; if it still holds, make a
   direct ADR — don't bypass the check.

## Calibration over time

After ~5 applied cycles: audit reverts (did a rule get contradicted? refine the
prompts), audit "no-shows" (a Stage 1 pattern that never became a rule — maybe the
frequency threshold is wrong), and consider a more frequent auto-propose stage only
after the manual stage has proven itself.

## Relation to `/log-session` and ADRs

| Event | Artifact | Lifecycle |
| --- | --- | --- |
| `/log-session` | `vibekit/memory/sessions/<file>.md` | Immutable after creation |
| `/simulate-impact` | `vibekit/memory/predictions/<file>.md` | Updated by `/log-session` |
| `/distill-sessions` | `.distillation-proposal.md` | Temporary, gitignored |
| `/distill-apply` | `vibekit/memory/decisions/NNNN-distillation-cycle-X.md` + CLAUDE.md diff | Permanent, versioned, revertible |
