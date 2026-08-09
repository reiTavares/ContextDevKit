---
name: "source-command-predictions-review"
description: "Close the predicted-vs-actual loop from the current Git diff."
---

# source-command-predictions-review

Use this skill when the user asks to run the migrated source command `predictions-review`.

## Command Template

# 🔁 Predictions Review

Close the loop on `/simulate-impact` predictions for the current session.

Run:

```
node contextkit/tools/scripts/predictions-review.mjs --write
```

This reads unreviewed prediction artifacts and, for each match, fills the
**Actual** section from the current Git diff: the paths actually
changed vs what was predicted, with the delta in both directions (predicted-but-not-changed,
changed-but-not-predicted).

Then:

1. Open the updated prediction file(s) and add the **Risk accuracy** note — was the predicted risk
   level right? That judgment is yours, not the script's.
2. If a pattern repeats across predictions (an area consistently under- or over-estimated), capture
   it: refine `.agents/skills/source-command-simulate-impact/SKILL.md`, or open `/new-adr` if it's architectural.

`/log-session` invokes the same explicit `--write` command after the user has
requested session registration.
