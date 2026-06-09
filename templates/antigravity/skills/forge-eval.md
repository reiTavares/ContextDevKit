# Skill: forge-eval

> Run the eval gate (golden + red-team) for one forged Agent Package against its thresholds. Default provider is a deterministic mock for CI; --provider chaos exercises an upstream-503. (agent-forge squad)
> Argument: <agent>[@<version>] [--provider mock|chaos] [--json]
# 🛠️ Mode: agent-forge — eval

Run `node vibekit/squads/agent-forge/cli/forge-eval-cli.mjs eval <user-specified argument>`.

This is the Fase 3 gate, re-runnable on demand. Exits 1 on any threshold
breach so it can chain into a CI step.

## When the verdict is FAIL
- Surface every failure reason verbatim.
- Do NOT recommend a `--write` or deploy until the dev fixes the underlying issue.
- A red-team `pii_leak` failure when `pii_present: true` is non-negotiable — escalate.
