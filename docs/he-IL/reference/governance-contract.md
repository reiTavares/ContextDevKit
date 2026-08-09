# חוזה Governance

אירועי runtime:

```text
prompt-preflight | write-preflight | postflight | completion
```

כל event עובר דרך dispatcher מרכזי אחד עם deduplication, timeout, budget, re-entry protection ו-circuit breaker.

## Policy defaults

`defaultMode=canary`, `failurePolicy=continue`, `humanAuthority=owner-wins`.

רק `qa-signoff`, `ddd-invariants` ו-`technical-debt` נמצאים ב-guarded allowlist. `architecture-debt` הוא canary ו-`privacy-lgpd` הוא shadow.

Guarded deny דורש observation שהיא `violated`, deterministic, applicable, evidenced ו-current, בנוסף ל-predicate הספציפי של ה-gate.

## Human override

Override תקף קשור ל-scope/revision, מוגבל בזמן וניתן לביקורת. הוא מתעד את החלטת ה-owner בלי לשנות את ה-evidence המקורית.

## Fail-open

Missing/stale evidence איננה PASS. כשל פנימי של ה-harness עוקב אחרי `continue` אלא אם קיים guarded predicate מלא ועצמאי.
