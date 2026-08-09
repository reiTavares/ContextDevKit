# Criar um Agent Package

Use Agent Forge quando o produto do projeto é um agente portátil que precisa sair como pacote versionado, com prompt, tools, evals e governança próprios.

## Pipeline conceitual

```text
blueprint
  ↓
model routing
  ↓
prompt/tool design
  ↓
evals + governance
  ↓
packaging
```

Os especialistas do `agent-forge` são específicos desse caso de uso e não devem ser confundidos com agentes obrigatórios para desenvolvimento comum.

## Qualidade

O package deve carregar provenance, rationale estrutural, schemas de tools, evals suficientes para o domínio e configuração explícita de custo/compliance/quality.

## Portabilidade

O objetivo do APF é permitir que o agente seja consumido fora do próprio ContextDevKit sem depender da memória interna do projeto para funcionar.

Consulte a referência `AGENT-PACKAGE-FORMAT.md` para o contrato completo.
