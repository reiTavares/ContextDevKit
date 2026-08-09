# Архитектура

ContextDevKit — host-agnostic **AI Software Engineering Governance Harness**. Хост отвечает за agent loop, инструменты и границы безопасности платформы; ContextDevKit сохраняет долговечный инженерный слой проекта: знания, память, контекст, жизненный цикл работы, доказательства и governance.

## Поток взаимодействия

```text
запрос
  ↓
conversation | exploration | mutation | unclassified
  ↓ (только mutation)
Intake Envelope
  ↓
Business | Operation | none
  ↓
direct | batch | workflow
```

Разговор и read-only exploration не создают долговечного состояния. Неопределённое намерение вызывает один короткий уточняющий вопрос. Реальная попытка записи авторитетно переводит взаимодействие в `mutation`.

## Intake Envelope

Это временное представление уже существующих сигналов: interaction, existing work, nature, execution shape, tier/complexity, domain/risk, value intent, decision need/match, Business match, причины и доказательства. Это не новый файл и не обязательная церемония.

## Источники состояния

| Состояние | Авторитет |
| --- | --- |
| определение Workflow | `workflow.json` |
| lifecycle Workflow | `workflow-state.json` |
| tasks/status/events | `pipeline/tasks.json` |
| временный run | `memory/runs/<id>/state.json` |
| preferences | `memory/preferences/owner-preferences.json` |

Markdown — authored context или производная проекция, но не второй writer состояния.

## Governance

По умолчанию `guarded` могут быть только QA sign-off, применимые DDD Class A invariants и новый high/critical Technical Debt текущего diff. Architecture Debt — `canary`, Privacy/LGPD — `shadow`. Внутренние ошибки runtime деградируют к `continue`.

## Хосты

Канонические источники порождают проекции для Claude Code, Codex, Antigravity и Grok. Хост можно заменить, не теряя управляемую память и интеллект проекта.
