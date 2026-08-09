# Loop Engineering basado en evidencia

ContextDevKit trata la entrega como un ciclo de ingeniería, no como generación de una sola pasada.

```text
implementar
  ↓
evaluar
  ↓
hallazgos
  ↓
corregir
  ↓
reevaluar
  ↓
evidencia nueva
  ↓
done
```

El agent loop pertenece al host. El engineering loop pertenece al proyecto y puede sobrevivir a compactación, nueva sesión, otro modelo u otro host.

## Profundidad adaptativa

El agente activo decide la profundidad según complejidad, alcance, riesgo, blast radius, contratos afectados, dominio, critical paths, instrucción del owner y evidencia disponible.

Un typo puede requerir validación enfocada. Una feature material puede requerir tests + code review. Un cambio crítico puede justificar QA completo, DDD, arquitectura, security, debt, integration/E2E o performance.

## Evaluadores

QA, DDD, Technical Debt, Architecture Debt, Code Review, Security, Lean Code, Performance y Accessibility producen evidencia. No todos tienen autoridad de bloqueo.

## Ciclo QA fresco

`qa-reject` puede devolver una task de `testing` o `done` a `backlog`. La evidencia del ciclo actual se limpia; el historial permanece. Un Workflow completado puede reabrirse.

## Finalización

`unknown`, `skipped` y `error` no son PASS. Tampoco todo fallo opcional bloquea la plataforma. Solo los quality floors guarded configurados pueden negar en sus momentos exactos.

> **El modelo puede proponer la finalización. La evidencia la justifica. El owner define el outcome.**
