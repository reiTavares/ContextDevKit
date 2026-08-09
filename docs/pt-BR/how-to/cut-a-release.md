# Cortar uma release

Uma release deve sair de evidência reprodutível, não apenas de um número de versão alterado.

## Antes da release

```bash
npm run test:smoke
npm run test:selfcheck
npm run test:integration
npm test
npm run release:v4:gate
```

O gate de release verifica, entre outros pontos, package allowlist, projeções de host, legado executável alcançável e fronteira de migração.

## Regras

- não publique com CI vermelho;
- não gere tag/version bump antes dos gates exigidos;
- mantenha `[Unreleased]` e release notes coerentes;
- não inclua fixtures/selftests/dogfood memory no pacote de usuário;
- confirme que generated projections estão sem drift.

A release boundary é mais rígida que a governança cotidiana porque protege todos os usuários do pacote, não apenas uma task local.
