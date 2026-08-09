# Atualizar uma instalação

Atualizações devem preservar memória authored, personalização do owner e autoridades v4 enquanto regeneram apenas superfícies gerenciadas.

## Atualização normal

Use o mecanismo de update/installer da versão instalada. Antes de aplicar, confira mudanças de versão e release notes.

## O que deve ser preservado

- `memory/preferences/personalization.md`;
- `owner-preferences.json`;
- Business/Operations/Workflows authored;
- ADRs, reports e sessões;
- estado canônico JSON.

## O que pode ser regenerado

- host projections;
- índices;
- Project Map;
- Markdown derivado;
- caches e staging descartáveis.

## Upgrade 3.x → 4.x

Não existe live compatibility fallback. Use exclusivamente o migrador offline `contextkit/tools/migrations/v3-to-v4/` com inventory, stage, parity, rollback drill, writer fence, cutover e retire-v3.

Nunca copie configuração 3.x inteira para a 4.x.

## Depois do update

Rode doctor/selfcheck, verifique host projection parity e confirme que os mesmos `tasks.json`/workflow states são vistos pelos consumidores.
