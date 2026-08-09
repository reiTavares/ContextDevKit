# Anatomia de um Business, Operation e Workflow

Objetivo: entender a memória durável de governança do ContextDevKit em uma leitura — o que são **Business**, **Operation** e **Workflow**, como se relacionam, onde vivem e quais arquivos são autoridade.

> English: see [anatomy-of-business-operation-workflow.md](anatomy-of-business-operation-workflow.md).

## As três unidades duráveis

| Unidade | Id | O que é |
| --- | --- | --- |
| **Business** | `BIZ-####` | Capacidade estratégica, produto, iniciativa ou decisão durável. Guarda um **porquê** de longo prazo. |
| **Operation** | `OP-####` | Contexto durável de operação, manutenção, recuperação, incidente ou melhoria. Guarda uma **razão operacional** de longo prazo. |
| **Workflow** | `WF-####` | Agregado de entrega coordenada usado quando existem dependências reais, waves, ordem obrigatória, múltiplas sessões ou cutover/rollback. |

Nem toda mudança precisa de qualquer uma dessas unidades.

Uma feature focada, bug localizado, edição de docs ou mudança técnica pode ter natureza `none` e continuar como trabalho direct/batch sem criar Business ou Operation.

## Business e Operation são contextos separados

Business e Operation vivem em raízes diferentes.

Uma Operation pode contribuir para ou proteger um outcome de Business, mas esse relacionamento é um vínculo — não uma exigência de que toda Operation fique fisicamente dentro de um Business.

O matcher determinístico pode **sugerir** um Business relacionado a uma Operation. Ele nunca confirma ownership estratégico sozinho.

## Ownership é separado da forma de execução

Business e Operation podem possuir trabalho direct/batch ou um ou mais Workflows.

Workflow é escolhido pela topologia real da execução, não porque o owner é Business ou Operation.

Use Workflow quando houver dependências, waves, ordem obrigatória, execução multi-session, integração coordenada ou cutover/rollback.

## Onde vivem

A memória durável fica sob `contextkit/memory/` — ou sob a geração ativa indicada pelo authority marker v4:

```text
contextkit/memory/
├── business/
│   └── BIZ-####-slug/
│       ├── business.json
│       ├── business-case.md
│       ├── growth.md
│       ├── investment-decision.md
│       ├── workflows/
│       └── done/
├── operations/
│   └── OP-####-slug/
│       ├── operation.json
│       ├── reason.md
│       ├── batch/
│       │   ├── tasks.json
│       │   └── tasks.md
│       ├── workflows/
│       └── done/
├── workflows/
│   ├── WF-####-slug/          # Workflow neutro ativo
│   └── done/                  # colocação de Workflow neutro concluído
├── decisions/
├── sessions/
├── preferences/
└── runs/
```

Após migração 3.x→4.x, a raiz ativa pode estar fora da pasta original; consumidores usam o resolver canônico em vez de hard-code de caminho.

## Arquivos de Business

Business mantém contexto estratégico durável:

- `business.json` — registro de máquina;
- `business-case.md` — valor/outcome;
- `growth.md` — contexto de crescimento/valor quando aplicável;
- `investment-decision.md` — contexto de investimento/decisão quando aplicável;
- `workflows/` / `done/` — Workflows possuídos diretamente pelo Business.

Business não é pai obrigatório de todo trabalho.

## Arquivos de Operation

Operation mantém contexto operacional durável:

- `operation.json` — registro de máquina;
- `reason.md` — motivo, escopo, findings e contexto operacional;
- `batch/tasks.json` — autoridade canônica das tasks direct/batch quando pertencem à Operation;
- `batch/tasks.md` — projeção humana gerada;
- `workflows/` / `done/` — Workflows ativos/concluídos da Operation.

## Pacote Workflow v2

```text
WF-####-slug/
├── workflow.json
├── workflow-state.json
├── context-manifest.json
├── prd.md
├── spec.md
├── decisions.md
├── index.md                    # gerado
├── CONTINUATION-PROMPT.md      # guidance opcional gerado
├── pipeline/
│   ├── tasks.json
│   └── tasks.md                # gerado
└── reports/
```

### Autoridades

- `workflow.json` possui definição/topologia;
- `workflow-state.json` possui lifecycle;
- `pipeline/tasks.json` possui tasks/status/events/evidência;
- `tasks.md` e `index.md` são projeções;
- reports são evidência/contexto factual, não autoridade de lifecycle.

## Colocação de concluídos

Depois da conclusão JSON-first, um pacote validado pode ser movido para `done/` do owner — ou para `memory/workflows/done/` quando neutro — apenas para navegação humana.

A posição da pasta **não** é autoridade de status.

Um Workflow pode ser reaberto quando QA posterior rejeita uma task concluída. O lifecycle JSON muda primeiro e o pacote retorna à raiz ativa.

## Novos ciclos de QA

Uma task pode voltar de `testing` ou `done` para `backlog` via `qa-reject`:

```text
testing / done
      ↓
  qa-reject
      ↓
    backlog
      ↓
    working
      ↓
    testing
      ↓
 evidência nova
      ↓
     done
```

A evidência do ciclo atual é limpa quando a rodada reinicia. Eventos históricos permanecem para auditoria.

## ADRs e decisões

ADRs preservam decisões materiais em `memory/decisions/`.

Contextos Business/Operation/Workflow podem referenciar ADRs relevantes, mas um ADR não força Workflow nem classificação Business/Operation por si só.

## Memória é inteligência do projeto

Essas estruturas não existem para maximizar artefatos.

Elas existem para preservar informação que vale a pena sobreviver à troca de sessão, modelo ou host.

> **Contexto durável deve existir quando esquecê-lo prejudicaria o projeto.**

Veja [Business-Driven Development](../explanation/business-driven-development.md), [Evidence-Driven Loop Engineering](../explanation/loop-engineering.md) e [Work and governance domain model](../explanation/domain-model.md).
