# Arquitetura — forma do sistema e decisões

Esta seção explica por que o ContextDevKit 4 é organizado como harness host-agnostic com autoridades pequenas, intake mutation-only e governança limitada.

## Camadas principais

```text
interaction/intake
   ↓
work ownership + execution shape
   ↓
project intelligence + memory
   ↓
work lifecycle
   ↓
evaluators / governance
   ↓
host adapters
```

## Princípios arquiteturais

- um dispatcher por evento;
- fail-open operacional (`continue`) para falhas internas;
- uma authority gravável por agregado;
- Markdown como contexto/projeção, não state writer concorrente;
- sources canônicos + projeções declaradas para hosts;
- graph como otimização com fallback;
- migration 3.x isolada do runtime normal;
- release allowlist e remoção de legado alcançável.

Veja [Arquitetura principal](../ARCHITECTURE.md), [Domain model](../explanation/domain-model.md) e [Governança](../explanation/governance-and-enforcement.md).
