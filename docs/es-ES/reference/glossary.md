# Glosario

| Término | Significado |
| --- | --- |
| Harness | capa duradera que gobierna contexto, memoria, work lifecycle y evidencia alrededor del coding host |
| interaction | `conversation`, `exploration`, `mutation` o `unclassified` |
| Intake Envelope | vista transitoria de señales de intake; no es un artifact persistente |
| Business | contexto estratégico duradero `BIZ-####` |
| Operation | contexto operacional duradero `OP-####` |
| none | trabajo sin owner duradero Business/Operation |
| direct | ejecución pequeña y cohesionada |
| batch | varias tasks relacionadas sin orden fuerte |
| Workflow | ejecución coordinada con dependencias/waves/multi-session/cutover |
| task | unidad de trabajo en `pipeline/tasks.json` |
| guarded | modo capaz de negar solo con predicate determinista completo |
| canary | evalúa/report pero no niega |
| shadow | observa sin cambiar outcome |
| quality floor | condición mínima de calidad configurada para completion/write boundary |
| Architecture Debt | análisis estructural canary |
| Technical Debt | ratchet guarded para nueva deuda high/critical del diff actual |
| engineering loop | implementar → evaluar → corregir → reevaluar con evidencia nueva |
| owner override | aceptación humana explícita y auditable de un verdict guarded |

Status de task: `backlog`, `working`, `blocked`, `testing`, `done`, `cancelled`.
