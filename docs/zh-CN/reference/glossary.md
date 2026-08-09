# 术语表

| 术语 | 含义 |
| --- | --- |
| Harness | 围绕 coding host 提供持久 context、memory、work lifecycle、evidence 与 governance 的层 |
| interaction | `conversation`、`exploration`、`mutation` 或 `unclassified` |
| Intake Envelope | intake signals 的临时视图，不是持久 artifact |
| Business | 持久战略上下文 `BIZ-####` |
| Operation | 持久运营上下文 `OP-####` |
| none | 不需要持久 Business/Operation owner 的普通工作 |
| direct | 小型、聚合的 execution shape |
| batch | 没有强顺序约束的相关 tasks |
| Workflow | 具有 dependencies/waves/multi-session/cutover 的协调工作 |
| task | `pipeline/tasks.json` 中的工作单元 |
| guarded | 在完整 deterministic predicate 下可 deny 的模式 |
| canary | 评估/报告，但不 deny |
| shadow | 观察，但不改变 outcome |
| Architecture Debt | 结构风险的 canary 分析 |
| Technical Debt | 针对当前 diff 新增 high/critical debt 的 guarded ratchet |
| engineering loop | implement → evaluate → correct → re-evaluate，并使用 fresh evidence |
| owner override | 对 guarded verdict 的显式、可审计人工接受 |

Task statuses：`backlog`、`working`、`blocked`、`testing`、`done`、`cancelled`。
