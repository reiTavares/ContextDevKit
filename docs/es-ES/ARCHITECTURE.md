# Arquitectura

ContextDevKit es un **AI Software Engineering Governance Harness** host-agnostic. El host conserva el agent loop, las herramientas y los límites de seguridad de la plataforma; ContextDevKit aporta la capa duradera del proyecto: inteligencia, memoria, contexto, ciclo de trabajo, evidencia y gobernanza.

## Flujo de interacción

```text
solicitud
  ↓
conversation | exploration | mutation | unclassified
  ↓ (solo mutation)
Intake Envelope
  ↓
Business | Operation | none
  ↓
direct | batch | workflow
```

Conversación y exploración no crean estado duradero. Una intención incierta genera una pregunta corta. Un intento real de escritura promueve la interacción a `mutation`.

## Intake Envelope

Es una vista transitoria formada por señales ya existentes: interacción, trabajo existente, naturaleza, forma de ejecución, tier/complejidad, dominio/riesgo, value intent, decision need/match, Business match, razones y evidencia. No es un archivo nuevo ni una ceremonia obligatoria.

## Autoridades de estado

| Estado | Autoridad |
| --- | --- |
| definición de Workflow | `workflow.json` |
| lifecycle de Workflow | `workflow-state.json` |
| tasks/status/events | `pipeline/tasks.json` |
| ejecución transitoria | `memory/runs/<id>/state.json` |
| preferencias | `memory/preferences/owner-preferences.json` |

Markdown es contexto autorado o proyección derivada, nunca una segunda autoridad de estado.

## Gobernanza

Solo QA sign-off, invariantes DDD Clase A aplicables y Technical Debt nuevo high/critical pueden estar `guarded` por defecto. Architecture Debt es `canary`; Privacy/LGPD es `shadow`. Errores internos degradan a `continue`.

## Hosts

Las fuentes canónicas generan proyecciones para Claude Code, Codex, Antigravity y Grok. El host puede cambiar sin perder la memoria e inteligencia gobernada del proyecto.
