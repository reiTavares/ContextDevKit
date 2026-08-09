# Usar o grafo estrutural

Project Map/grafo é o fast path preferido para perguntas estruturais, não uma limitação de busca.

## Consulta

```bash
node cdx.mjs project-map --find <símbolo-ou-path>
```

Outras superfícies do projeto podem expor callers, impact e queries estruturais.

## Regra de fallback

Se o grafo estiver ausente, stale, parcial ou não encontrar o símbolo, informe isso brevemente e use imediatamente `rg`, Grep, Glob ou exploração normal.

Não é necessário bypass humano.

## Memory

O grafo deve incluir as roots de memória configuradas mesmo quando são gitignored. Git é metadado auxiliar; não define o que a inteligência do projeto pode indexar.

## Providers externos

A interface de provider permite integrar outros grafos. O comportamento esperado continua: lookup preferido, fallback imediato.
