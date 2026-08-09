# Modelo de domínio do trabalho e da governança

O ContextDevKit 4 mantém autoridades pequenas e explícitas.

A regra central é que **valores de classificação, ownership durável, estado de execução e projeções humanas são coisas diferentes**. Misturá-los recria a ambiguidade que o ContextDevKit deve remover.

## Interação e Intake Envelope

Intenção é estado transitório do dispatcher:

```text
conversation | exploration | mutation | unclassified
```

Somente `mutation` segue para classificação durável.

Depois disso, o runtime pode compor um **Intake Envelope** transitório:

```text
interaction
existingWork
nature
executionMode
tier
domain
valueIntent
decisionNeed
decisionMatch
businessMatch
reasons
evidence
```

O envelope é value/view, não novo agregado persistido.

## Agregados e autoridades

| Agregado/valor | Autoridade |
| --- | --- |
| intenção da interação | contexto transitório do dispatcher |
| Intake Envelope | composição transitória de sinais |
| Business | `memory/business/BIZ-*` |
| Operation | `memory/operations/OP-*` |
| definição do Workflow | `workflow.json` |
| estado do Workflow | `workflow-state.json` |
| tasks/status | `pipeline/tasks.json` |
| visão humana de tasks | `pipeline/tasks.md` derivado |
| run state | `memory/runs/<run-id>/state.json` |
| preferências recomendatórias | `memory/preferences/owner-preferences.json` |
| claims de workspace | `.claude/.workspace/` |

## Business, Operation e none

Natureza é ownership, não etapa de pipeline.

- **Business**: valor estratégico/capacidade/decisão durável;
- **Operation**: contexto operacional/manutenção/recuperação/melhoria durável;
- **none**: nenhum ownership durável é justificado;
- **unclassified**: evidência concorrente precisa de esclarecimento.

`none` é deliberadamente normal. O sistema não inventa Operation apenas para guardar trabalho ordinário.

Um Business sugerido para Operation não é ownership confirmado. Matching propõe; governança do projeto confirma.

## Forma de execução é separada

```text
direct | batch | workflow
```

Business, Operation ou none podem coexistir com qualquer forma, desde que a topologia do trabalho justifique.

## Agregado Task

Protege:

- transições legais de status;
- dependências;
- acceptance criteria;
- evidence refs;
- report refs;
- revisão CAS;
- pairing atômico de status/event.

Eventos são audit detail dentro do documento canônico, não segunda autoridade de status.

`qa-reject` de `testing`/`done` inicia ciclo novo; evidência corrente é limpa quando necessário e histórico permanece.

## Agregado Workflow

Lifecycle é derivado somente de `workflow-state.json`.

Pacotes ativos vivem em `workflows/`; após conclusão JSON-first, podem ser colocados em `done/` para navegação humana. A pasta não vira autoridade.

Workflow concluído pode reabrir quando feedback posterior rejeita task que ele possui.

Reports, Markdown e posição de diretório não duplicam estado.

## Reports e contexto autorado

PRD, SPEC, decisions e ADRs carregam intenção/racional. Reports carregam evidência factual, findings e blockers. Eles são contexto obrigatório quando o contrato do Workflow determina, mas não competem com autoridades JSON.

## Preferências e personalização

`owner-preferences.json` guarda preferências estruturadas recomendatórias.

`personalization.md` guarda guidance explícito do projeto.

Nenhum é token de autorização. A instrução atual do owner permanece fronteira de decisão do projeto, sujeita a limites reais de system/platform.

## Compatibilidade

Compatibilidade 3.x existe apenas no migrador offline explícito. Runtime normal não infere status de lanes legadas, planos v1 ou sidecars aposentados.

## Invariante central

> **Cada tipo de estado possui uma autoridade gravável; o restante é contexto, evidência, recomendação ou projeção.**
