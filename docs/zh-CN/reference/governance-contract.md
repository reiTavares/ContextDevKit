# 治理契约

Runtime events：

```text
prompt-preflight | write-preflight | postflight | completion
```

每个事件都通过一个中央 dispatcher，负责 deduplication、timeout、budget、re-entry protection 与 circuit breaker。

## 默认策略

`defaultMode=canary`、`failurePolicy=continue`、`humanAuthority=owner-wins`。

只有 `qa-signoff`、`ddd-invariants` 与 `technical-debt` 位于 guarded allowlist。`architecture-debt` 为 canary，`privacy-lgpd` 为 shadow。

Guarded deny 需要 observation 同时满足 `violated`、deterministic、applicable、evidenced、current，并满足 gate-specific predicate。

## Human override

有效 override 与 scope/revision 绑定、具有时效性并可审计。它记录 owner 的决定，但不会修改原始 evidence。

## Fail-open

Missing/stale evidence 不是 PASS。Harness 内部失败遵循 `continue`，除非存在独立且完整的 guarded predicate。
