# Modelo de memória

`contextkit/memory/` preserva conhecimento durável do projeto e projeções reconstruíveis.

## Conteúdo durável

- `business/` — contextos estratégicos;
- `operations/` — contextos operacionais;
- `workflows/` — Workflows neutros quando aplicável;
- `decisions/` — ADRs;
- `sessions/` — histórico factual de sessões;
- `preferences/` — personalização e recomendações do owner;
- reports dentro dos scopes de trabalho.

## Estado transitório/reconstruível

- `runs/` — estado de execução;
- Project Map/índices gerados;
- Markdown derivado como `tasks.md`/`index.md`;
- caches e staging.

## Autoridade

Memória não significa que todo Markdown é authority. Workflow/task lifecycle usa os JSON canônicos correspondentes.

## Git

Memory pode ser versionada ou ignorada conforme modo/projeto. Project Map deve conseguir indexar roots de memória configuradas mesmo quando gitignored.

## Personalização

`personalization.md` é contexto explícito do owner e não deve ser sobrescrito em update. `owner-preferences.json` é recommendation-only.
