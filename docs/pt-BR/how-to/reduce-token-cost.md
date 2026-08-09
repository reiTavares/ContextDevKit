# Reduzir custo de tokens

Economia existe para reduzir trabalho repetitivo sem reduzir qualidade.

## Princípios

1. Use Project Map/grafo para localizar antes de carregar grandes áreas do repo.
2. Use context packs delimitados para subagentes.
3. Rode testes/commands verbosos por `run-compact`.
4. Delegue trabalho mecânico somente quando o handoff custar menos que executar direto.
5. Não repita contexto que o agente já recebeu.
6. Trate quota/custo desconhecido como `skipped`, nunca estimativa apresentada como medição.

## Compactar saída

```bash
node contextkit/tools/scripts/economy/run-compact.mjs <comando>
```

O log completo fica fora do contexto principal; resumo e exit code permanecem utilizáveis.

## Routing

Model policy e economy hints são recomendações. Falha no resolver não bloqueia a task.

## Loops

Em reavaliações, rode apenas checks impactados quando isso ainda prova o outcome; não repita uma suíte cara sem necessidade factual.
