# Níveis de capacidade

Níveis selecionam quais capacidades do ContextDevKit são instaladas ou expostas. Eles não concedem consentimento, não relaxam gates, não escolhem modelo e não autorizam ação externa. A instrução atual do owner continua autoritativa em todos os níveis.

| Nível | Adiciona |
| --- | --- |
| 1 — Memory | project memory, decisões, changelog e spine documental |
| 2 — Governance | dispatcher por evento, classificação de mutação e diagnósticos |
| 3 — Multi-session | claims, worktrees, coordenação branch/session e views derivadas |
| 4 — Specialists | projeções de agentes, squads como expertise opcional e QA roles |
| 5 — Proactive analysis | impact simulation, arquitetura/contratos/security e quality analysis |
| 6 — Delivery | ship/swarm/retro, runner bounded, learning/outcome metrics |
| 7 — Ecosystem | fleet, playbooks, visual QA, agent packages e observabilidade avançada |

As capacidades são cumulativas. Níveis menores expõem menos ferramentas, mas usam a mesma semântica de governança: canary/continue como postura geral, LGPD shadow e somente os três quality floors centrais podem negar por padrão.

## Alterar nível

```bash
node contextkit/tools/scripts/context-level.mjs show
node contextkit/tools/scripts/context-level.mjs set <1-7>
```

Mudar nível não cria token de aprovação. Produção destrutiva, force-push, rotação de secret, cloud changes e credenciais continuam sob a fronteira real do host/plataforma.

## No-op em qualquer nível

Conversa e exploração somente leitura não escrevem nada entre L1 e L7. Requisição não classificada faz uma pergunta curta e não persiste estado. Governança começa quando existe mutação.

## Recomendações em qualquer nível

Project Map, model policy, agent routing, swarm shape, economy hints e owner preferences continuam recomendações. Se algo estiver indisponível, o agente ativo continua dentro da instrução do owner.

Nenhum nível torna specialist ou receipt obrigatório.

Veja [referência de níveis](reference/levels.md), [contrato de governança](reference/governance-contract.md) e [guia de instalação](how-to/install-and-choose-a-level.md).
