# Referência do grafo estrutural

O Project Map/grafo fornece um fast path determinístico para perguntas estruturais sobre o projeto: módulos, símbolos, dependências, chamadas, referências e blast radius quando a informação estiver disponível.

## Princípio graph-first

Graph-first significa **preferir** o índice quando ele responde melhor e com menos custo. Não significa proibir `grep`, busca textual, leitura direta ou outras ferramentas.

Se o grafo estiver ausente, stale, parcial, degradado ou incapaz de responder, o agente deve usar busca normal imediatamente.

## Memory é parte do projeto

Roots de governança podem ser indexadas mesmo quando um diretório pai é ignorado pelo Git. `contextkit/memory/` é memória autoritativa do projeto e não deve ser tratado como irrelevante por estar gitignored.

O grafo pode incluir, conforme configuração e provider:

- source code e módulos;
- Workflows e Tasks ativos;
- Business e Operations;
- ADRs/decisions;
- reports;
- owner preferences e outras raízes de memória governada.

## Providers

O runtime possui uma boundary de provider para permitir outros grafos/índices. A indisponibilidade de um provider é degradação observável, nunca permissão para bloquear exploração.

Veja [Como usar o grafo](../how-to/use-the-knowledge-graph.md), [Arquitetura](../ARCHITECTURE.md) e [Memória](memory-model.md).
