# Tutorial: sua primeira feature entregue com evidência

Este tutorial mostra o caminho de uma mutação real até `done` sem transformar uma feature simples em excesso de cerimônia.

## 1. Defina o outcome

Descreva o comportamento que deve existir e como será verificado.

## 2. Deixe o intake escolher a forma mínima

Uma feature focada pode ser `none + direct`. Use Batch ou Workflow somente quando houver topologia que justifique.

## 3. Implemente com contexto

Leia SPEC/PRD/ADRs quando existirem para o trabalho ativo. Para um Workflow, carregue o pacote antes da primeira escrita.

## 4. Escreva a regressão adequada

Teste o comportamento que falharia sem a mudança. Não adicione um segundo framework de testes ao projeto.

## 5. Faça review proporcional

Differences materiais devem receber uma passagem de revisão. Use `code-reviewer` quando a delegação for útil; se não estiver disponível, o agente ativo mantém a responsabilidade.

## 6. Rode QA e evidência aplicável

Use testes focados e depois a suíte necessária. Os três quality floors guarded padrão são QA na conclusão, DDD Classe A aplicável e Technical Debt novo high/critical do diff.

## 7. Corrija e reavalie

```text
implementar → avaliar → finding → corrigir → evidência nova → reavaliar
```

Não reutilize um PASS antigo depois de alterar o código.

## 8. Conclua

`done` deve representar o outcome solicitado com evidência atual. Preserve reports/decisões que tenham valor para futuras sessões.

Veja [Loop Engineering](../explanation/loop-engineering.md) e [Auditar e testar uma mudança](../how-to/audit-and-test.md).
