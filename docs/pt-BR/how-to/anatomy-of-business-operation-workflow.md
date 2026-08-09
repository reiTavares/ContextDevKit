# Anatomia de Business, Operation e Workflow

Objetivo: entender a memória durável de governança em uma leitura — o que são **Business**, **Operation** e **Workflow**, como se relacionam, onde vivem e quais arquivos são autoridade.

## As três unidades duráveis

| Unidade | Id | O que é |
| --- | --- | --- |
| **Business** | `BIZ-####` | capacidade estratégica, produto, iniciativa ou decisão durável; guarda o **porquê** de longo prazo |
| **Operation** | `OP-####` | contexto durável de operação, manutenção, recuperação, incidente ou melhoria |
| **Workflow** | `WF-####` | agregado de entrega coordenada para dependências reais, waves, ordem obrigatória, multi-session ou cutover/rollback |

Nem toda mudança precisa dessas unidades. Trabalho ordinário pode ter natureza `none`.

## Business e Operation são separados

Business e Operation vivem em raízes diferentes. Operation pode contribuir para Business, mas o vínculo não é obrigatório nem implica nesting físico.

O matcher pode **sugerir** Business relacionado; nunca confirma ownership estratégico sozinho.

## Ownership é separado da forma

Business/Operation podem possuir direct/batch ou Workflows. Workflow é escolhido pela topologia, não pelo owner.

## Estrutura

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
│   ├── WF-####-slug/
│   └── done/
├── decisions/
├── sessions/
├── preferences/
└── runs/
```

Após migração v3→v4, a raiz ativa pode ser externa; consumidores usam o resolver canônico.

## Business

Arquivos típicos:

- `business.json`;
- `business-case.md`;
- `growth.md`;
- `investment-decision.md`;
- `workflows/` e `done/`.

Business não é pai obrigatório de todo trabalho.

## Operation

- `operation.json`;
- `reason.md`;
- `batch/tasks.json` como autoridade direct/batch quando aplicável;
- `batch/tasks.md` como projeção;
- `workflows/` e `done/`.

## Workflow v2

```text
WF-####-slug/
├── workflow.json
├── workflow-state.json
├── context-manifest.json
├── prd.md
├── spec.md
├── decisions.md
├── index.md                    # gerado
├── CONTINUATION-PROMPT.md
├── pipeline/
│   ├── tasks.json
│   └── tasks.md                # gerado
└── reports/
```

### Autoridades

- `workflow.json`: definição/topologia;
- `workflow-state.json`: lifecycle;
- `pipeline/tasks.json`: tasks/status/events/evidence;
- `tasks.md`/`index.md`: projeções;
- reports: evidência/contexto factual.

## `done/` é navegação, não status

Depois da conclusão JSON-first, o pacote pode ir para `done/` do owner ou para `memory/workflows/done/` quando neutro.

A posição da pasta não é autoridade. Workflow pode reabrir se QA posterior rejeitar task concluída.

## Ciclo novo de QA

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

Evidência corrente é limpa quando o ciclo reinicia; histórico permanece.

## ADRs

ADRs preservam decisões materiais em `memory/decisions/`. Referenciar ADR não força Business/Operation/Workflow.

## Regra de memória

> **Contexto durável deve existir quando esquecê-lo prejudicaria o projeto.**
