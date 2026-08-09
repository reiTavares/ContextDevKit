# Governance और Enforcement

ContextDevKit deterministic quality floors को advisory engineering guidance से अलग रखता है।

## Modes

- `off`: disabled;
- `shadow`: observe करता है, outcome नहीं बदलता;
- `canary`: evaluate/report करता है, deny नहीं करता;
- `guarded`: केवल documented moment पर applicable, deterministic और evidenced violation को deny कर सकता है।

## तीन default guarded quality floors

1. completion पर QA sign-off;
2. declared और applicable DDD Class A invariants;
3. current diff द्वारा introduce किया गया नया `high`/`critical` Technical Debt।

Architecture Debt `canary` है; Privacy/LGPD `shadow` है। Graph, routing, swarm, economy, simulations, councils और specialist selection hidden permission नहीं हैं।

## Harness failure

Invalid config, timeout, evaluator error या optional unknown evidence `canary/continue` पर degrade होते हैं। Governance की अपनी failure real work को नहीं रोकनी चाहिए।

## Owner sovereignty

Default `humanAuthority` = `owner-wins`। Guarded override actor, reason, scope, revision और outcome record करता है; failed evidence को PASS में नहीं बदलता और host/platform safety boundary को bypass नहीं करता।
