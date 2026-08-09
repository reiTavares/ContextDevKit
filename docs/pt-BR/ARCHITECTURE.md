# Arquitetura

O ContextDevKit é um **AI Software Engineering Governance Harness** host-neutral, distribuído como source. O hot path do runtime usa ESM puro em Node.js 18+ e não possui dependências de pacote em runtime.

O harness não é dono do loop de execução da LLM. Claude Code, OpenAI Codex, Google Antigravity, Grok ou outro host compatível continuam responsáveis pela execução do modelo, chamadas de ferramentas, shell/filesystem, transporte MCP e limites de segurança da própria plataforma.

O ContextDevKit fornece a camada de engenharia durável ao redor desses hosts: classificação de intenção, inteligência do projeto, memória de longa duração, ownership Business/Operation, estado governado do trabalho, evidência de engenharia, avaliação proporcional de políticas e continuidade entre sessões.

Essa fronteira é intencional: hosts de execução são substituíveis; a inteligência governada do projeto permanece portátil.

## Camadas arquiteturais

```text
host / modelo / tools
        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│ Adapters de host                                             │
│ Claude · Codex · Antigravity · Grok                         │
├──────────────────────────────────────────────────────────────┤
│ Interação & Intake                                           │
│ conversation · exploration · mutation · unclassified         │
│ resolução de trabalho existente · Intake Envelope            │
├──────────────────────────────────────────────────────────────┤
│ Business-Driven Development                                  │
│ Business · Operation · none                                  │
│ direct · batch · workflow                                    │
├──────────────────────────────────────────────────────────────┤
│ Inteligência e memória de longa duração                      │
│ graph · Project Map · ADRs · specs · reports · preferences   │
├──────────────────────────────────────────────────────────────┤
│ Lifecycle do trabalho                                        │
│ tasks · workflows · CAS · reports · continuation             │
├──────────────────────────────────────────────────────────────┤
│ Loops de engenharia orientados a evidência                   │
│ implementar · avaliar · corrigir · evidência nova · done     │
├──────────────────────────────────────────────────────────────┤
│ Governança                                                   │
│ quality floors guarded · guidance canary · análise shadow    │
└──────────────────────────────────────────────────────────────┘
```

## Sources canônicos e projeções

```text
templates/claude/commands/       sources canônicos de comandos
templates/claude/agents/         sources canônicos de agentes
templates/contextkit/runtime/    runtime compartilhado
templates/contextkit/tools/      CLI instalada e ferramentas de migração
templates/contextkit/memory/     memória inicial neutra
templates/antigravity/           projeções geradas
templates/codex/                 projeções geradas
tools/                           testes e tooling apenas do repositório
```

As projeções de host são declaradas em `host-projections.json`. A regeneração cria apenas arquivos declarados, remove órfãos gerenciados e falha quando um source obrigatório está ausente. Uma cópia dogfood instalada nunca é uma segunda autoridade.

## Fluxo mutation-only

`runtime/execution/interaction-classify.mjs` classifica a interação de forma barata e sem efeitos colaterais antes de qualquer metodologia durável:

```text
host event
  -> classificar interação
     -> conversation: nenhum trabalho governado
     -> exploration: somente leitura
     -> unclassified: uma pergunta curta
     -> mutation
          -> resolver trabalho existente
          -> montar sinais de intake
          -> escolher natureza + forma de execução
          -> execução governada
```

Uma tentativa real de escrita promove monotonicamente a interação para `mutation`. Conversa e exploração não carregam rubrics de trabalho, não alocam ids e não criam contexto durável.

## Intake Envelope

O **Intake Envelope** é a visão transitória normalizada dos sinais produzidos depois que a mutação foi confirmada. É um conceito documental, não uma nova autoridade persistida.

Pode conter:

- intenção e reason codes;
- resolução de trabalho existente (`explicit | inferred | ambiguous | new | none`);
- complexidade/tier e contexto de domínio;
- natureza (`business | operation | none | unclassified`);
- forma (`direct | batch | workflow`);
- value intent e kind;
- decision need/match;
- relação Business sugerida para Operation;
- reasons e evidence.

Assim diferentes hosts podem raciocinar sobre os mesmos fatos sem criar outro receipt obrigatório.

## Business-Driven Development

Natureza e forma de execução são eixos independentes.

- `business`: capacidade, produto, iniciativa ou decisão estratégica durável;
- `operation`: manutenção, incidente, recuperação ou melhoria operacional durável;
- `none`: resultado neutro comum para trabalho ordinário;
- `unclassified`: evidência concorrente exige esclarecimento.

O classificador nunca inventa Operation apenas para guardar uma alteração técnica.

Para Operations, `business-matcher.mjs` pode sugerir relação com Business por scoring determinístico. Matches fracos permanecem sem vínculo e `confirmed` nunca é preenchido pelo matcher.

A forma de execução é classificada separadamente:

- `direct`: trabalho pequeno e coeso;
- `batch`: várias tasks relacionadas e independentes;
- `workflow`: waves reais, grupos dependentes, ordem obrigatória, múltiplas sessões, integração coordenada, cutover/rollback ou pedido explícito.

