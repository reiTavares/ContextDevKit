# Contrato de governança

Esta é a referência pública resumida da governança ContextDevKit 4.

## Eventos

```text
prompt-preflight
write-preflight
postflight
completion
```

Cada evento usa um dispatcher central com deduplicação, timeout, budget, proteção de reentrada e circuit breaker.

## Modos

```text
off | shadow | canary | guarded
```

Config ausente/inválida e falha interna degradam para `canary/continue`.

## Allowlist guarded

Somente:

| Gate | Momento | Predicate de negação |
| --- | --- | --- |
| `qa-signoff` | completion | violação determinística/aplicável/evidenciada ligada à transição `done` |
| `ddd-invariants` | write-preflight/completion | invariante Classe A aplicável e comprovado |
| `technical-debt` | completion | dívida nova high/critical introduzida pelo diff atual |

`architecture-debt` é canary e `privacy-lgpd` é shadow por padrão.

## Owner

`humanAuthority` padrão: `owner-wins`.

Override guarded exige metadata de ator, razão, escopo, policy version/hash, revisão base, timestamp, expiração e outcome. Override não reescreve evidência.

## Falhas

`unknown`, `skipped` e `error` não são PASS; também não negam sem predicate guarded completo.
