# Business-Driven Development

Business-Driven Development разделяет три вопроса: есть ли реальная работа, кто долговременно владеет причиной этой работы и какая форма исполнения действительно нужна.

## 1. Сначала interaction

`conversation` и `exploration` инертны. Только подтверждённая `mutation` запускает intake. Если доказательств недостаточно, ContextDevKit задаёт один короткий вопрос вместо создания вымышленной работы.

## 2. Существующая работа раньше новой

Resolver может вернуть `explicit`, `inferred`, `ambiguous`, `new` или `none`. Неоднозначное совпадение не выбирается автоматически, а завершённый элемент не открывается снова без явной команды.

## 3. Nature

- **Business** — долговечная стратегическая capability, product, initiative или decision с outcome/KPI/sponsor/investment/horizon, которые стоит помнить.
- **Operation** — долговечный контекст maintenance, incident, recovery или improvement внутри существующей capability.
- **none** — нормальный результат для feature, bug, docs или технической правки без долговечного owner.
- **unclassified** — конкурирующие или недостаточные сигналы; нужен короткий вопрос.

## 4. Execution shape независим

`direct`, `batch` и `workflow` не выводятся из Business/Operation. Business не заставляет использовать Workflow. Слова architecture, ADR или compliance тоже не заставляют.

Workflow нужен только при реальных dependencies, waves, обязательном порядке, multi-session execution, coordinated integration или cutover/rollback.

## 5. Business matching

Operation может получить **suggested** Business через детерминированный scoring. Слабое совпадение остаётся `unlinked`; matcher никогда сам не ставит `confirmed`.

> **Долговечный контекст нужен тогда, когда его потеря повредит проекту.**
