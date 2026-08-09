# Registrar uma decisão

Crie uma ADR quando uma escolha material precisa sobreviver à sessão e orientar
trabalho futuro. Deliberação pode ajudar, mas não autoriza a decisão e nunca é
pré-requisito.

## 1. Procure uma decisão existente

```shell
node contextkit/tools/scripts/decision.mjs search --objective "tema da decisão" --json
```

Se uma ADR aceita já governa a escolha, use-a ou substitua-a formalmente.

## 2. Gere a ADR canônica

Obtenha o próximo id seguro para todos os worktrees com
`intake-collision-gate.mjs --json`. Depois visualize e aplique:

```shell
node contextkit/tools/scripts/decision.mjs create --id ADR-0001 --kind ARCHITECTURE --title "Título" --context-type operation --primary-context OP-0001 --json
node contextkit/tools/scripts/decision.mjs create --id ADR-0001 --kind ARCHITECTURE --title "Título" --context-type operation --primary-context OP-0001 --apply --json
```

Não copie `memory/decisions/_TEMPLATE.md` e não escreva o front matter à mão. O
gerador controla `schemaVersion: 2`, `documentVersion: 1` e as seções obrigatórias.

## 3. Valide e aceite explicitamente

```shell
node contextkit/tools/scripts/decision.mjs validate --file <caminho da ADR> --json
node contextkit/tools/scripts/decision.mjs accept --id ADR-0001 --actor human --apply --json
```

O aceite humano grava o hash SHA-256 determinístico. Uma ADR aceita é imutável;
para alterá-la, gere outra ADR e registre a substituição nos dois sentidos.

## 4. Vincule a execução

Use `decision.mjs link` para vincular a ADR ao Business, Operation ou Workflow
governado. Tarefas continuam somente no `pipeline/tasks.json` do escopo. Criar
uma ADR não cria tarefas, não dispara agentes e não exige swarm automaticamente.
