# Referência de níveis

`contextkit/config.json` contém um `level` inteiro de 1 a 7. O nível seleciona capacidades disponíveis; ele não é uma nota de autonomia, consentimento ou permissão.

| Nível | Nome | Capacidades principais |
| --- | --- | --- |
| 1 | Memory | memória durável, decisões, changelog e base documental |
| 2 | Governance | dispatchers de governança, classificação mutation-only e diagnósticos |
| 3 | Multi-session | claims, worktrees e coordenação entre sessões/branches |
| 4 | Specialists | agentes especialistas, squads opcionais e papéis de QA |
| 5 | Proactive analysis | impacto, arquitetura, contratos, security e quality analysis |
| 6 | Delivery | `/ship`, swarm, retro, runner bounded e learning/outcome metrics |
| 7 | Ecosystem | fleet, playbooks, visual QA, agent packages e observabilidade avançada |

## Semântica

Capacidades são cumulativas. Alterar o nível não:

- autoriza ações externas;
- muda `humanAuthority: owner-wins`;
- converte routing/model/specialist em permissão;
- transforma LGPD shadow em gate;
- cria novos domínios guarded;
- dispensa confirmações reais do host/plataforma.

Os três quality floors guarded padrão permanecem QA sign-off, DDD Class A aplicável e Technical Debt novo high/critical introduzido pelo diff atual.

## Comandos

```bash
node contextkit/tools/scripts/context-level.mjs show
node contextkit/tools/scripts/context-level.mjs set <1-7>
```

Veja também [Níveis de capacidade](../LEVELS.md), [Contrato de governança](governance-contract.md) e [Instalação e escolha de nível](../how-to/install-and-choose-a-level.md).
