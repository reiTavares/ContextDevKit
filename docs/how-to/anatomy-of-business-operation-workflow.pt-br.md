# Anatomia de um Business, Operation e Workflow

Objetivo: entender a memória de governança do ContextDevKit numa leitura só — o
que é um **Business**, uma **Operation** e um **Workflow**, como se relacionam,
onde vivem no disco e quais arquivos cada um carrega. Use ao abrir o
`contextkit/memory/` de um projeto e precisar se orientar rápido.

> English: see [anatomy-of-business-operation-workflow.md](anatomy-of-business-operation-workflow.md).

## As três unidades

| Unidade | Id | O que é |
| --- | --- | --- |
| **Business** | `BIZ-####` | Uma capacidade estratégica ou valor durável que o projeto protege. Longevo; é o dono do *porquê* o trabalho acontece. **`BIZ-0001` é o Root Business** que governa o intake em todo projeto. |
| **Operation** | `OP-####` | Um lote de trabalho relacionado sob um Business (ou sem vínculo, para manutenção pura). É dona do *o quê* está sendo feito e agrupa seus workflows. |
| **Workflow** | `WF-####` | Uma unidade de entrega spec-pack — uma única feature/mudança conduzida do intake à conclusão. É dona do *como* um incremento é entregue. |

Elas se aninham por posse: um **Business** possui **Operations**, e uma
**Operation** (ou um Business diretamente) possui **Workflows**. A pasta de um
workflow possuído **fica sob seu pai** — nunca num pool central.

## Onde vivem no disco

Toda a memória de governança fica sob `contextkit/memory/`:

```text
contextkit/memory/
├── business/
│   └── BIZ-0001-business-driven-development/
│       ├── business.json          # registro de máquina (id, status, vínculos)
│       ├── business-case.md        # o valor/porquê
│       ├── growth.md · investment-decision.md
│       ├── architecture/           # notas de design no nível de negócio
│       ├── workflows/              # workflows possuídos direto pelo Business
│       └── done/                   # workflows concluídos, arquivados
├── operations/
│   └── OP-0008-.../
│       ├── operation.json          # registro de máquina
│       ├── reason.md               # por que a Operation existe + achados + escopo
│       ├── tasks.md
│       └── workflows/              # ← workflows possuídos ANINHAM aqui
│           └── WF-0070-memory-accessibility-and-governance-digest/
│               ├── index.md
│               ├── prd.md          # requisitos de produto
│               ├── spec.md         # spec técnica
│               ├── decisions.md    # log de decisões de design
│               ├── memory.md       # handoffs/aprendizados duráveis
│               ├── tasks.md
│               └── reports/        # evidência por tarefa
├── decisions/                      # ADRs — o "porquê" das escolhas arquiteturais
│   ├── ADR-0000-...md              # ADR-####-<slug>.md (formato canônico)
│   ├── business/ · operations/ · legacy/
│   └── _templates/
├── sessions/                       # um arquivo por sessão de trabalho ("o que aconteceu")
├── deliberations/                  # artefatos de /debate que alimentam ADRs
├── GLOSSARY.md                     # nomenclatura UI ↔ código
├── SESSIONS.md · WORKSPACE.md · DELIBERATIONS.md   # índices regenerados
```

**Exemplo real (este repo):** `OP-0008` agrupa o trabalho de acessibilidade de
linguagem; seu workflow `WF-0070` fica em
`operations/OP-0008-language-aware-intent-classification-and-memory-accessibility/workflows/WF-0070-memory-accessibility-and-governance-digest/`,
governado por `decisions/operations/ADR-0132-*.md`.

## Arquivos que cada unidade deve ter

- **Business** — `business.json` (registro) + `business-case.md` (o valor).
  `growth.md` / `investment-decision.md` são os documentos de apoio padrão.
- **Operation** — `operation.json` + `reason.md` (por que existe, achados, escopo)
  + `tasks.md`. Um diretório `workflows/` guarda seus workflows possuídos.
- **Workflow (spec-pack)** — `index.md`, `prd.md`, `spec.md`, `decisions.md`,
  `memory.md`, `tasks.md`, e um diretório `reports/` para evidência. (Alguns packs
  usam `reason.md` junto/no lugar de `decisions.md`.)
- **ADR** — `decisions/ADR-####-<slug>.md`. ADRs de business/operation ficam nas
  subpastas `business/` e `operations/`; os históricos em `legacy/`.

## Convenções de nomenclatura

- Businesses: `BIZ-####`; Operations: `OP-####`; Workflows: `WF-####`.
- Diretórios de workflows possuídos carregam o **prefixo `WF-`** (`WF-0070-<slug>`)
  e aninham sob o `workflows/` do pai.
- Arquivos de ADR: `ADR-####-<slug>.md`.
- Números são alocados de **uma sequência global única** entre BIZ/OP/WF/ADR —
  nunca reutilizados ou por-diretório.

## O fluxo de fases de um workflow

Um workflow avança por fases, cada uma barrada por seu entregável:

```text
intake → prd → spec → adr → roadmap → pipeline → ship → testing → conclusion
```

Veja o status a qualquer momento com `/workflow status <slug>` (ou
`node contextkit/tools/scripts/workflow.mjs status <slug>`), e avance com
`/workflow advance <slug>`.

## A memória é versionada no seu clone

Uma **instalação não-dogfood versiona sua memória de governança** por padrão — o
registro durável (business/operations/workflows/sessions/decisões) é commitado
para que o clone de um colega carregue a memória do projeto, enquanto o estado
descartável de runtime (pipeline state, caches, índices regenerados) permanece
ignorado. Você pode regenerar uma projeção consultável de tudo isso com:

```bash
node contextkit/tools/scripts/governance-digest.mjs --write
```
