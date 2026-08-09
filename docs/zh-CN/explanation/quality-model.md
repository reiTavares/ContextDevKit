# 质量模型

ContextDevKit 4 将观察结果与 authority 分离。

## Evidence states

```text
passed | violated | unknown | skipped | error
```

`unknown`、`skipped`、`error` 永远不会伪装成 PASS。

## QA

当 guarded predicate 适用时保护 `done` transition，但不会阻止 implementation 开始。

## DDD

只有已声明、适用且被确定性证明违反的 Class A invariant 才能进入 guarded floor。Classifier opinion 或未经确认的 domain map 不足以构成阻断证据。

## Technical Debt

它是 current diff 的 ratchet。只有由当前变更新引入的 `high`/`critical` debt 才能在配置为 guarded 时拒绝 completion。历史 debt 不应阻塞无关工作。

## Architecture Debt

它是更广泛的结构评估，并保持 `canary`。它可以发现风险并提供 evidence，但不会自动成为第四个 guarded gate。

## Code Review 与 Lean Code

它们属于工程/advisory responsibility。Finding 应包含 evidence 与 context；文件大小本身永远不是架构 verdict。
