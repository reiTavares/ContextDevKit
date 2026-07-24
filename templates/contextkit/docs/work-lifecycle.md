# Canonical Work Lifecycle

This is the authoritative human-readable lifecycle projection. Machine truth
remains in `policy/journey.json`, the ceremony-shape mapping in
`methodology/templates/manifest.json`, and the current entity/workflow state.

The lifecycle is:

`intake -> owner context -> governance/workflow -> tasks when plural -> implementation -> tests -> QA when material -> conclude/close and move to done -> session log`

The five branches are:

| Ceremony shape | Journey branch | `tasks.json` authoring |
| --- | --- | --- |
| `quick-fix` | `operation-direct` | absent |
| `batch-operation` | `operation-batch` | advisory until populated |
| `single-workflow-operation` | `operation-workflow` | advisory until populated |
| `decision-only` | `business-decision` | absent |
| `multi-workflow-program` | `business-workflow` | advisory until populated |

Every governed branch ends at `done-move`. `log-session` is post-terminal
bookkeeping, so the complete human lifecycle remains `done -> log` without
weakening `done-move` as the terminal state transition. Use the exact `conclude` or `close` command
reported by `node contextkit/tools/scripts/work.mjs next`; never hand-move an
entity or workflow. `work map` renders a 100% derived Lifecycle Map and rejects
stored content that diverges from `journey + manifest + state`.

Pure questions and read-only investigations are exempt from this write
lifecycle. Missing or unreadable journey/state inputs are skipped silently and
never fail-close real work.

The read-only `work next` / `work map` surfaces can be disabled without
removing the journey or its commands by setting `CONTEXTKIT_WORK_DISCOVERY=0`.

## Ciclo canônico de trabalho (pt-BR)

Esta é a projeção humana autoritativa do ciclo. A verdade de máquina permanece
em `policy/journey.json`, no mapeamento de formas em
`methodology/templates/manifest.json` e no estado atual da entidade/workflow.

O ciclo é:

`intake -> contexto proprietário -> governança/workflow -> tarefas quando houver pluralidade -> implementação -> testes -> QA quando material -> concluir/fechar e mover para done -> registrar a sessão`

As formas `batch-operation`, `single-workflow-operation` e
`multi-workflow-program` incluem a autoria de `tasks.json`, em modo consultivo
até existir conteúdo. `quick-fix` e `decision-only` não incluem essa etapa.

Todos os ramos governados terminam em `done-move`; `log-session` é o registro
pós-terminal, preservando o fluxo humano `done -> log`. Execute o comando exato indicado por
`work next`; nunca mova arquivos manualmente. Perguntas puras e investigações
somente-leitura são isentas. Entradas ausentes ou ilegíveis são ignoradas sem
bloquear o trabalho.

As superfícies somente-leitura `work next` / `work map` podem ser desativadas
sem remover a jornada ou seus comandos com `CONTEXTKIT_WORK_DISCOVERY=0`.
