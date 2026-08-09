# Usar o task board canônico

ContextDevKit 4 não possui backlog global gravável. Cada Workflow ou Batch possui seu próprio `tasks.json`.

## Listar

```bash
node contextkit/tools/scripts/pipeline.mjs list --tasks <scope>
node contextkit/tools/scripts/pipeline.mjs board --tasks <scope>
```

## Adicionar

```bash
node contextkit/tools/scripts/pipeline.mjs add --tasks <scope> \
  --title "<título>" --priority P1
```

## Mover

```bash
node contextkit/tools/scripts/pipeline.mjs move <id> <status> --tasks <scope>
```

Status canônicos:

```text
backlog | working | blocked | testing | done | cancelled
```

## QA

```bash
node contextkit/tools/scripts/pipeline.mjs qa-reject <id> "feedback" --tasks <scope>
node contextkit/tools/scripts/pipeline.mjs qa-approve <id> --evidence <ref> --tasks <scope>
```

`qa-reject` inicia um ciclo fresco e limpa evidência corrente que não pode provar a implementação corrigida.

## Autoridade

`pipeline/tasks.json` é autoridade. `pipeline/tasks.md` é projeção reparável.

Use `validate` e `sync` para validar o JSON e reparar a projeção.
