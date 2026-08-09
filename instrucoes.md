# ContextDevKit

O ContextDevKit é uma camada portátil de governança e memória de projeto para
desenvolvimento assistido por IA. Ele oferece suporte a Claude Code, OpenAI
Codex, Google Antigravity e Grok sem adicionar framework de aplicação nem
dependência de pacote ao hot path dos hooks.

O modelo 4.0 é deliberadamente silencioso: a governança começa quando a
interação vai alterar arquivos ou estado governado. Conversa e exploração
somente leitura não criam tarefa, workflow, ledger, recibo ou contexto durável.

Documentação principal em inglês: [README.md](README.md).

## Contrato operacional

Cada interação é classificada antes de iniciar governança:

| Interação | Efeito durável |
| --- | --- |
| Conversa | Nenhum |
| Exploração somente leitura | Nenhum |
| Intenção não classificada | Uma pergunta curta no idioma do usuário; sem persistência |
| Mutação | Resolve trabalho existente, classifica a natureza, escolhe a forma de execução e aplica a governança pertinente |

Uma tentativa real de escrita promove a interação para mutação exatamente uma
vez. Isso vale igualmente para fonte, documentação, configuração e memória.

Trabalho de mutação usa a menor forma adequada:

- **direct** — uma a três tarefas coesas;
- **batch** — quatro a doze tarefas relacionadas sem ordem forte;
- **workflow** — ordem obrigatória, dependências, waves, múltiplas sessões,
  cutover ou rollback.

`Business`, `Operation` e `none` descrevem a natureza. `none` é normal para uma
feature focada, correção, documentação ou mudança técnica. Business exige um
resultado estratégico durável; Operation exige uma capacidade durável de
manutenção ou operação. Nenhum dos dois é inferido apenas por palavra-chave.

## Dispatcher único e governança limitada

Cada host executa no máximo um processo ContextDevKit por evento:

1. `prompt-preflight`
2. `write-preflight`
3. `postflight`
4. `completion`

O dispatcher centraliza deduplicação, orçamento de tempo, proteção de reentrada
e circuit breaker. Falha interna segue `continue`: gera diagnóstico, nunca um
pass fabricado e nunca quebra o trabalho real do usuário.

Os modos de gate têm significados exatos:

- **canary** avalia e relata sem negar;
- **shadow** observa sem alterar o resultado;
- **guarded** só pode negar violação aplicável, determinística e comprovada no
  momento documentado.

Somente três domínios são guarded por padrão:

| Gate | Momento de bloqueio | Condição exata |
| --- | --- | --- |
| `qa-signoff` | completion | transição para `done` sem evidência determinística de QA |
| `ddd-invariants` | write-preflight, completion | violação determinística de invariante de domínio Classe A aplicável |
| `technical-debt` | completion | o diff atual introduz dívida nova high ou critical |

Todos os demais gates — graph, intake, journey, presença de workflow,
simulação, deliberação, routing, escopo de subagente, economia e carregamento de
contexto — usam canary. `privacy-lgpd` é shadow.

O owner pode registrar override humano com escopo para um veredito guarded. O
override registra ator, razão, escopo, versão/hash da política, revisão-base,
timestamp, expiração e resultado. Ele não reescreve evidência nem desativa
controles reais do host ou da plataforma.

## Autoridade de estado

Existe uma única autoridade gravável para cada tipo de estado:

| Estado | Autoridade |
| --- | --- |
| Definição do workflow | `workflow.json` |
| Ciclo de vida do workflow | `workflow-state.json` |
| Tarefas e status | `pipeline/tasks.json` |
| Execução transitória do pipeline | `memory/runs/<run-id>/state.json` |
| Preferências do owner | store canônico de preferências do owner |

Os status são `backlog`, `working`, `blocked`, `testing`, `done` e `cancelled`.
As escritas usam validação, revisão compare-and-swap, lock e substituição
atômica. A transição de status e seu evento de auditoria são gravados no mesmo
documento.

Arquivos Markdown como `tasks.md` e `index.md` são projeções derivadas. O
runtime nunca os lê como autoridade e pode repará-los a partir do JSON.

Um pacote de workflow contém:

```text
WF-####-slug/
├── workflow.json
├── workflow-state.json
├── prd.md
├── spec.md
├── decisions.md
├── CONTINUATION-PROMPT.md
├── context-manifest.json
├── pipeline/
│   ├── tasks.json
│   └── tasks.md              # projeção gerada
└── reports/
```

