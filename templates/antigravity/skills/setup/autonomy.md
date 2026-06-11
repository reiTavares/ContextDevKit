# Skill: autonomy

> "Show or set the autonomy dial — how much the AI may do without asking (consent grade 1–4, orthogonal to the capability level)."
# the `autonomy` skill — the consent dial (ADR-0041/0042)

Show or change **how much the AI may do without asking** in this project. This is
NOT the capability level (`/context-level`, L1–L7 — what the kit *can* do); the
dial is consent — what it *may* do on its own.

Run the script and relay its output **verbatim** (it echoes the first-person
consequence text the user must see):

```bash
node contextkit/tools/scripts/autonomy.mjs            # show current grade + what each grade means
node contextkit/tools/scripts/autonomy.mjs 3          # persist grade 3
node contextkit/tools/scripts/autonomy.mjs 3 --session # this session only (auto-expires in 8h)
node contextkit/tools/scripts/autonomy.mjs --clear    # drop the session override
# grade 4 (EXPERIMENTAL, ADR-0045) — gated by the eligibility bar, SESSION-scoped by default:
node contextkit/tools/scripts/autonomy.mjs 4                     # session-only grade 4 (refuses if the bar fails)
node contextkit/tools/scripts/autonomy.mjs 4 --persist --confirm # persist grade 4 (only after seeing the consequence)
node contextkit/tools/scripts/autonomy-readiness.mjs            # measure self-coverage + attribution for the bar (EXPENSIVE)
```

Rules for you (the agent):

1. **Never run the setter on your own initiative.** Raising the grade is a floor
   area (`grade-change` → always human, ADR-0042). You run this command only when
   the user asks; you may *suggest* a grade change, never apply one.
2. When the user asks "what would grade N mean?", answer with the script's
   consequence text — do not paraphrase it weaker.
3. Grade semantics you honor everywhere (via `resolveAutonomy`, the single read
   path): **1** manual · **2** suggest+supervise (default) · **3** auto-except-
   decisions (ADRs, pushes, high-risk and secret paths still come to the user) ·
   **4** full-auto, experimental, telemetry/budget-gated (ADR-0045).
4. The non-negotiable floor holds at every grade: secret-bearing paths, gate/hook
   self-edits, force-push, ADR-class decisions and grade escalation are always
   the user's. No flag or config removes them.
5. **Grade 4 is special (ADR-0045).** It is EXPERIMENTAL. The setter runs the
   deterministic **eligibility bar** first (≥30 transitions · ≥20 sessions ·
   rollback < 10% · zero wiring-drift · self-coverage green · attribution present)
   and **refuses naming the failing criterion** if any miss — relay that verbatim.
   `/autonomy 4` with no flags is **session-scoped** (auto-reverts); persisting
   needs `--persist --confirm` after the consequence text is shown. The
   self-coverage + attribution criteria come from `autonomy-readiness.mjs` — tell
   the user to run it if those are the blockers. Even at grade 4 the floor holds
   and `/ship` runs the **hardened quorum** (see ship): a Critical from the
   security voice is a veto, and the human can yield/kill mid-run at any step.
