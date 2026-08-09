# Governance и enforcement

ContextDevKit отделяет детерминированные quality floors от инженерных рекомендаций.

## Режимы

- `off` — выключено;
- `shadow` — наблюдает, не влияя на outcome;
- `canary` — оценивает и сообщает, но не запрещает;
- `guarded` — может запретить только применимое, детерминированное и доказанное нарушение в документированный момент.

## Три guarded quality floors по умолчанию

1. QA sign-off при completion;
2. объявленные и применимые DDD Class A invariants;
3. новый `high`/`critical` Technical Debt, внесённый текущим diff.

Architecture Debt — `canary`; Privacy/LGPD — `shadow`. Graph, routing, swarm, economy, simulations, councils и specialist selection не являются скрытым разрешением.

## Ошибки harness

Invalid config, timeout, evaluator error или unknown optional evidence деградируют к `canary/continue`. Governance не должна ломать реальную работу из‑за собственной внутренней ошибки.

## Owner sovereignty

`humanAuthority` по умолчанию — `owner-wins`. Guarded override записывает actor, reason, scope, revision и outcome; он не превращает failed evidence в PASS и не заменяет реальные safety boundaries хоста.
