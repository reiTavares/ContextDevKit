# ContextDevKit

[![CI — gate completo do GitHub Actions no branch main: clique para ver o estado atual de aprovação ou falha](https://github.com/reiTavares/ContextDevKit/actions/workflows/ci.yml/badge.svg)](https://github.com/reiTavares/ContextDevKit/actions/workflows/ci.yml)
[![npm — versão do pacote contextdevkit publicada atualmente](https://img.shields.io/npm/v/contextdevkit)](https://www.npmjs.com/package/contextdevkit)
![Node — requer versão 18 ou superior](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![Licença — MIT](https://img.shields.io/badge/license-MIT-blue)
![Dependências de runtime — zero no caminho quente](https://img.shields.io/badge/runtime%20deps-0-success)

**O ContextDevKit é uma plataforma de desenvolvimento orientada a negócio e a
governança, para agentes de código.** O trabalho parte da intenção de negócio, é
classificado por pontuação determinística — não perguntando a um modelo — e depois é
conduzido por uma cerimônia que o harness *impõe* com hooks, recibos e agentes
especialistas. Portátil para qualquer projeto, qualquer stack, três hosts de agente.

Quase tudo roda automaticamente, e quase tudo pode ser conduzido de ponta a ponta por um
agente. Você decide quanto, com um dial que nunca baixa o padrão de qualidade — só quem
aperta o botão.

Toda afirmação abaixo é falsificável. Comece por esta — **nenhuma regra deste kit depende
de o modelo escolher obedecer.** Rode em qualquer projeto instalado:

```bash
node contextkit/tools/scripts/doctor.mjs
```

Ele imprime os hooks ligados no seu nível, os git hooks em disco e o modo de instalação, e
sai com código diferente de zero quando o wiring discorda da sua configuração. Um kit
feito só de prompt não consegue produzir essa saída, porque não há nada para inspecionar.

## O problema

Uma sessão termina. O raciocínio atrás do schema, as três abordagens já descartadas, o
motivo daquele retry existir — tudo perdido. A sessão seguinte começa do zero e reconstrói
uma versão pior de uma decisão que você já tomou.

Pior: o trabalho não tem *porquê* anexado. Tickets chegam desconectados do valor que
deveriam criar, então ninguém consegue dizer se uma mudança valeu a pena, e o desvio passa
despercebido até alguém rediscuti-lo em revisão.

Um arquivo de memória ajuda, e só até aí: **ele é instrução.** Sob pressão de contexto o
modelo pode ignorá-lo, e nada detecta que ignorou. Você fica com saída confiante, nenhuma
trilha responsável e nenhuma forma de distinguir um resultado verificado de uma frase
plausível.

## Como o trabalho é estruturado

Três tipos de entidade, cada uma com forma real em disco. Esta é a espinha — todo o resto
do kit existe para mantê-la intacta.

**Business (`BIZ-####`)** — uma capacidade estratégica durável. Carrega o caso de negócio,
a decisão de investimento, o plano aprovado e o próprio contrato de governança, e possui
os workflows que a entregam.

```text
business/BIZ-0005-governed-agent-activation/
├── business-case.md            o problema e a hipótese de valor
├── investment-decision.md      o que está sendo comprometido, e por quem
├── approved-plan.md            o plano que um humano aceitou
├── business.json               estado tipado — kind, intenções de valor, relações
├── governance-contract.json    a cerimônia e a evidência que este contexto deve
├── growth.md · architecture/   análise de apoio
├── workflows/                  os workflows que este Business possui
└── done/ · reports/            artefatos terminais e evidência
```

**Operation (`OP-####`)** — manter, corrigir ou executar dentro de algo que já existe.
Deliberadamente mais leve que um Business.

```text
operations/OP-0010-documentation-restructure/
├── operation.json              estado tipado — kind, intenções, cobertura de decisão
├── reason.md                   por que esta Operation existe
├── tasks.md                    cards do quadro ligados a ela
└── workflows/                  workflows aninhados, quando o trabalho os exige
```

**Workflow (`WF-####`)** — uma unidade de entrega, sempre aninhada sob o contexto que a
possui. Um workflow é um pacote de especificação com checkpoints, não um ticket.

```text
workflows/WF-0096-docs-tooling-and-gates/
├── index.md          estado de fase — intake · prd · spec · adr · roadmap ·
│                     pipeline · ship · testing · conclusion
├── prd.md            problema, objetivos, usuários, não-objetivos, métricas
├── spec.md           leitura da arquitetura, design, contratos, plano de teste
├── decisions.md      os registros de decisão que o governam
├── tasks.md          os cards do quadro que o implementam
├── memory.md         notas de trabalho que sobrevivem à sessão
└── reports/          evidência de conclusão
```

Duas invariantes sustentam isso. Um workflow com dono **vive sob o diretório do dono**,
então nenhuma entrega flutua solta da sua justificativa. E a numeração de workflow é uma
sequência **global** única, não um contador por dono — lacunas são normais e nunca devem
ser renumeradas, porque o número é uma identidade.

Modelo e vocabulário completos: [modelo de domínio](docs/explanation/domain-model.md) ·
[glossário](docs/reference/glossary.md).

## Os classificadores são determinísticos, não um prompt

Toda requisição é classificada antes do trabalho substantivo, por **pontuação ponderada de
substrings sobre um arquivo de política** — sem chamada de modelo, a mesma entrada sempre
produz o mesmo veredito, e as tabelas são bilíngues (sinais em inglês e português têm peso
igual). Editar uma linha é um ato de governança, não um ajuste.

| Eixo | O que decide | Vocabulário |
| --- | --- | --- |
| Natureza | Business ou Operation | `business` · `operation` |
| Business kind | A forma de uma capacidade estratégica | `TRANSFORMATION` · `INITIATIVE` · `PROGRAMME` · `FEATURE` · `ENABLER` |
| Intenção de valor | Por que o trabalho tem valor | `CREATE` · `PROTECT` · `RECOVER` · `ENABLE` · `IMPROVE` · `LEARN` · `COMPLY` · `SERVE_MISSION` |
| Modo de execução | Quanta cerimônia o trabalho merece | `direct` · `batch` · `workflow` |
| Forma de cerimônia | O conjunto concreto de artefatos | `quick-fix` · `batch-operation` · `single-workflow-operation` · `decision-only` · `multi-workflow-program` |
| Ramo da jornada | O caminho ordenado que o harness impõe | `operation-direct` · `operation-batch` · `operation-workflow` · `business-decision` · `business-workflow` |
| Relações | Como contextos dependem uns dos outros | `supports` · `contributes-to` · `triggered-by` · `derived-from` · `blocks` · `blocked-by` · `protects` · `replaces` |

O classificador de natureza tem **Operation como padrão** e só escala para Business quando
a pontuação supera um piso por uma margem, acima de um limiar de confiança. Essa
assimetria é deliberada: classificar manutenção rotineira como trabalho estratégico é o
erro caro, então a cerimônia barata é o padrão e a cara precisa ser conquistada.

Proporcionalidade é um recurso. Uma correção trivial não paga um pacote de especificação
completo — o classificador diz isso, e a jornada daquele ramo é correspondentemente curta.

Duas pontuações adicionais governam a qualidade da implementação: uma de **intenção de
mutação de código**, que reconhece quando uma requisição é de fato uma escrita (uma
tentativa real de escrita é override autoritativo, não suposição), e uma de
**aplicabilidade de domínio**, que decide quando uma requisição merece modelagem explícita
de domínio em vez de ser tratada como encanamento. Juntas, elas selecionam quais
especialistas precisam estar presentes antes de o código ser escrito.

Veja o classificador decidir, sem mutar nada:

```bash
node contextkit/tools/scripts/work.mjs intake "<seu objetivo>"
node contextkit/tools/scripts/domain.mjs "<seu objetivo>"
```

Detalhes: [desenvolvimento orientado a
negócio](docs/explanation/business-driven-development.md).

## Decisões são o mecanismo de autorização

Nada material é autorizado por uma conversa. Um **registro de decisão** é um artefato
tipado e validado, com ciclo de vida próprio, e é ele que autoriza um Business, uma
Operation, um workflow, ou qualquer mudança em algo que já existe.

Toda requisição é checada por **cobertura de decisão** antes do trabalho substantivo.
Quando uma entidade não tem decisão governante, o harness diz isso pelo nome em vez de
prosseguir em silêncio:

```text
NEEDS_DECISION: "work entity" has no decisionRefs.
A governing accepted ADR is required before material work proceeds.
```

### Os tipos, e o que cada um autoriza

Oito tipos, conjunto fechado — acrescentar um é, ele mesmo, uma decisão.

| Tipo | Autoriza |
| --- | --- |
| `BUSINESS_AUTHORIZATION` | Criar ou mudar um contexto de Business |
| `OPERATION_AUTHORIZATION` | Criar ou mudar um contexto de Operation |
| `ARCHITECTURE` | Uma escolha estrutural ou de design |
| `POLICY` | Uma regra que a plataforma vai impor depois |
| `ROUTINE_OPERATION_GOVERNANCE` | Pré-autorizar operações recorrentes de baixa materialidade, para que trabalho rotineiro não fique travado esperando cerimônia |
| `EMERGENCY_GOVERNANCE` | Agir sob pressão de tempo, registrado como tal em vez de pulado |
| `COMPLIANCE` | Uma obrigação imposta de fora |
| `LIFECYCLE` | Concluir, substituir ou aposentar algo |

Cada registro também declara **até onde alcança** — `platform`, `business`, `operation` ou
`workflow` — separadamente de **de quem** é a decisão. Escopo e posse são ortogonais de
propósito: uma política de plataforma pode ser possuída por uma única Operation.

### O ciclo de vida, e a única regra que não se configura

```text
proposed ──→ accepted ──→ superseded
    └──────→ rejected
```

`accepted`, `superseded` e `rejected` são terminais nas direções mostradas; não há volta.
E a invariante em que o modelo todo se apoia:

> **`accepted` implica que quem aprovou foi um humano.**

Isso não é uma configuração. O verbo de aceite **recusa** quando o ator é qualquer coisa
diferente de humano, e nomeia a regra do schema na recusa. O agente pode rascunhar uma
decisão, defendê-la e preencher cada campo — não pode estampá-la. Nenhum grau de
autonomia, inclusive o mais alto, muda isso.

### Autorizando algo, de ponta a ponta

Mutadores são dry-run por padrão. Rode cada comando sem `--apply` primeiro e leia o
recibo; acrescente `--apply` quando o plano for o que você queria.

```bash
# 1. este objetivo precisa de decisão, e já existe alguma cobrindo?
node contextkit/tools/scripts/decision.mjs need "<seu objetivo>"
node contextkit/tools/scripts/decision.mjs search "<seu objetivo>"

# 2. rascunhe — tipo, escopo e contexto dono são declarados de saída
node contextkit/tools/scripts/decision.mjs create \
  --kind OPERATION_AUTHORIZATION --title "<a decisão>" \
  --primary-context OP-0010 --apply

# 3. vincule à entidade que ela governa
node contextkit/tools/scripts/decision.mjs link --id ADR-0153 --apply

# 4. um humano aceita. este passo recusa qualquer outro ator
node contextkit/tools/scripts/decision.mjs accept --id ADR-0153 --actor human --apply
```

Mudar algo já aceito não é uma edição. É um **supersede**: o registro antigo mantém sua
história e aponta para frente, o novo aponta para trás, e essa transição também é
gated por humano.

```bash
node contextkit/tools/scripts/decision.mjs supersede --id ADR-0153 --actor human --apply
```

Leia o corpus inteiro a qualquer momento, e valide-o:

```bash
node contextkit/tools/scripts/decision.mjs render      # o catálogo
node contextkit/tools/scripts/decision.mjs validate    # front matter de cada registro
```

Decisões difíceis passam primeiro por uma **deliberação**: vozes especialistas
independentes argumentam a questão cegas entre si, um sintetizador separado converge, e o
resultado alimenta o contexto da decisão. Uma deliberação sem consenso é um resultado
válido — ela te entrega o tradeoff para resolver em vez de fabricar concordância.

```bash
/debate "<a pergunta de decisão>"
```

Modelo completo: [registrar uma decisão](docs/how-to/record-a-decision.md) ·
[conselho de deliberação](docs/explanation/deliberation-council.md) ·
[contrato de governança](docs/reference/governance-contract.md).

## Quase tudo é automático

O kit é desenhado para que um agente conduza o ciclo de vida, e um humano supervisione o
resultado em vez de cada passo.

| Roda por conta própria | Conduzido por agente a pedido | Sempre seu |
| --- | --- | --- |
| Contexto de boot no início da sessão | Pipeline completo de feature (`/ship`) | Aceitar um registro de decisão |
| Ledger de edições e detecção de desvio | Frentes paralelas em worktrees isolados (`/swarm`) | Qualquer coisa que toque segredos |
| Classificação de requisição e roteamento de squad | Deliberação multi-agente numa decisão difícil (`/debate`) | Force-push |
| Refresh do grafo estrutural, desacoplado do boot | Plano de teste, scaffolding, sign-off de QA | Editar os próprios gates |
| Avaliação de gates e checagem de recibos | Cerimônia de Business e Operation (`/work`) | Elevar o grau de autonomia |
| Varredura de workflows concluídos no fim da sessão | Registro da sessão e entrada no changelog | |

O **dial de autonomia** (graus 1 a 4) decide quanto da coluna do meio acontece sem
confirmação: manual, sugerir-e-esperar, automático-exceto-decisões, e totalmente
automático em branches de feature. Baixar o grau transforma comportamento automático de
volta em pergunta. Ele nunca baixa qualidade — os mesmos gates, recibos e especialistas
valem em todo grau. A coluna da direita é um piso que nenhuma configuração remove,
inclusive no grau 4.

```bash
node contextkit/tools/scripts/autonomy.mjs      # o grau em vigor e o que ele recusa
```

## Agentes especialistas que governam qualidade

36 agentes em 9 squads, cada um com um lead e um conjunto de caminhos que possui. O
roteamento é **por caminho e por sinal**, então o squad cuja superfície uma mudança
comprovadamente toca é o que entra — e um squad sem nada a dizer não emite nada.

| Squad | Lead | Entra quando |
| --- | --- | --- |
| devteam | architect | Biblioteca central, utilitários, serviços — além de implementação, revisão e modelagem de domínio |
| qa-team | qa-orchestrator | Testes e especificações; roteia para unidade, integração, ponta a ponta, performance e adversarial |
| security-team | security | Autenticação, middleware, fronteiras de confiança, dependências, infraestrutura |
| design-team | ux-designer | Componentes, páginas, fluxos, acessibilidade, superfícies de conversão |
| product-team | product-owner | Roadmap e requisitos |
| ops-team | devops | Pipelines, deploys, ambientes, observabilidade |
| growth-team | growth | Analytics, funis, retenção, descoberta |
| compliance-team | privacy-lgpd | Tratamento de dado pessoal e obrigações regionais |
| agent-forge | forge-orchestrator | Forjar pacotes portáteis de agente |

O que isso compra concretamente: uma mudança em caminho de autenticação puxa o lead de
segurança, você tendo lembrado de pedir ou não; uma mudança de código não alcança
conclusão sem o revisor ter olhado; e a qualidade é julgada por **conformidade de
domínio** — direção de dependência, fronteiras de contexto, acesso entre contextos — e não
por contagem de linha.

Tamanho de arquivo é **sinal advisory de investigação e nunca bloqueante.** Um arquivo
pequeno pode ser mal desenhado e um grande pode estar limpo, e fragmentação artificial
também é dívida. Veja [modelo de qualidade](docs/explanation/quality-model.md).

Roster e gatilhos: [referência de agentes](docs/reference/agents.md) ·
[squads ativos](docs/explanation/active-squads.md).

## O rubric de engenharia que vem junto

Toda instalação recebe quatro documentos que são carregados no contexto do agente, não
apenas arquivados: o rubric, o protocolo de revisão, a disciplina comportamental e
exemplos antes/depois trabalhados. Eles são aquilo contra o que os agentes especialistas
julgam — então o padrão que o revisor aplica é o padrão que você pode ler.

O rubric é ordenado pelo que de fato custa ao projeto, não pelo que um linter consegue
casar:

```text
severidade ≈ probabilidade × raio de impacto × custo-de-consertar-depois
```

### Tier 1 — sistema e arquitetura

O tier de maior alavancagem, e aquele para o qual um linter de contagem de linha é cego.

| Regra | Princípio |
| --- | --- |
| S1 Direção de dependência | Dependências apontam para dentro; o domínio não sabe como é armazenado ou transportado |
| S2 Fronteiras e encapsulamento | Cada módulo tem uma superfície pública deliberada; quem chama depende do contrato, não das entranhas |
| S3 Acoplamento e ciclos | Sem ciclos de import; atenção a fan-in alto em coisas que mudam muito e a fan-out alto como decomposição faltante |
| S4 Localização de estado | Cada pedaço de estado tem uma fonte de verdade; dado derivado é computado, não armazenado |
| S5 Contextos delimitados e linguagem ubíqua | Um modelo só é válido dentro de uma fronteira; a mesma palavra em dois contextos são dois modelos, e as palavras no código são as palavras da conversa |
| S6 Agregados, invariantes, fronteiras transacionais | Onde existe uma invariante, um único dono a impõe numa única transação. **Sem invariante, não há agregado** |
| S7 Contratos de costura e anticorrupção | Toda costura tem contrato explícito; formas estrangeiras são traduzidas na borda em vez de se espalharem para dentro |

**A faixa de domínio é gated por perfil, e esse é o ponto.** S5 a S7 só se aplicam quando
o perfil de implementação resolvido carrega peso de domínio. Num perfil simples ou modular
elas **não são achados** — reportá-las ali é achado fabricado, e a revisão diz "não
avaliado". Violar uma fronteira de domínio *declarada* bloqueia merge; a mesma observação
contra um mapa auto-semeado e não revisado é, no máximo, candidata — proponha a fronteira,
não condene o código por não ter uma.

O classificador decide, e é o mesmo sinal que coloca o especialista de modelagem de domínio
na sala, então revisão e build julgam o trabalho pela mesma régua:

```bash
node contextkit/tools/scripts/domain.mjs "<seu objetivo>"
```

### Tier 2 — higiene de módulo e função

Real e digno de correção, mas local e barato: complexidade e coesão, responsabilidade
única, separação de preocupações, erros, nomenclatura, documentação, testes — e
desperdício.

**Lean code é regra explícita, não slogan.** O código mais barato é o que você não
escreveu, cada linha é inventário que alguém precisa ler e carregar, e **remover código é
contribuição de primeira classe.** Seis formas nomeadas de desperdício: generalidade
especulativa (uma abstração com exatamente uma implementação, escrita para um segundo
consumidor que nunca chegou), código morto e inalcançável, camadas de passagem que
acrescentam um salto e nenhum significado, regras de negócio duplicadas, código defensivo
para estados impossíveis, e otimização prematura sem caminho quente medido.

A calibragem importa tanto quanto a regra: lean não é lacônico. Nomes, guard clauses em
fronteiras reais e testes que pegam bugs são o trabalho, não desperdício. E código morto
pré-existente é roteado para sua própria tarefa — nunca exigido dentro de uma mudança não
relacionada.

### Severidade, e o que de fato pode bloquear

| Rótulo | Significado |
| --- | --- |
| Blocker | Corrija antes do merge. Reprova o gate de dívida — um piso de dívida real, nunca tamanho de arquivo por si só |
| Hard | Violação clara, sem desculpa de coesão |
| Candidate | Julgamento; pode ser justificado. Explique o tradeoff |
| Nit | Mencione uma vez, não litigue |

Duas propriedades evitam que isso vire burocracia. **Contagem de linha é sempre advisory** —
uma leitura elevada é um convite mais alto à investigação, nunca um bloqueio; o achado
ganha sua severidade do defeito real que a investigação revelar, ou permanece advisory. E
**toda regra carrega uma cláusula de "não superaplique"**, porque uma proteção respeitada
vale mais que um falso positivo sinalizado: uma aplicação de contexto único tem um contexto
delimitado e essa é a resposta certa; CRUD sem invariantes não precisa de agregado; um
script de três arquivos não precisa de arquitetura hexagonal.

O rigor escala com o risco: o rubric completo vale para caminhos de produção, enquanto
spikes e código descartável relaxam deliberadamente a régua de higiene e testes.

```bash
/analyze-code-ia-practices     # roda o rubric e traz propostas, não divisões aleatórias
```

Rubric e protocolo completos: [modelo de qualidade](docs/explanation/quality-model.md) ·
[auditar e testar](docs/how-to/audit-and-test.md) ·
[engenharia de domínio](docs/how-to/use-domain-engineering.md).

## Os pilares de capacidade

O registro de governança do próprio kit, cada pilar um programa com suas decisões e
workflows em disco. É disto que a plataforma é feita.

| Pilar | O que entrega |
| --- | --- |
| Desenvolvimento orientado a negócio e governança de decisão (`BIZ-0001`) | A espinha acima: intenção de negócio, os classificadores determinísticos, a jornada que o harness impõe, e a regra de que o agente pode propor uma decisão mas nunca aceitá-la |
| Engenharia de domínio e implementação determinística (`BIZ-0003`) | O perfil de implementação — modelagem de domínio, linguagem ubíqua, contextos delimitados, autoridade de estado — mais as pontuações que decidem quando ele se aplica |
| Grafo estrutural de conhecimento e inteligência de código (`BIZ-0004`) | Um grafo consultável da base de código, para que um agente responda perguntas estruturais a partir de um índice em vez de reler a árvore |
| Ativação governada de agentes e qualidade (`BIZ-0005`) | O gate de dispatch em dois níveis, evidência de agente, o gate de revisor em toda mudança material, seleção de squads guiada por grafo, e a aposentadoria do alarme de contagem de linha |
| Integridade do plano de metodologia e autogovernança (`BIZ-0006`) | A metodologia governando a si mesma: formas canônicas de cerimônia, integridade de finalização, verbos de ciclo de vida, guardas de desvio, e uma jornada canônica entre hosts |

Um outro programa, a plataforma de runtime e execução governada de agentes (`BIZ-0002`), é
**direção proposta, não capacidade entregue** — está nomeado aqui por honestidade sobre o
roadmap, e nada no kit hoje depende dele.

## Instrução versus enforcement

Quatro mecanismos carregam a diferença. Nenhum roda a critério do modelo.

**Hooks que bloqueiam, não pedem.** O contexto de boot carrega antes da primeira mensagem.
Toda edição entra num ledger append-only. Uma sessão não pode fechar em silêncio com
trabalho não registrado. A partir do nível 5, um gate de raio de impacto bloqueia edições
em caminhos marcados como alto risco até existir um registro de impacto.

Dito com precisão, porque importa em revisão: hooks são controle de **governança**, não de
segurança. Eles saem com código 0 e ficam calados diante dos próprios erros, por design,
para que um hook quebrado nunca quebre trabalho real.

**Recibos, não afirmações.** Um gate é satisfeito apenas por saída de script. "Os testes
passaram" em prosa não é evidência, e um recibo velho, de outra branch ou contornado
também não. Quando uma verificação não pode rodar, o resultado é `skipped` — **nunca**
aprovado. Dado ausente nunca conta a seu favor.

**O agente não pode aprovar o próprio trabalho.** Propostas seguem rascunho → aprovação →
revisão → rejeição, e quem aprova nunca é quem rascunhou.

**Degradação graciosa em vez de bloqueio falso.** O gate de enforcement vem guarded por
padrão e é seguro vir ativo justamente porque **degrada para advisory sempre que não
consegue avaliar com segurança** — uma instalação nova nunca é falsamente bloqueada, e uma
recusa sempre nomeia o comando corretivo exato.

Comportamento completo, por gate: [governança e
enforcement](docs/explanation/governance-and-enforcement.md) ·
[contrato de governança](docs/reference/governance-contract.md).

## Prova que você pode rodar

Cada linha é um comando que existe em disco e imprime a afirmação em vez de repeti-la.

| Comando | O que prova |
| --- | --- |
| `doctor.mjs` | O wiring de hooks corresponde ao nível configurado; git hooks presentes; modo de instalação |
| `work.mjs intake "<objetivo>"` | O veredito do classificador para uma requisição real, somente leitura |
| `work.mjs status` | Contextos de Business e Operation, e sua cobertura de decisão |
| `workflow-assist.mjs --list` | Workflows ativos e a fase em que cada um está parado |
| `domain.mjs "<objetivo>"` | Qual perfil de implementação e quais especialistas uma requisição seleciona |
| `project-map.mjs --find <símbolo>` | Um símbolo resolve para um arquivo sem busca em todo o repositório |
| `graph-query.mjs` | O grafo estrutural é legível, ou reporta honestamente `available: false` |
| `autonomy.mjs` | O grau de autonomia em vigor, e o que ele ainda recusa |
| `token-report.mjs` | Consumo de tokens medido no seu repositório, não estimado aqui |

Todos ficam em `contextkit/tools/scripts/` num projeto instalado.

Medido neste repositório em 2026-07-27: **83 comandos, 36 agentes, 83 skills, 3 hosts
nativos**, e um grafo estrutural de **24.157 nós sobre 46.949 arestas**. Esses são os
números deste repo naquela data — os comandos acima imprimem os seus.

## Instalação

```bash
# do npm — nível 3 para pasta vazia, nível 7 quando a pasta já tem código
npx contextdevkit --target . --yes

# ou direto do GitHub, sem conta no npm
npx github:reiTavares/ContextDevKit --target . --yes
```

Escolha como o kit vive no git. Trocar depois não é destrutivo — alterna um bloco de
exclusão local gerenciado, nunca o seu índice.

| Modo | Escolha quando | Efeito |
| --- | --- | --- |
| Local-only (padrão) | Trabalho solo, experimento, avaliação do kit | Artefatos do kit ficam fora do histórico git; updates nunca inundam seus commits. Colegas e CI não os veem. |
| Rastreado (`--tracked`) | Um time, várias máquinas ou CI | Sem bloco de exclusão, então você pode comitar o kit e todo mundo que clonar herda a mesma memória, agentes e governança. |

Uma pasta vazia é estruturada de ponta a ponta. Um projeto existente tem sua stack
detectada, e o seu próprio arquivo de boot nunca é sobrescrito — o kit escreve um arquivo
companheiro para você mesclar. Git hooks pré-existentes são preservados com backup.

Isto é uma ferramenta que executa código. Instale com o mesmo cuidado que você dá a
qualquer dependência que roda: ela escreve git hooks a partir do nível 3 e hooks de host
que rodam `node` a cada sessão, commit e push. Fixe uma tag para instalação reproduzível.
Inventário completo do que vai para o disco, e como remover:
[pegada](docs/reference/footprint.md).

Depois abra o projeto no seu host e rode uma coisa só:

```text
/setupcontextdevkit
```

Ele inspeciona o projeto, ajusta a configuração à sua stack, estrutura os sub-agentes de
domínio, registra uma decisão de baseline e loga a sessão — de "kit instalado" a "kit
ajustado a este projeto" numa passada.

## Níveis

O **nível** decide quais capacidades existem; o **grau de autonomia** decide quanto delas
roda sem você. Dials independentes. Todo nível mantém tudo abaixo dele.

| Nível | O que acrescenta |
| --- | --- |
| 1 Memória | Contexto de boot, log de sessão, registros de decisão, changelog |
| 2 Ledger | Detecção de desvio — rastreio de edições mais um empurrão no fim da sessão |
| 3 Multi | Reservas, worktrees, índices derivados, git hooks (padrão para projeto novo) |
| 4 Squads | Sub-agentes especialistas, grafo estrutural, gates de domínio |
| 5 Proativo | Gate de raio de impacto, imposição da jornada, evidência de conclusão, escopo de sub-agente |
| 6 Autonomia e insight | Pipeline de entrega, laço de aprendizado, métricas medidas |
| 7 Ecossistema e escala | Frota multi-repo, ajuste de agentes, testes visuais, playbooks, insight de token e custo (padrão para base de código existente) |

```bash
node contextkit/tools/scripts/context-level.mjs      # mostra, ou passe 1-7 para mudar
```

Escolhendo: [instalar e escolher um nível](docs/how-to/install-and-choose-a-level.md) ·
[referência de níveis](docs/reference/levels.md).

## Três hosts nativos

O mesmo motor, os mesmos scripts, três front ends de primeira classe.

| Host | Superfície | Runner |
| --- | --- | --- |
| Claude Code | Comandos de barra, sub-agentes, hooks | nativo |
| Antigravity | Skills, personas, playbooks | `node ctx.mjs <comando>` |
| Codex | Skills mais definições de subagente | `node cdx.mjs <comando>` |

Outros editores alcançam a mesma memória por bridges de contexto opt-in, que projetam
contexto sem a camada nativa de hooks — informam o agente e não impõem nada. Veja
[trabalhar entre hosts e bridges](docs/how-to/work-across-hosts-and-bridges.md).

## Para onde ir depois

**Começar a rodar.** [Instalar e escolher um
nível](docs/how-to/install-and-choose-a-level.md) ·
[Configurar](docs/how-to/configure-contextkit.md) ·
[Referência de configuração](docs/reference/config.md) ·
[Atualizar](docs/how-to/upgrade-and-update.md) ·
[Resolver problemas](docs/how-to/troubleshoot.md)

**Aprender o método.** [Primeiro caso de
negócio](docs/tutorials/first-business-case.md) ·
[Conduzir um caso de negócio](docs/how-to/run-a-business-case.md) ·
[Rodar um workflow](docs/how-to/run-a-workflow.md) ·
[Anatomia de business, operation e
workflow](docs/how-to/anatomy-of-business-operation-workflow.pt-br.md)

**Entender o modelo.** [Desenvolvimento orientado a
negócio](docs/explanation/business-driven-development.md) ·
[Governança e enforcement](docs/explanation/governance-and-enforcement.md) ·
[Modelo de qualidade](docs/explanation/quality-model.md) ·
[Modelo de domínio](docs/explanation/domain-model.md) ·
[As três economias](docs/explanation/the-three-economies.md) ·
[Glossário](docs/reference/glossary.md)

**Ir mais fundo.** [Grafo de conhecimento](docs/how-to/use-the-knowledge-graph.md) ·
[Engenharia de domínio](docs/how-to/use-domain-engineering.md) ·
[Forjar um pacote de agente](docs/how-to/forge-an-agent-package.md) ·
[Conectar servidores MCP](docs/how-to/connect-mcp-servers.md) ·
[Swarm paralelo](docs/how-to/run-a-parallel-swarm.md) ·
[Reduzir custo de token](docs/how-to/reduce-token-cost.md)

**Confiança e revisão.** [Pegada](docs/reference/footprint.md) ·
[Postura de dados](docs/reference/data-posture.md) · [Privacidade](docs/PRIVACY.md) ·
[Política de segurança](SECURITY.md) ·
[Modelo de memória](docs/reference/memory-model.md)

Índice completo, organizado por [Diátaxis](https://diataxis.fr/), em
[docs/README.md](docs/README.md). English guide: [README.md](README.md).

## Perguntas frequentes

**O que sai da minha máquina?** Sem telemetria, sem conta, sem endpoint pertencente a este
projeto. Memória, ledger e métricas são arquivos comuns no seu repositório. Duas chamadas
numa instalação padrão alcançam o seu *próprio* remote git. Adicionar um servidor MCP é o
único caminho opt-in que concede acesso de leitura ao repositório a um terceiro. Detalhes:
[postura de dados](docs/reference/data-posture.md).

**Preciso de chave de API?** Não para o kit. Seu agente traz a própria autenticação; o kit
é Node puro e configuração de host.

**A cerimônia atrasa mudanças pequenas?** Não, e isso é imposto em vez de prometido: o
classificador resolve uma correção trivial para o ramo mais curto, e os artefatos que
aquele ramo deve são correspondentemente poucos. A cerimônia cara precisa ser conquistada
por pontuação.

**Quanto custa em tokens?** Não é um número que esta página possa dar honestamente;
depende do tamanho do repo, do nível e da memória acumulada. É mensurável em vez de
estimado — `token-report.mjs` atribui consumo por sessão e por comando no seu próprio
projeto.

**Funciona fora da minha stack?** O motor é agnóstico de stack — Node puro com zero
dependências de runtime no caminho quente, então os níveis 1 a 3 rodam num projeto sem
nada instalado. A detecção de stack ajusta caminhos e gates ao que você já usa, e nunca
instala um segundo framework de teste ou formatador.

**O que quebra se eu desinstalar?** Nada no seu código-fonte. Desinstalar desconecta os
hooks e deixa sua memória e seu arquivo de boot no lugar; `--purge` também remove o
diretório do motor. Git hooks pré-existentes são restaurados dos seus backups.

## Contribuindo

O código-fonte vive em `templates/` e `tools/` — nunca numa cópia instalada em
`contextkit/`. O [CONTRIBUTING.md](CONTRIBUTING.md) tem as regras imutáveis: zero
dependências no caminho quente, hooks nunca quebram trabalho real, toda adição vem com
teste.

## Licença

MIT — veja [LICENSE](LICENSE).
