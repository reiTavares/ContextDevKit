# Loop Engineering на основе доказательств

ContextDevKit рассматривает доставку как инженерный цикл, а не как одноразовую генерацию.

```text
реализовать
  ↓
оценить
  ↓
findings
  ↓
исправить
  ↓
переоценить
  ↓
новые доказательства
  ↓
done
```

Agent loop принадлежит хосту. Engineering loop принадлежит проекту и может пережить compact, новую сессию, другую модель или другой хост.

## Адаптивная глубина

Активный агент выбирает глубину по complexity, scope, risk, blast radius, затронутым contracts, domain weight, critical paths, инструкции owner и доступным evidence.

Небольшой typo может требовать только focused validation. Material feature — tests + code review. Критическое изменение может оправдывать full QA, DDD, architecture, security, debt, integration/E2E или performance.

## Evaluators

QA, DDD, Technical Debt, Architecture Debt, Code Review, Security, Lean Code, Performance и Accessibility производят evidence. Не каждый evaluator имеет blocking authority.

## Новый QA cycle

`qa-reject` может вернуть task из `testing` или `done` в `backlog`. Evidence текущего цикла очищается, история сохраняется. Уже завершённый Workflow может быть reopened.

## Completion

`unknown`, `skipped` и `error` не являются PASS. Но сбой optional evaluator тоже не должен автоматически блокировать платформу. Запрет возможен только у настроенных guarded quality floors в точных lifecycle moments.

> **Модель может предложить завершение. Доказательства его обосновывают. Outcome определяет owner.**
