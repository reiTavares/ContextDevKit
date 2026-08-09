# Gobernanza y enforcement

ContextDevKit separa quality floors deterministas de orientación de ingeniería.

## Modos

- `off`: desactivado;
- `shadow`: observa sin afectar el outcome;
- `canary`: evalúa y reporta sin negar;
- `guarded`: puede negar únicamente una violación determinista, aplicable y evidenciada en el momento documentado.

## Tres quality floors guarded por defecto

1. QA sign-off en completion;
2. invariantes DDD Clase A declarados y aplicables;
3. Technical Debt nuevo `high`/`critical` introducido por el diff actual.

Architecture Debt es `canary`; Privacy/LGPD es `shadow`. Graph, routing, swarm, economy, simulations, councils y specialist selection no son permisos ocultos.

## Fallos del propio harness

Config inválida, timeout, evaluator error o evidencia opcional desconocida degradan a `canary/continue`. El sistema no debe romper trabajo real porque su propia gobernanza falló.

## Owner sovereignty

`humanAuthority` usa `owner-wins`. Un override guarded registra actor, razón, scope, revisión y outcome; no transforma evidencia fallida en PASS ni sustituye los límites reales de seguridad del host.
