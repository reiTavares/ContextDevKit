# Business-Driven Development

O ContextDevKit trata engenharia de software como trabalho realizado em serviço de outcomes duráveis — sem obrigar toda alteração de código a entrar numa hierarquia de negócio.

Business-Driven Development responde três perguntas separadamente:

1. **Esta interação representa trabalho real no projeto?**
2. **Se representa, quem ou qual contexto durável possui a razão desse trabalho?**
3. **Qual forma de execução é realmente necessária para entregar?**

Separar essas perguntas evita tanto falta de governança quanto inflação de processo.

## Interação vem antes da metodologia

Nenhum Business, Operation, task ou Workflow deve existir apenas porque uma conversa aconteceu.

Primeiro a interação é classificada como:

```text
conversation
exploration
mutation
unclassified
```

Conversa e exploração somente leitura param antes da classificação durável. Apenas uma mutação confirmada prossegue.

Quando a intenção de mudança não pode ser estabelecida, o ContextDevKit faz uma pergunta curta em vez de adivinhar.

Uma tentativa real de escrita é autoritativa e promove a interação para `mutation` naquela revisão.

## Trabalho existente vem antes de trabalho novo

Uma mutação confirmada não deve automaticamente virar nova task ou Workflow.

O resolver pode indicar:

```text
explicit     item existente identificado diretamente
inferred     item existente provável
ambiguous    vários itens plausíveis
new          evidência sustenta criar trabalho novo
none         nenhum contexto durável foi estabelecido
```

Itens inferidos/ambíguos não são selecionados silenciosamente. Itens concluídos não são reabertos silenciosamente.

## Natureza: Business, Operation ou none

### Business

Business é uma capacidade estratégica, produto, iniciativa ou decisão durável.

Existe quando vale a pena preservar contexto de longo prazo sobre outcome, valor, ownership, KPI, investimento, horizonte, trabalho relacionado e decisões governantes.

Business guarda um **porquê durável**.

### Operation

Operation é contexto operacional durável dentro de uma capacidade existente.

Exemplos: recuperação de incidente, reliability, programa de manutenção, modernização de dependências ou grupo de refactors relacionados com razão operacional.

Operation guarda uma **razão operacional durável**.

### none

`none` é classificação normal e desejável.

Features focadas, bugs localizados, docs, refactors pequenos e mudanças técnicas sem necessidade de memória Business/Operation devem permanecer `none`.

O ContextDevKit não cria Operation apenas para dar uma pasta ao trabalho.

## Business e Operation permanecem separados

Uma Operation pode contribuir para um outcome de Business, mas os conceitos não se fundem numa hierarquia obrigatória.

O matcher pode usar evidência como id explícito, status do Business, kind, value intent, afinidade e overlap textual para **sugerir** um vínculo.

Match fraco permanece sem vínculo. Mesmo um match forte não é marcado como `confirmed` pelo classificador. Confirmação pertence à governança humana/do projeto.

## Forma de execução é outro eixo

Natureza responde:

> Por que este trabalho precisa de contexto durável, se precisar?

Forma responde:

> Quanta coordenação a entrega exige?

```text
Business ────────┐
Operation ───────┼──→ direct
none ────────────┤   batch
                 └── workflow
```

### direct

Pequeno conjunto coeso, normalmente 1–3 tasks.

### batch

Várias tasks relacionadas, normalmente 4–12, sem ordem forte.

### workflow

Use quando houver topologia real:

- múltiplas waves;
- grupos dependentes;
- ordem obrigatória;
- múltiplas sessões;
- integração coordenada;
- cutover/rollback;
- Workflow explicitamente solicitado.

Palavras como `architecture`, `Business`, `ADR`, `LGPD` ou `migration` não são suficientes, sozinhas, para forçar Workflow.

## Intake Envelope

O **Intake Envelope** transitório reúne evidência que o agente precisa para interpretar uma mutação:

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

Ele não é outro artefato persistido. É uma visão normalizada sobre sinais que já existem no runtime.

Diferentes hosts/modelos podem começar dos mesmos fatos em vez de adivinhar independentemente.

## Por que isso melhora desenvolvimento com IA

Sem essa separação, o agente tende a um dos extremos:

```text
pedido → editar → declarar done
```

ou:

```text
pedido → Operation → Workflow → documentos → agentes → cerimônia → talvez editar
```

BDD busca:

```text
pedido
  ↓
é mutação?
  ↓
contexto durável importa?
  ↓
qual a menor forma de execução útil?
  ↓
carregar inteligência relevante
  ↓
executar
  ↓
preservar somente memória que vale preservar
```

## Relação com Domain-Driven Design

Business-Driven Development e DDD resolvem problemas diferentes.

BDD pergunta:

> Qual outcome/contexto operacional durável possui este trabalho?

DDD pergunta:

> Qual modelo, linguagem, limites e invariantes representam corretamente o domínio?

Um projeto pode precisar de um sem precisar do outro.

Business não implica DDD completo. Profundidade de DDD deve ser proporcional à complexidade real do domínio.

Quando um invariante Classe A declarado é aplicável, sua proteção determinística pode participar do quality floor guarded. O `domain-modeler` continua sendo especialista, não pré-requisito de escrita.

## Regra central

> **Contexto durável deve existir quando esquecê-lo prejudicaria o projeto.**

O restante deve permanecer tão pequeno quanto o trabalho permite.
