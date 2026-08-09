# Instalar ContextDevKit e escolher um nível

## Instalação

```bash
npx contextdevkit --target /caminho/do/projeto
```

Requer Node.js 18+ e funciona em projetos Git, local-only ou sem Git.

## Níveis

Níveis habilitam capacidades; não são graus de consentimento.

| Nível | Acrescenta |
| --- | --- |
| 1 | memória durável |
| 2 | dispatcher de governança e diagnóstico |
| 3 | coordenação multissessão |
| 4 | especialistas e QA |
| 5 | análise proativa |
| 6 | delivery/loops/pipelines |
| 7 | fleet, visual QA e observabilidade avançada |

Comece no menor nível que entrega as capacidades realmente úteis ao projeto. A instrução do owner continua autoritativa em todos os níveis.

## Alterar nível

```bash
node contextkit/tools/scripts/context-level.mjs show
node contextkit/tools/scripts/context-level.mjs set <1-7>
```

Mudar nível recompõe as integrações gerenciadas sem transformar nível em token de aprovação.

Veja [Níveis](../LEVELS.md) e [Governança](../explanation/governance-and-enforcement.md).
