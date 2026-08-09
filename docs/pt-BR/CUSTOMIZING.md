# Personalizando o ContextDevKit

O kit funciona com defaults, mas deve refletir o projeto real.

## Personalização durável

Use `contextkit/memory/preferences/personalization.md` para instruções explícitas do projeto. O installer não deve sobrescrever esse conteúdo em updates.

`owner-preferences.json` guarda recomendações estruturadas e nunca supera a instrução atual do owner.

## Governança

Ajuste modos de gates quando o projeto exigir. Defaults 4.x:

- QA, DDD Classe A e Technical Debt novo high/critical: `guarded`;
- Architecture Debt e demais guidance: `canary`;
- LGPD: `shadow`.

## QA

Configure critical paths/coverage para o domínio real. Evite transformar coverage global em métrica vazia.

## Project Map

Configure roots/exclusões sem esconder `memory/`. Graph-first continua sendo preferência, não obrigação.

## Hosts

Altere sources canônicos e regenere projeções. Não personalize um arquivo gerado como se fosse authority.
