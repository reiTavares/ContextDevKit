# Модель качества

ContextDevKit 4 отделяет наблюдения от authority.

## Состояния evidence

```text
passed | violated | unknown | skipped | error
```

`unknown`, `skipped` и `error` никогда не маскируются под PASS.

## QA

Защищает переход в `done`, когда guarded predicate применим. Не блокирует начало implementation.

## DDD

Только объявленный, применимый и детерминированно нарушенный Class A invariant может участвовать в guarded floor. Мнение classifier или неподтверждённая domain map недостаточны.

## Technical Debt

Работает как ratchet текущего diff. Только новый `high`/`critical` debt, внесённый именно текущим изменением, может блокировать completion при соответствующем режиме. Исторический debt не должен блокировать несвязанную работу.

## Architecture Debt

Это более широкая структурная оценка в режиме `canary`. Она может находить риск и давать evidence, но не превращается автоматически в четвёртый guarded gate.

## Code Review и Lean Code

Остаются инженерными/advisory responsibilities. Finding должен иметь evidence и context; размер файла сам по себе не является архитектурным verdict.
