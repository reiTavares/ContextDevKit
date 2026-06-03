---
description: Chaos-test the fallback path for one forged Agent Package by simulating a primary 503 on the first call. Verifies the eval scaffold survives upstream failures. (agent-forge squad)
argument-hint: <agent>[@<version>] [--json]
---

# 🛠️ Mode: agent-forge — fallback test

Run `node vibekit/squads/agent-forge/cli/forge-eval-cli.mjs fallback-test $ARGUMENTS`.

The chaos provider raises a 503 once, then behaves normally. The runner
demonstrates that the eval scaffold tolerates the failure. The actual
fallback-chain wiring lives in the client's runtime adapter — Fase 5 will
exercise it end-to-end with the real adapter.

## After
- If the test reports a fall-back, surface the new primary model. Compare with
  `governance/fallback-chain.yaml.chain[0]` — they should match.
