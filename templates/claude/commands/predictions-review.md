---
description: Close the predicted-vs-actual loop — fill each prediction's Actual section from the ledger.
---

# 🔁 Predictions Review

Close the loop on `/simulate-impact` predictions for the current session.

Run:

```
node contextkit/tools/scripts/predictions-review.mjs
```

This reads the session ledger and, for every `/simulate-impact` recorded this session, fills the
**Actual** section of its prediction file in `contextkit/memory/predictions/`: the paths actually
changed vs what was predicted, with the delta in both directions (predicted-but-not-changed,
changed-but-not-predicted).

Then:

1. Open the updated prediction file(s) and add the **Risk accuracy** note — was the predicted risk
   level right? That judgment is yours, not the script's.
2. If a pattern repeats across predictions (an area consistently under- or over-estimated), capture
   it: refine `.claude/commands/simulate-impact.md`, or open `/new-adr` if it's architectural.

Also invoked automatically by `/log-session` at the end of a session, so the loop closes without a
separate step in the normal flow.
