# Запустить Business case

Используйте этот поток только когда работа представляет долговечный стратегический outcome.

## 1. Read-only intake

```bash
node contextkit/tools/scripts/work.mjs intake "<цель>" --json
```

Проверьте `nature`, `executionMode`, clarification, причины и evidence. `none` — валидный результат; не создавайте Business для обычной feature.

## 2. Создайте Business осознанно

Используйте `work.mjs business` в проекте. Classifier даёт информацию; создание и подтверждение ownership остаются явным решением.

## 3. Выберите минимальную execution shape

Business может использовать direct, batch или Workflow. Workflow нужен только по реальной topology.

## 4. Связанные Operations

Operation может поддерживать outcome Business. Matcher способен предложить связь, но не подтверждает strategic ownership автоматически.

## 5. Decisions и evidence

Создавайте ADR только для material decision. Reports хранят факты, JSON — state authority.

## 6. Результат

Цель — сохранить стратегический контекст, который должен пережить сессии, не заставляя каждую техническую правку жить под Business.
