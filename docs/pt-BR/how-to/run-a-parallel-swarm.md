# Executar trabalho paralelo com swarm

Use swarm quando existem workstreams realmente independentes e o host oferece paralelismo útil.

## Quando usar

- várias tasks prontas e disjuntas;
- touch sets sem sobreposição relevante;
- ganho real de tempo maior que custo de coordenação.

## Quando não usar

- mudança pequena;
- dependências fortes entre tasks;
- conflito provável no mesmo estado/arquivo;
- fan-out mais caro que execução direta.

## Contrato 4.x

Swarm é advisory. Não existe cap metodológico que autorize ou negue trabalho; apenas limites técnicos reais do host importam.

Cada workstream deve receber scope explícito e contexto suficiente. O controller consolida resultados, findings e evidência.

Se um agente especializado não estiver disponível, o trabalho pode continuar no agente ativo.

## Qualidade

Paralelismo não muda os quality floors. Cada mudança continua responsável por testes, findings atribuíveis e evidência atual.
