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

A existência de um squad não torna seus agentes obrigatórios para todo trabalho. Na 4.x, routing é advisory e o agente ativo pode assumir a responsabilidade quando delegação não existe ou não agrega valor.

Use pipeline de squad para processos especializados, como Agent Forge, e não para transformar cada mudança simples em orquestração multiagente.

Consulte o documento inglês correspondente para o formato/schema completo.
