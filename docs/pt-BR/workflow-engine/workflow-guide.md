# Guia de Workflow

Use Workflow somente quando a execução realmente precisa de uma estrutura durável de coordenação.

## Escolha

Prefira `direct` ou `batch` quando não houver dependências fortes. Workflow é para:

- waves;
- grupos dependentes;
- ordem obrigatória;
- multi-session;
- integração coordenada;
- cutover/rollback.

## Lifecycle

As fases orientam a entrega, mas o estado é autoridade de `workflow-state.json`, não da posição da pasta.

## Contexto

Antes de mutar um Workflow, carregue PRD, SPEC, decisions, manifest, tasks e reports aplicáveis.

## Conclusão e reopen

Completion precisa de evidência QA explícita. Se feedback posterior rejeitar uma task concluída, o aggregate pode reabrir e iniciar um ciclo fresco.
