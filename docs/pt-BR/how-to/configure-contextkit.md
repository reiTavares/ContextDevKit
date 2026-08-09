# Configurar o ContextDevKit

A configuração vive em `contextkit/config.json` e é lida pelo runtime zero-dependency.

## Princípios

- configuração ausente/inválida de governance degrada para `canary/continue`;
- `humanAuthority` padrão é `owner-wins`;
- routing/model/swarm/economy são recomendações;
- somente os três domínios allowlisted podem ser guarded;
- níveis habilitam capacidades, não consentimento.

## Gates

Exemplo conceitual:

```json
{
  "governance": {
    "defaultMode": "canary",
    "failurePolicy": "continue",
    "humanAuthority": "owner-wins",
    "gates": {
      "qa-signoff": "guarded",
      "ddd-invariants": "guarded",
      "technical-debt": "guarded",
      "architecture-debt": "canary",
      "privacy-lgpd": "shadow"
    }
  }
}
```

O owner pode alterar modos conforme o projeto, dentro do contrato do runtime.

## QA

`qa.criticalPaths` e `qa.coverageTarget` orientam planejamento e sign-off, mas não tornam todo request uma execução de QA Full.

## Análise

Exclusões de análise, Project Map e políticas de debt devem refletir o projeto real. Não use file-size como blocker de arquitetura.

Para chaves completas, consulte a [referência de configuração](../reference/config.md).
