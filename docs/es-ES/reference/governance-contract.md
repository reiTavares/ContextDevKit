# Contrato de gobernanza

Eventos del runtime:

```text
prompt-preflight | write-preflight | postflight | completion
```

Cada evento usa un dispatcher único con deduplicación, timeout, budget, re-entry protection y circuit breaker.

## Política

Defaults: `defaultMode=canary`, `failurePolicy=continue`, `humanAuthority=owner-wins`.

Solo `qa-signoff`, `ddd-invariants` y `technical-debt` están en la allowlist guarded. `architecture-debt` es canary y `privacy-lgpd` shadow.

Una negación guarded requiere observación `violated`, determinista, aplicable, evidenciada y actual, además del predicate específico del gate.

## Override humano

Un override válido es scope/revision-bound, temporal y auditable. Registra la aceptación del owner sin alterar la evidencia original.

## Fallos

Evidencia ausente o stale no es PASS. Error interno del harness sigue `continue` salvo que exista un predicate guarded completo independiente de ese error.
