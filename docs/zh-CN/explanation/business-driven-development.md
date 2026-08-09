# Business-Driven Development

Business-Driven Development 将三个问题分开：这是否是真实的项目工作、谁持久地拥有这项工作的原因，以及执行真正需要什么形态。

## 1. 先判断 interaction

`conversation` 与 `exploration` 是惰性的。只有确认的 `mutation` 才进入 intake。证据不足时，ContextDevKit 会提出一个简短问题，而不是凭空创建工作。

## 2. 先解析已有工作

Resolver 可以返回 `explicit`、`inferred`、`ambiguous`、`new` 或 `none`。Ambiguous match 不会被静默选择，`done` 项目也不会在没有明确指令时自动 reopen。

## 3. Nature

- **Business**：值得跨多个工作项长期保留 outcome/KPI/sponsor/investment/horizon 的战略 capability、product、initiative 或 decision。
- **Operation**：现有 capability 内部的长期 maintenance、incident、recovery 或 improvement context。
- **none**：focused feature、bug、docs 或普通技术变更的正常结果，不需要持久 owner。
- **unclassified**：证据竞争或不足，需要一个短澄清问题。

## 4. Execution shape 独立

`direct`、`batch`、`workflow` 不由 Business/Operation 自动决定。Business 不会强制 Workflow；architecture、ADR、compliance 等词也不会。

只有真实 dependencies、waves、mandatory ordering、multi-session、coordinated integration 或 cutover/rollback 才需要 Workflow。

## 5. Business matching

Operation 可以通过确定性 scoring 获得一个 **suggested** Business。弱匹配保持 `unlinked`；matcher 不会自行写入 `confirmed`。

> **只有当遗忘某个上下文会伤害项目时，才应该创建持久上下文。**
