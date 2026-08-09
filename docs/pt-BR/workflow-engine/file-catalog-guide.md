# Catálogo de arquivos de Workflow

Um pacote v2 completo usa responsabilidades separadas.

| Arquivo | Responsabilidade |
| --- | --- |
| `workflow.json` | definição estável, owner, objetivo e topologia |
| `workflow-state.json` | status/fase/revisão/QA agregado |
| `context-manifest.json` | contexto que precisa ser carregado |
| `prd.md` | requisito/produto |
| `spec.md` | contrato técnico |
| `decisions.md` | decisões locais e referências |
| `pipeline/tasks.json` | authority de tasks/status/events/evidence |
| `pipeline/tasks.md` | projeção humana gerada |
| `index.md` | visão humana gerada do pacote |
| `CONTINUATION-PROMPT.md` | guidance opcional para continuidade |
| `reports/` | evidência factual e relatórios |

Nenhum Markdown de projeção deve virar segundo writer do estado JSON.

O gerador deve criar atomicamente todos os artefatos obrigatórios antes de publicar o diretório final.
