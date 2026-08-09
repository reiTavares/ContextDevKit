# 运行一个 Business case

只有当工作代表持久战略 outcome 时才使用此流程。

## 1. 先执行只读 intake

```bash
node contextkit/tools/scripts/work.mjs intake "<目标>" --json
```

检查 `nature`、`executionMode`、clarification、reasons 与 evidence。`none` 是有效结果；不要为普通 feature 人为创建 Business。

## 2. 明确创建 Business

使用项目中的 `work.mjs business` surface。Classifier 提供信息，但 ownership 的创建/确认必须是显式决定。

## 3. 选择最小 execution shape

Business 可以使用 direct、batch 或 Workflow。只有真实 topology 需要时才选择 Workflow。

## 4. 相关 Operations

Operation 可以保护或支持 Business outcome。Matcher 可以建议 link，但不会自动确认战略 ownership。

## 5. Decisions 与 evidence

只有 material decision 才记录 ADR。Reports 保存事实，JSON 保持 state authority。

## 6. Outcome

目标是保存需要跨 session 生存的战略上下文，而不是强迫每个技术变更都归属于 Business。
