# Ejecutar un caso de Business

Use este flujo solo cuando el trabajo representa un outcome estratégico duradero.

## 1. Intake read-only

```bash
node contextkit/tools/scripts/work.mjs intake "<objetivo>" --json
```

Revise `nature`, `executionMode`, aclaración, razones y evidencia. `none` es válido; no cree Business para una feature ordinaria.

## 2. Cree el Business deliberadamente

Use la superficie `work.mjs business` del proyecto. El clasificador informa; la creación/confirmación de ownership es una decisión explícita.

## 3. Seleccione ejecución mínima

Business puede usar direct, batch o Workflow. Use Workflow solo por topología real.

## 4. Operations relacionadas

Una Operation puede proteger el outcome de un Business. El matcher puede sugerir el vínculo, pero no confirmar ownership automáticamente.

## 5. Evidencia y decisiones

Registre ADRs cuando exista una decisión material. Reports contienen hechos; JSON mantiene state authority.

## 6. Outcome

El objetivo es conservar el contexto estratégico que debe sobrevivir entre sesiones sin obligar a todo cambio técnico a vivir bajo un Business.
