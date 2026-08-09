# Business-Driven Development

Business-Driven Development separa tres preguntas: si existe trabajo real, quién posee de forma duradera el motivo del trabajo y qué forma de ejecución necesita.

## 1. La interacción viene primero

`conversation` y `exploration` son inertes. Solo una `mutation` confirmada entra al intake. Si no hay evidencia suficiente, el sistema pregunta una vez en lugar de inventar trabajo.

## 2. Trabajo existente antes de trabajo nuevo

El resolver puede devolver `explicit`, `inferred`, `ambiguous`, `new` o `none`. Un match ambiguo no se selecciona automáticamente y un elemento `done` no se reabre sin orden explícita.

## 3. Naturaleza

- **Business**: capacidad estratégica, producto, iniciativa o decisión duradera con outcome, KPI, sponsor/inversión u horizonte que merece memoria.
- **Operation**: contexto duradero de mantenimiento, incidente, recuperación o mejora dentro de una capacidad existente.
- **none**: resultado normal para feature, bug, docs o cambio técnico que no necesita owner duradero.
- **unclassified**: evidencia competitiva o insuficiente; requiere una aclaración corta.

## 4. Forma de ejecución independiente

`direct`, `batch` y `workflow` no dependen de la naturaleza. Business no fuerza Workflow. Architecture/ADR/compliance tampoco.

Use Workflow solo para dependencias reales, waves, orden obligatorio, múltiples sesiones, integración coordinada o cutover/rollback.

## 5. Business matching

Una Operation puede recibir un Business **sugerido** por scoring determinista. Un match débil queda `unlinked`; el matcher nunca marca `confirmed` por sí mismo.

> **El contexto duradero debe existir cuando olvidarlo perjudicaría el proyecto.**
