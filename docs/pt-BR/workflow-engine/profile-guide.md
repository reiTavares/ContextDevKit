# Perfis e patterns de Workflow

Profiles/patterns ajudam a sugerir topologia e profundidade, mas não mudam as autoridades de estado nem transformam recomendação em permissão.

## Uso

Escolha um profile quando ele descreve bem o formato de entrega. Não use profile para forçar um Workflow que a topologia não exige.

## Invariantes

Independentemente do profile:

- `workflow.json` define topologia;
- `workflow-state.json` define lifecycle;
- `tasks.json` define tasks/status;
- Markdown é projeção/contexto;
- completion precisa de evidência aplicável.

Um profile pode sugerir especialistas, checks ou artefatos adicionais, mas a ausência de um agente não é receipt obrigatório.
