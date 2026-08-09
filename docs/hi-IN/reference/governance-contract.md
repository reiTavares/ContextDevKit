# Governance Contract

Runtime events:

```text
prompt-preflight | write-preflight | postflight | completion
```

हर event एक central dispatcher से गुजरता है जिसमें deduplication, timeout, budget, re-entry protection और circuit breaker होता है।

## Policy defaults

`defaultMode=canary`, `failurePolicy=continue`, `humanAuthority=owner-wins`।

केवल `qa-signoff`, `ddd-invariants` और `technical-debt` guarded allowlist में हैं। `architecture-debt` canary और `privacy-lgpd` shadow है।

Guarded deny के लिए observation को `violated`, deterministic, applicable, evidenced और current होना चाहिए, साथ में gate-specific predicate पूरा होना चाहिए।

## Human override

Valid override scope/revision-bound, time-limited और auditable है। यह owner decision record करता है, original evidence नहीं बदलता।

## Fail-open

Missing/stale evidence PASS नहीं है। Internal harness failure `continue` follow करता है जब तक कोई independent complete guarded predicate मौजूद न हो।
