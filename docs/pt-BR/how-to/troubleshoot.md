# Troubleshooting

Use esta sequência para separar falha do projeto de falha do próprio ContextDevKit.

## 1. Rode o doctor

```bash
node contextkit/tools/scripts/doctor.mjs
```

Verifique wiring do host, versão, paths, config e autoridade ativa.

## 2. Classifique o tipo de problema

- **governance runtime**: timeout, circuit breaker, config inválida;
- **state**: JSON ausente/corrupto/CAS stale;
- **projection**: `tasks.md`, host agents/skills ou índices em drift;
- **graph**: stale/indisponível — use fallback normal;
- **project/test**: falha real da aplicação;
- **migration**: use somente o migrador offline.

## 3. Não transforme falha interna em bloqueio

O runtime 4.x usa `failurePolicy: continue`. Erro de evaluator, graph ou routing deve ficar visível como diagnóstico sem inventar PASS nem impedir trabalho real fora dos três predicates guarded aplicáveis.

## 4. Repare projeções a partir da autoridade

Nunca faça Markdown virar source of truth para corrigir JSON. Use os comandos de `sync`, render ou regeneração apropriados.

## 5. Se o mesmo finding repetir

Verifique se a correção está convergindo, se o evaluator está stale e se o finding pertence ao scope. Não entre em retry infinito.
