---
name: "source-command-forge-forge-killswitch"
description: "Toggle quality.policy.yaml's `kill_switch.enabled` (on|off) for one forged Agent Package. Atomic write; dry-run by default. (agent-forge squad)"
---

# source-command-forge-forge-killswitch

Use this skill when the user asks to run the migrated source command `forge-killswitch`.

## Command Template

# 🛠️ Mode: agent-forge — kill switch

Run `node contextkit/squads/agent-forge/cli/forge-admin.mjs killswitch $ARGUMENTS`.

When `on`, the runtime adapter refuses every call until manually reset. Use
this DURING an incident, not as a planned change.

## Refuse conditions
- The dev wants to permanently disable the kill switch for "ergonomics".
  Refuse — the kill switch is the agent's last line of defense (ADR-0012 §6).
- A request to switch on without recording an incident note. Recommend
  `/log-session` after toggling.
