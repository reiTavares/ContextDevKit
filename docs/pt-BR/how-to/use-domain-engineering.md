# Usar Domain Engineering

Domain Engineering é uma lente proporcional, não um pré-requisito universal de escrita.

Use quando a mudança toca invariantes reais, bounded contexts, contratos, agregados, autoridade de estado ou linguagem de domínio relevante.

## Quando usar

- regras de negócio críticas;
- mudança de contratos públicos;
- transações que protegem invariantes;
- estado compartilhado entre contextos;
- refatorações que alteram fronteiras de domínio.

## Quando não usar

CRUD simples, docs, typo ou mudança localizada sem regra de negócio não precisam de modelagem pesada.

## Especialista

`domain-modeler` pode propor contextos, linguagem, agregados e invariantes, mas sua presença não é autorização para escrever nem condição de conclusão.

## DDD guarded

Somente invariantes Classe A explicitamente declarados, aplicáveis, determinísticos e evidenciados podem participar do quality floor guarded.

Um mapa auto-seeded ou opinião do modelo não basta para bloquear.
