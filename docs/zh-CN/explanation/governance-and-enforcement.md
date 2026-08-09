# 治理与 Enforcement

ContextDevKit 将确定性的 quality floors 与工程建议分开。

## 模式

- `off`：关闭；
- `shadow`：观察，但不改变 outcome；
- `canary`：评估并报告，但不拒绝；
- `guarded`：只在文档规定的时刻，对适用、确定且有证据的 violation 进行 deny。

## 默认三个 guarded quality floors

1. completion 时的 QA sign-off；
2. 已声明且适用的 DDD Class A invariants；
3. 当前 diff 新引入的 `high`/`critical` Technical Debt。

Architecture Debt 为 `canary`；Privacy/LGPD 为 `shadow`。Graph、routing、swarm、economy、simulations、councils 与 specialist selection 都不是隐藏的许可机制。

## Harness 自身失败

Invalid config、timeout、evaluator error 或 optional unknown evidence 都降级为 `canary/continue`。治理系统自身的故障不应阻断真实工作。

## Owner sovereignty

默认 `humanAuthority=owner-wins`。Guarded override 会记录 actor、reason、scope、revision 与 outcome；它不会把 failed evidence 改写为 PASS，也不会绕过宿主或平台的真实安全边界。
