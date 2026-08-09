# Tutorial: seu primeiro Business

Use este tutorial quando a mudança representa um resultado estratégico durável, e não apenas uma task comum.

## 1. Comece pelo intake

```bash
node contextkit/tools/scripts/work.mjs intake "Criar uma nova capacidade estratégica de onboarding self-service" --json
```

O intake é somente leitura. Observe `nature`, `executionMode`, `needsClarification`, razões e evidência.

## 2. Confirme se Business é realmente necessário

Business faz sentido quando esquecer o outcome, KPI, investimento ou racional estratégico prejudicaria o projeto. Uma feature localizada normalmente fica em `none`.

## 3. Crie o contexto deliberadamente

Use a superfície `work.mjs business` disponível no projeto e revise o dry-run quando o comando oferecer aplicação explícita. Não converta um score do classificador em aprovação humana.

O Business preserva o porquê durável; ele não obriga um Workflow.

## 4. Escolha a menor forma de execução

- `direct` para poucas tasks coesas;
- `batch` para várias tasks relacionadas sem dependência forte;
- `workflow` somente quando a topologia exige ordem, waves, múltiplas sessões ou cutover/rollback.

## 5. Relacione decisões e evidência

Registre ADR apenas quando houver uma decisão material que mereça racional durável. Reports devem guardar fatos e evidência, não duplicar estado.

## Resultado esperado

Você termina com um Business que explica valor durável, enquanto a execução continua tão pequena quanto o problema permitir.

Veja [Business-Driven Development](../explanation/business-driven-development.md) e [Executar um caso de Business](../how-to/run-a-business-case.md).
