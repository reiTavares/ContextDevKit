# Squad Pipeline Format v1

Squad pipelines descrevem procedimentos reutilizáveis de coordenação entre especialistas para casos em que a própria feature precisa de uma sequência definida.

## O que um pipeline de squad descreve

- etapas;
- papéis/especialistas;
- entradas e artefatos;
- dependências;
- critérios de avaliação;
- comportamento de falha/retry quando aplicável.

## O que ele não significa

A existência de um squad não torna seus agentes obrigatórios para todo trabalho. Na 4.x, routing recomenda o executor, mas não autoriza o dispatch. Debate ou swarm tornam-se obrigatórios quando a instrução atual do owner, o workflow/skill selecionado ou a classificação governada os ativa; fora desses gatilhos, permanecem opcionais.

Use pipeline de squad para processos especializados, como Agent Forge, e não para transformar cada mudança simples em orquestração multiagente.

Consulte o documento inglês correspondente para o formato/schema completo.
