# Глоссарий

| Термин | Значение |
| --- | --- |
| Harness | долговечный слой вокруг coding host: context, memory, work lifecycle, evidence и governance |
| interaction | `conversation`, `exploration`, `mutation` или `unclassified` |
| Intake Envelope | временное представление сигналов intake; не persisted artifact |
| Business | долговечный стратегический контекст `BIZ-####` |
| Operation | долговечный операционный контекст `OP-####` |
| none | работа без долговечного Business/Operation owner |
| direct | небольшая связная execution shape |
| batch | несколько связанных tasks без сильного порядка |
| Workflow | координированная работа с dependencies/waves/multi-session/cutover |
| task | единица работы в `pipeline/tasks.json` |
| guarded | режим, способный deny только при полном deterministic predicate |
| canary | оценивает/сообщает без deny |
| shadow | наблюдает без изменения outcome |
| Architecture Debt | canary-анализ структурного риска |
| Technical Debt | guarded ratchet для нового high/critical debt текущего diff |
| engineering loop | implement → evaluate → correct → re-evaluate с новым evidence |
| owner override | явное аудируемое принятие guarded verdict человеком |

Task statuses: `backlog`, `working`, `blocked`, `testing`, `done`, `cancelled`.
