# Executar um caso Business ou Operation governado

Use este guia quando uma mutação confirmada realmente precisa de memória durável Business ou Operation. A maioria das mudanças de código não precisa.

Veja também [Business-Driven Development](../explanation/business-driven-development.md) e [Loop Engineering](../explanation/loop-engineering.md).

## 1. Deixe a classificação da interação acontecer primeiro

Não crie Business, Operation, task ou Workflow para conversa ou exploração somente leitura.

Inspecione o intake sem criar trabalho:

```shell
node contextkit/tools/scripts/work.mjs intake "<objetivo>" --json
```

O receipt pode mostrar natureza, forma de execução, tier, decision need/match, Business sugerido e eventual pergunta de esclarecimento.

`work intake` é read-only por design.

## 2. Trate `none` como resposta válida

Não crie Operation apenas porque o pedido muda código.

Use `none` para feature focada, bug localizado, docs ou mudança técnica que não precisa de ownership estratégico/operacional durável.

Business/Operation só devem existir quando esquecer aquele contexto prejudicaria o projeto.

## 3. Crie Business quando o porquê durável importa

Business serve para capacidade estratégica, produto, iniciativa ou decisão cujo outcome deve sobreviver a vários trabalhos futuros.

Exemplos: novo produto/mercado, capacidade estratégica de plataforma, programa multi-mês, capacidade durável de compliance.

Consulte a CLI atual:

```shell
node contextkit/tools/scripts/work.mjs business --help
```

Preview/apply pertence ao contrato de cada comando; não assuma um switch universal baseado em documentação antiga.

## 4. Crie Operation quando a razão operacional durável importa

Use para incident/recovery, manutenção, modernização de dependências, reliability ou grupo durável de correções/refactors.

```shell
node contextkit/tools/scripts/work.mjs operation --help
```

Operation não é fallback geral para alteração técnica.

## 5. Vincule Operation a Business somente com evidência

O matcher pode sugerir um Business usando scoring determinístico e recusa matches fracos.

Sugestão não é confirmação.

Confirme por comando suportado, não editando JSON manualmente:

```shell
node contextkit/tools/scripts/work.mjs link --help
```

## 6. Escolha a forma de execução separadamente

### direct

Pequeno conjunto coeso, normalmente 1–3 tasks.

### batch

Várias tasks relacionadas, normalmente 4–12, sem ordem forte.

### workflow

Use quando houver waves, dependências, ordem obrigatória, múltiplas sessões, integração coordenada, cutover/rollback ou pedido explícito de Workflow.

Business não implica Workflow. Operation não implica Workflow.

## 7. Resolva trabalho existente antes de criar outro

O sinal `existingWork` distingue:

```text
explicit | inferred | ambiguous | new | none
```

Não selecione item ambíguo silenciosamente e não reabra item concluído sem ordem explícita.

## 8. Crie Workflow somente quando necessário

```shell
node contextkit/tools/scripts/workflow.mjs new <slug> --operation OP-####
node contextkit/tools/scripts/workflow.mjs new <slug> --business BIZ-####
```

Use um owner quando o Workflow for possuído. Workflows neutros também são válidos quando nenhum Business/Operation é justificado.

O creator escreve o pacote v2 completo de forma atômica.

## 9. Execute a partir do pacote canônico

Antes de mutar, carregue o contexto:

```shell
node contextkit/tools/scripts/workflow.mjs load <ref>
```

O pacote carrega PRD, SPEC, decisions, task state, context manifest e reports.

`pipeline/tasks.json` é autoridade de tasks; `tasks.md` é projeção.

## 10. Deixe evidência dirigir a conclusão

```text
implementar
  ↓
avaliar
  ↓
findings
  ↓
corrigir
  ↓
nova avaliação
  ↓
done
```

QA rejection pode voltar `testing/done → backlog`. Evidência corrente é resetada quando necessário. Workflow concluído pode reabrir quando feedback posterior invalida task concluída.

## 11. Quality floors e autoridade do owner

Guarded por padrão:

- QA sign-off;
- DDD Classe A aplicável/determinístico;
- Technical Debt nova high/critical do diff atual.

Architecture Debt é canary; Privacy/LGPD é shadow por padrão.

O owner pode configurar modos e usar override com escopo sem transformar evidência em PASS.

## Verificação

```shell
node contextkit/tools/scripts/work.mjs intake "<objetivo>" --json
node contextkit/tools/scripts/workflow.mjs status <ref> --json
node contextkit/tools/scripts/workflow.mjs validate <ref>
node contextkit/tools/scripts/pipeline.mjs validate --tasks <scope>
```

Se comando/registry opcional estiver indisponível, reporte honestamente. Não invente ownership, estado ou próximo passo a partir de documentação stale.