Vocabulário de Business, arquitetura, ADR ou compliance não força Workflow sozinho.

## Runtime de eventos de governança

Os momentos governados são:

1. `prompt-preflight`
2. `write-preflight`
3. `postflight`
4. `completion`

O runtime centraliza proteção contra reentrada, deduplicação, timeouts, budget total e circuit breaker. Falhas internas seguem `failurePolicy: continue`: são diagnosticadas, nunca convertidas em PASS fabricado e nunca acionam um resolver legado alternativo.

## Política de governança

`runtime/governance/gate-registry.mjs` é o registry imutável. `runtime/governance/gate-mode.mjs` é o único resolver de modo/veredito.

Os modos são `off`, `shadow`, `canary` e `guarded`. Configuração inválida ou ausente degrada para `canary/continue`.

Somente três domínios são guarded por padrão:

1. QA sign-off na conclusão;
2. invariantes DDD Classe A aplicáveis e determinísticos;
3. Technical Debt nova high/critical introduzida pelo diff atual.

Architecture Debt permanece canary. Privacy/LGPD permanece shadow por padrão.

A governança usa `humanAuthority: owner-wins`. Overrides do owner são auditáveis, vinculados a revisão/escopo e expiram; não transformam evidência falha em evidência aprovada e não ignoram limites reais da plataforma.

## Loop de engenharia orientado a evidência

O host possui o agent loop:

```text
reason -> tool call -> observation -> reason
```

O ContextDevKit preserva o loop no nível do projeto:

```text
objetivo
  -> contexto
  -> implementação
  -> avaliação
  -> findings
  -> correção
  -> nova avaliação
  -> conclusão baseada em evidência
```

`qa-reject` pode devolver uma task de `testing` ou `done` para `backlog`. Evidência stale do ciclo atual é limpa, enquanto eventos históricos permanecem. Se a task pertencer a Workflow concluído, o agregado pode ser reaberto antes do novo ciclo.

## Autoridades de estado

| Agregado | Autoridade gravável | Projeção |
| --- | --- | --- |
| definição/topologia do Workflow | `workflow.json` | `index.md` |
| lifecycle do Workflow | `workflow-state.json` | `index.md` |
| tasks/status/events | `pipeline/tasks.json` | `pipeline/tasks.md` |
| run de execução | `memory/runs/<id>/state.json` | views de status/dashboard |
| preferências recomendatórias | `memory/preferences/owner-preferences.json` | hints de routing/UI |

Atualizações de task validam o documento completo, usam lock, CAS de revisão e rename atômico. O runtime não deriva estado de lanes Markdown, frontmatter, event folding ou plano v1.

## Pacote Workflow v2

```text
WF-####-slug/
├── workflow.json
├── workflow-state.json
├── context-manifest.json
├── prd.md
├── spec.md
├── decisions.md
├── index.md                    # gerado
├── CONTINUATION-PROMPT.md      # guidance opcional
├── pipeline/
│   ├── tasks.json
│   └── tasks.md                # gerado
└── reports/
```

A criação acontece em staging sibling, valida o pacote completo e publica por rename atômico. O loader lê conteúdo autorado, estado canônico e reports antes da mutação.

## Especialistas e profundidade adaptativa

Routing de modelo, seleção de agentes, swarm, economia e preferências são recomendações.

Um diff material pode justificar `code-reviewer`; trabalho de domínio pode justificar `domain-modeler`; mudança sensível pode justificar security; QA completo pode fan-out para unit, integration, fuzz, E2E e performance.

A responsabilidade de engenharia importa mais que a presença de um subagente específico. Se a delegação não estiver disponível, o agente ativo continua com a responsabilidade.

## Project Map

Project Map indexa source e memory roots configuradas. Existe provider boundary para o grafo nativo ou outra implementação.

Graph-first é otimização preferida. Grafo ausente, stale, parcial ou sem resposta faz fallback imediato para busca normal. Refresh nunca bloqueia a primeira ação útil.

## Personalização

Guidance explícito do projeto vive em `memory/preferences/personalization.md`; preferências estruturadas recomendatórias ficam em `owner-preferences.json`.

Os roots dos hosts recebem referências gerenciadas para essas fontes; updates preservam o texto do owner.

## Instalação e portabilidade

O instalador suporta projetos tracked, local-only e NON-GIT. Git apenas enriquece metadata/hooks quando presente. Paths usam `node:path`, readers JSON toleram BOM e generators não dependem de Bash ou de `.gitignore` invisível.

## Fronteira de upgrade

O migrador v3→v4 vive exclusivamente em `contextkit/tools/migrations/v3-to-v4/`. Boot, CLI normal, hooks, MCP, dashboard, statusline e adapters não o importam.

## Fronteira de release

Testes do repositório não são instalados em projetos de usuário. O pacote usa allowlist e recusa selftests, fixtures, golden data, dogfood memory, projeções órfãs e módulos legados alcançáveis.

Uma release só é marcada depois que o gate completo passa.
