# Auditar e testar uma mudança

Use auditorias para coletar evidência e transformar findings em trabalho somente quando isso fizer sentido para o owner.

## 1. Rode a análise mais estreita necessária

```bash
node contextkit/tools/scripts/doctor.mjs
node contextkit/tools/scripts/tech-debt-scan.mjs
node contextkit/tools/scripts/security-audit.mjs
```

Ferramenta opcional ausente é `skipped`, nunca PASS.

## 2. Findings não criam tasks automaticamente

Se o owner decidir reter um finding, adicione-o a um scope explícito de Workflow/Batch. Não existe backlog global gravável.

## 3. Teste primeiro o contrato alterado

Comece pela regressão focada e depois execute a suíte/global gate relevante:

```bash
node contextkit/tools/scripts/economy/run-compact.mjs npm test --kind test --capture-full
```

Registre comando, exit code, duração e limitações.

## 4. Faça QA final quando aplicável

QA na conclusão é um quality floor guarded por padrão. Missing agent, graph, routing ou report opcional não substitui evidência de teste.

## 5. Se falhar, crie um novo ciclo

Finding atribuível deve voltar para correção e reavaliação com evidência nova. Não reutilize receipt antigo depois da mudança.

Veja [Loop Engineering](../explanation/loop-engineering.md) e [Governança](../explanation/governance-and-enforcement.md).
