# Referência da CLI de Workflow

Entrypoint:

```bash
node contextkit/tools/scripts/workflow.mjs <comando>
```

## Comandos principais

```text
new <slug>
status [ref] [--json]
load <ref>
render <ref>
refresh <ref>
validate <ref>
check <ref>
advance <ref> [--ref <report>]
complete <ref> --qa-status passed|skipped --qa-evidence <refs> --ref reports/<file> --expected-revision <n>
done-move <ref> [--apply]
repair-scaffold <ref> [--write]
explain-file <id>
required-files
```

## Ownership na criação

Use no máximo um owner explícito:

```text
--operation OP-####
--business BIZ-####
```

Ausência de owner cria Workflow neutro quando isso é apropriado.

## Segurança de estado

`complete` usa revisão esperada/CAS e recusa state stale, tasks incompletas, QA evidence inválida ou reportRef fora de `reports/`.

Comandos v3 como `conclude`, `migrate-plan` e superfícies de plan hash são recusados no runtime v2.
