# 架构

ContextDevKit 是一个与宿主无关的 **AI Software Engineering Governance Harness**。宿主继续负责 agent loop、工具调用以及平台自身的安全边界；ContextDevKit 负责项目的持久工程层：项目智能、长期记忆、上下文、工作生命周期、证据与治理。

## 交互流程

```text
request
  ↓
conversation | exploration | mutation | unclassified
  ↓（仅 mutation）
Intake Envelope
  ↓
Business | Operation | none
  ↓
direct | batch | workflow
```

Conversation 与只读 exploration 不创建持久状态。意图不明确时只提出一个简短澄清问题。真实的 write attempt 会权威地把交互提升为 `mutation`。

## Intake Envelope

它是现有 signals 的临时视图：interaction、existing work、nature、execution shape、tier/complexity、domain/risk、value intent、decision need/match、Business match、reasons 与 evidence。它不是新的强制文件或流程仪式。

## 状态权威

| 状态 | Authority |
| --- | --- |
| Workflow 定义 | `workflow.json` |
| Workflow lifecycle | `workflow-state.json` |
| tasks/status/events | `pipeline/tasks.json` |
| 临时 run | `memory/runs/<id>/state.json` |
| owner preferences | `memory/preferences/owner-preferences.json` |

Markdown 是 authored context 或派生 projection，不是第二个状态 writer。

## 治理

默认只有 QA sign-off、适用的 DDD Class A invariants，以及当前 diff 新引入的 high/critical Technical Debt 可以是 `guarded`。Architecture Debt 为 `canary`；Privacy/LGPD 为 `shadow`。内部 runtime 错误降级为 `continue`。

## 宿主

Canonical sources 为 Claude Code、Codex、Antigravity 与 Grok 生成 projections。更换宿主不会丢失项目持久的治理记忆与智能。
