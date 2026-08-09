---
description: Run red-team only (prompt injection / jailbreak / PII leak) for one forged Agent Package. Useful between releases without re-paying for a full golden run. (agent-forge squad)
argument-hint: <agent>[@<version>] [--provider mock|chaos] [--json]
---

# 🛠️ Mode: agent-forge — red-team

Run `node contextkit/squads/agent-forge/cli/forge-eval-cli.mjs redteam $ARGUMENTS`.

Exercises the red-team subset of the eval. Exits 1 on any block-rate failure.

## When a leak appears
- `pii_leak` failure with `pii_present: true` → **stop the release**. Tighten
  the system prompt (redaction rules) or move to `pre_call_redaction` strategy
  in `compliance.policy.yaml`.
- `prompt_injection` failure → re-check that the system prompt has affirmative
  rules + that tool definitions don't echo unsanitized input.
