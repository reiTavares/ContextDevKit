# Workflow Engine v2

Workflows 4.x são pacotes atômicos baseados em JSON para trabalho que realmente precisa de coordenação durável.

## Autoridades

- `workflow.json`: definição, owner e topologia;
- `workflow-state.json`: lifecycle e fase atual;
- `pipeline/tasks.json`: tasks, status, eventos e evidence refs;
- `tasks.md`/`index.md`: projeções geradas;
- `reports/`: evidência factual e contexto.

## Quando usar

Workflow é indicado por dependências, waves, múltiplas sessões, ordem obrigatória, integração coordenada ou cutover/rollback.

Business, Operation, arquitetura ou ADR não forçam Workflow por palavra-chave.

## Criação

O pacote nasce em staging sibling, todos os arquivos obrigatórios são escritos/validados e só então ocorre rename atômico para o destino.

## Execução

O loader lê o pacote completo antes da mutação. Tasks usam CAS/lock/atomic replace. Completion exige state consistente e QA evidence explícita.

## Compatibilidade

Workflow v1 não é lido pelo runtime normal. Migração é responsabilidade do boundary offline 3.x→4.x.
