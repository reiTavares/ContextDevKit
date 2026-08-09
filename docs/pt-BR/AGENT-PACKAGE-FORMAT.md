# Agent Package Format (APF) v1

APF descreve um agente portátil como pacote versionado, separado da memória de execução do ContextDevKit.

## Objetivo

Um Agent Package deve carregar tudo o que outro runtime precisa para entender:

- identidade e versão;
- system prompt canônico e variantes por provider;
- tool schemas;
- seleção/racional estrutural de modelo;
- evals e thresholds;
- governança de custo/compliance/quality;
- provenance;
- RAG quando aplicável.

## Princípio de portabilidade

O pacote não deve depender de uma sessão específica do projeto para funcionar. Contexto de projeto pode alimentar a criação do agente, mas o artifact final precisa ser autocontido dentro do contrato APF.

## Governança

Agent Forge pode ter gates específicos de packaging/evals. Esses gates pertencem ao produto Agent Package e não devem virar requisitos universais para qualquer mudança de software.

Consulte o documento inglês correspondente para o schema detalhado quando precisar de lookup campo a campo.
