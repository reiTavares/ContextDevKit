# Modelo de calidad

ContextDevKit 4 separa observaciones de autoridad.

## Estados de evidencia

```text
passed | violated | unknown | skipped | error
```

`unknown`, `skipped` y `error` nunca se presentan como PASS.

## QA

Protege la transición a `done` cuando el predicate guarded es aplicable. No bloquea el inicio de implementación.

## DDD

Solo un invariante Clase A declarado, aplicable y determinísticamente violado puede participar del floor guarded. Opinión del clasificador o mapa no confirmado no basta.

## Technical Debt

Funciona como ratchet del diff actual. Solo deuda nueva `high`/`critical` introducida por la modificación actual puede negar completion bajo el modo guarded configurado. Deuda histórica no debe bloquear trabajo no relacionado.

## Architecture Debt

Es una evaluación más amplia y permanece `canary`. Puede descubrir riesgo estructural y aportar evidencia a otras decisiones, pero no se convierte silenciosamente en un cuarto gate guarded.

## Code review y Lean Code

Son responsabilidades de ingeniería/advisory. Un hallazgo debe incluir evidencia y contexto; tamaño de archivo, por sí solo, nunca es un veredicto arquitectónico.
