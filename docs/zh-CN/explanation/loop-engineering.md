# 基于证据的 Loop Engineering

ContextDevKit 把交付视为工程循环，而不是一次性生成。

```text
implement
  ↓
evaluate
  ↓
findings
  ↓
correct
  ↓
re-evaluate
  ↓
fresh evidence
  ↓
done
```

Agent loop 属于宿主；engineering loop 属于项目，因此可以跨 context compaction、新 session、不同 model 或不同 host 延续。

## 自适应深度

Active agent 根据 complexity、scope、risk、blast radius、受影响 contracts、domain weight、critical paths、owner instruction 与 available evidence 选择工程深度。

一个 typo 可能只需要 focused validation；material feature 可能需要 tests + code review；critical change 可能需要 full QA、DDD、architecture、security、debt、integration/E2E 或 performance。

## Evaluators

QA、DDD、Technical Debt、Architecture Debt、Code Review、Security、Lean Code、Performance 与 Accessibility 都可以产生 evidence，但不是每个 evaluator 都拥有 blocking authority。

## Fresh QA cycle

`qa-reject` 可以把 task 从 `testing` 或 `done` 返回 `backlog`。当前周期 evidence 被清理，历史事件保留；已完成 Workflow 也可以 reopen。

## Completion

`unknown`、`skipped`、`error` 不是 PASS；但 optional evaluator failure 也不会自动锁死平台。只有配置过的 guarded quality floors 能在对应 lifecycle moment 拒绝。

> **模型可以提出完成。证据负责证明完成。Outcome 由 owner 定义。**
