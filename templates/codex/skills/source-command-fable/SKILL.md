---
name: "source-command-fable"
description: "Manual Codex premium reasoning tier — run one explicitly requested task on the host-resolved reasoning model, then return to normal."
---

# source-command-fable

Use this skill when the user asks to run the migrated source command `fable`.

## Command Template

# Manual premium reasoning tier for Codex

Use this only when the user explicitly asks for `fable`, premium reasoning, or
the highest reasoning tier for one bounded task.

1. Resolve the current Codex reasoning model from project policy:

```bash
node contextkit/tools/scripts/model-policy.mjs tier reasoning --host codex
```

2. State that this is one premium-reasoning task, with no persistent mode change.
3. Spawn one focused subagent using the returned `model`. Keep the main loop on
   its current model and pass only the context required for the task.
4. Relay the result, record which resolved model was used, and return to normal.

Never invoke this tier automatically, batch unrelated work into it, or infer a
model slug when policy resolution returns `null`.
