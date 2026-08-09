# Tutorial: sua primeira sessão com ContextDevKit

Este tutorial leva um projeto do zero até uma primeira sessão governada sem exigir que você conheça toda a metodologia.

## Pré-requisitos

- Node.js 18+;
- um projeto local, com ou sem Git;
- pelo menos um host suportado, como Claude Code ou Codex.

## 1. Instale

```bash
npx contextdevkit --target /caminho/do/projeto
```

O instalador cria o runtime, memória inicial, adapters do host e referências de personalização sem alterar o código da aplicação.

## 2. Entenda o comportamento silencioso

Perguntas e exploração somente leitura não criam tasks nem workflows. A governança começa quando existe intenção real de mutação.

Experimente primeiro perguntar sobre o projeto. Depois peça uma alteração pequena. O intake deve distinguir os dois casos.

## 3. Consulte o estado

```bash
node cdx.mjs state
```

No Codex use `cdx.mjs`; nos demais hosts use a superfície compartilhada disponível no projeto, normalmente `ctx.mjs`.

## 4. Faça uma mudança pequena

Peça uma alteração localizada. O comportamento esperado é `direct`, sem Business/Operation/Workflow artificiais quando não existe motivo durável para isso.

## 5. Registre a sessão quando houver valor durável

Use `/log-session` ou o comando equivalente do host para preservar o que realmente merece sobreviver à janela de contexto.

## 6. Explore a inteligência do projeto

```bash
node cdx.mjs project-map --find <símbolo-ou-path>
```

Se o grafo não responder, a busca normal continua disponível imediatamente.

## Próximos passos

- [Business-Driven Development](../explanation/business-driven-development.md)
- [Loop Engineering orientado a evidência](../explanation/loop-engineering.md)
- [Governança e enforcement](../explanation/governance-and-enforcement.md)
- [Anatomia de Business, Operation e Workflow](../how-to/anatomy-of-business-operation-workflow.md)
