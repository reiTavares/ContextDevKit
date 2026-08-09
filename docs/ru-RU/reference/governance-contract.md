# Контракт governance

События runtime:

```text
prompt-preflight | write-preflight | postflight | completion
```

Каждое событие проходит через единый dispatcher с deduplication, timeout, budget, re-entry protection и circuit breaker.

## Политика

Defaults: `defaultMode=canary`, `failurePolicy=continue`, `humanAuthority=owner-wins`.

Только `qa-signoff`, `ddd-invariants` и `technical-debt` входят в guarded allowlist. `architecture-debt` — canary, `privacy-lgpd` — shadow.

Guarded deny требует `violated`, deterministic, applicable, evidenced и актуального observation плюс специальный predicate конкретного gate.

## Human override

Валидный override привязан к scope/revision, ограничен по времени и аудируем. Он фиксирует решение owner, не изменяя исходное evidence.

## Fail-open

Missing/stale evidence не является PASS. Internal harness failure следует `continue`, если нет независимого полного guarded predicate.
