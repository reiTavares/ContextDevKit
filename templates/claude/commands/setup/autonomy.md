---
description: "Show or set the autonomy dial — how much the AI may do without asking (consent grade 1–4, orthogonal to the capability level)."
---

# /autonomy — the consent dial (ADR-0041/0042)

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
5. If the user picks grade 4, state plainly that it is experimental and that
   `/ship` will refuse full-auto until the ADR-0045 eligibility bar holds.
