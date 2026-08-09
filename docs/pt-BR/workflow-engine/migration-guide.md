# Migração de Workflow 3.x para 4.x

O runtime 4.x não lê `workflow-plan.json`, lanes Markdown ou status inferido de diretório.

## Boundary

A compatibilidade existe apenas no migrador offline `contextkit/tools/migrations/v3-to-v4/`.

## Sequência segura

1. inventory/dry-run;
2. stage de uma geração v4 completa;
3. validação de schema/paridade;
4. rollback drill;
5. freeze dos writers v3;
6. cutover CAS da authority;
7. validação dos consumidores;
8. retire-v3 para bundle externo de auditoria.

Rollback nunca reativa readers/writers v3.

## Regra

Não mantenha dual-read/dual-write como compatibilidade permanente. Depois do cutover, o runtime normal deve ter uma única autoridade v4.

Para comandos exatos, consulte `MIGRATION-3.x-TO-4.0.md` na raiz do repositório.
