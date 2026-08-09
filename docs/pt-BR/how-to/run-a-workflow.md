# Executar um Workflow v2

Use Workflow quando existem dependências reais, waves, ordem obrigatória, múltiplas sessões, integração coordenada ou cutover/rollback.

## Criar

```bash
node contextkit/tools/scripts/workflow.mjs new <slug>
```

Declare `--business` ou `--operation` somente quando existir owner durável. Workflow neutro é válido.

## Carregar contexto

```bash
node contextkit/tools/scripts/workflow.mjs load <ref>
```

O loader valida e lê `workflow.json`, `workflow-state.json`, `pipeline/tasks.json`, PRD, SPEC, decisions, manifest e reports.

## Verificar

```bash
node contextkit/tools/scripts/workflow.mjs validate <ref>
node contextkit/tools/scripts/workflow.mjs status <ref>
```

## Avançar

```bash
node contextkit/tools/scripts/workflow.mjs advance <ref> --ref <report>
```

Fases não devem ser usadas como cerimônia vazia; o pacote existe para trabalho cuja topologia precisa de coordenação durável.

## Concluir

A conclusão exige evidência QA explícita, tasks terminadas, estado consistente e revisão CAS atual.

```bash
node contextkit/tools/scripts/workflow.mjs complete <ref> \
  --qa-status passed \
  --qa-evidence <evidencia> \
  --ref reports/<arquivo> \
  --expected-revision <n>
```

A pasta pode depois ser movida para `done/` como projeção humana; JSON continua sendo autoridade de lifecycle.
