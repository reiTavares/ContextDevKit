# Configurar níveis de capacidade

ContextDevKit 4 removeu o conceito de autonomy grade como autorização. O `level` controla quais capacidades são instaladas/expostas.

## Ver nível

```bash
node contextkit/tools/scripts/context-level.mjs show
```

## Alterar

```bash
node contextkit/tools/scripts/context-level.mjs set <1-7>
```

## O que o nível não faz

- não autoriza push/deploy;
- não altera `owner-wins`;
- não transforma agente/modelo em permissão;
- não reduz os predicates guarded configurados;
- não impede fallback quando graph/routing falham.

Escolha nível por utilidade operacional, não por medo de autonomia.