Trabalhos direct e batch usam o mesmo contrato de tarefas dentro do contexto
owner. Um workflow nasce completo em diretório sibling de staging, é validado e
renomeado atomicamente para o destino.

## Grafo, routing e agentes

Project Map é a primeira consulta preferida porque localiza código e memória com
menos contexto. Se o grafo estiver ausente, stale, parcial ou não responder à
consulta, a busca ampla continua imediatamente disponível. Graph-first nunca
bloqueia `Grep`, `Glob`, `rg` ou fallback equivalente.

Seleção de modelo, routing de especialistas, forma do swarm, sugestões de
economia e preferências do owner são recomendações. Não concedem autoridade e
sua ausência não nega escrita. Swarm é opcional e só respeita um limite técnico
real quando o host efetivamente o expõe.

O agente LGPD opera somente em shadow: pode emitir observações de privacidade,
mas não vira gate obrigatório de agente.

Para ação destrutiva em produção, force-push ou rotação de segredo, o kit emite
um `riskAcknowledgement` não bloqueante. A confirmação continua pertencendo ao
limite real do host ou da plataforma.

## Instalação

Requisito: Node.js 18 ou superior. O hot path dos hooks tem zero dependências de
runtime.

```bash
npx contextdevkit --target /caminho/do/projeto
```

Neste checkout do repositório:

```bash
node install.mjs --target /caminho/do/projeto
```

O instalador aceita projetos tracked, local-only e sem Git. Em diretório sem
Git ele declara `NON-GIT` com honestidade e pula apenas integrações dependentes
de Git.

Os níveis habilitam capacidades; não são graus de consentimento:

| Nível | Capacidades |
| --- | --- |
| 1 | memória durável do projeto |
| 2 | dispatchers de governança e diagnósticos do host |
| 3 | coordenação multissessão e claims |
| 4 | agentes especialistas e papéis de QA |
| 5 | análise de impacto, arquitetura e qualidade |
| 6 | comandos autônomos de pipeline e ciclos de aprendizado |
| 7 | fleet, ecossistema, QA visual e observabilidade avançada |

A instrução atual do owner determina o que o agente pode fazer. ContextDevKit
não converte nível, rota de modelo ou preferência em permissão.

## Comandos diários

Use a CLI compartilhada via `cdx.mjs` (Codex) ou `ctx.mjs` (outros hosts):

```bash
node cdx.mjs state
node cdx.mjs project-map --find <símbolo-ou-path>
node cdx.mjs dev-start <objetivo>
node cdx.mjs pipeline
node cdx.mjs workflow new <slug>
node cdx.mjs qa-signoff
node cdx.mjs log-session
```

Quando um comando mutador oferece switch de escrita, o padrão é dry-run. Leia o
recibo antes de aplicar.

## Atualização do 3.x

Não existe fallback live. Lanes Markdown, planos de workflow v1, graus de
autonomia, cadeias antigas de hooks e writers antigos só são aceitos pelo
migrador offline explícito.

A sequência segura é inventário e dry-run, staging, freeze dos writers antigos,
prova de paridade e rollback, cutover atômico e, então, retirada das fontes v3.
O rollback aponta para uma geração v4 copiada e verificada byte a byte; o
workspace externo preserva o bundle e o manifest da origem v3.

Consulte [MIGRATION-3.x-TO-4.0.md](MIGRATION-3.x-TO-4.0.md) para comandos,
conversão de configuração, recusas, paridade e rollback.

## Desenvolvimento e verificação

```bash
npm run test:smoke
npm run test:selfcheck
npm run test:integration
npm test
npm run release:v4:gate
```

O runner é limitado, emite progresso e heartbeat e encerra a árvore de
processos em timeout. O empacotamento usa allowlist e recusa runtime legado
alcançável, drift de projeções de host, fixtures no tarball ou rollback de
migração não exercitado.

Uma versão de release só é gravada depois que todos os gates de release
estiverem verdes.

## Documentação

- [Índice da documentação](docs/README.md)
- [Arquitetura](docs/ARCHITECTURE.md)
- [Contrato de governança](docs/reference/governance-contract.md)
- [Configuração](docs/reference/config.md)
- [Engine de workflow](docs/workflow-engine/README.md)
- [Segurança e privacidade](docs/PRIVACY.md)
- [Migração do 3.x](MIGRATION-3.x-TO-4.0.md)

## Licença

[MIT](LICENSE)
