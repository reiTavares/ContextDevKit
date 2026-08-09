# ContextDevKit

**Harness de Governança para Engenharia de Software com IA, orientado a desenvolvimento adaptativo e loops baseados em evidência.**

O ContextDevKit é um harness host-agnostic que fornece inteligência persistente do projeto, memória de longa duração, estado governado do trabalho, orientação de engenharia proporcional e entrega baseada em evidência para Claude Code, OpenAI Codex, Google Antigravity, Grok e hosts compatíveis.

Ele **não** substitui o coding agent, o provedor de modelo, o runtime de ferramentas ou o agent loop.

Ele opera ao redor deles como a camada de engenharia durável do projeto.

> **Iniciantes ganham guardrails de engenharia. Engenheiros seniores ganham alavancagem. Nenhum dos dois ganha cerimônia desnecessária.**

O objetivo é ajudar projetos a sair do vibe coding e chegar a uma engenharia AI-native disciplinada sem transformar metodologia em burocracia.

[Read in English](../../README.md)

## Por que o ContextDevKit existe

Uma sessão de coding agent não é, sozinha, um sistema de engenharia de software.

Sem uma camada persistente, agentes podem esquecer decisões de sessões anteriores, ignorar PRDs/SPECs/ADRs, recriar trabalho já existente, perder tarefas pendentes, introduzir drift arquitetural, declarar conclusão sem evidência suficiente ou usar o mesmo nível de processo para um typo e para uma migração crítica.

O ContextDevKit adiciona o sistema de engenharia no nível do projeto.

```text
                         CONTEXTDEVKIT
              AI SOFTWARE ENGINEERING HARNESS

 ┌──────────────────────────────────────────────────────────────┐
 │ Intenção & Intake                                            │
 │ conversa · exploração · mutação · esclarecimento            │
 ├──────────────────────────────────────────────────────────────┤
 │ Business-Driven Development                                  │
 │ Business · Operation · none                                  │
 │ direct · batch · workflow                                    │
 ├──────────────────────────────────────────────────────────────┤
 │ Inteligência do Projeto                                      │
 │ Project Map · grafo · ADRs · specs · decisões · reports      │
 ├──────────────────────────────────────────────────────────────┤
 │ Memória de Longa Duração                                     │
 │ histórico · preferências · decisões · evidência              │
 ├──────────────────────────────────────────────────────────────┤
 │ Execução de Engenharia                                       │
 │ tasks · workflows · especialistas · compiler · compact       │
 ├──────────────────────────────────────────────────────────────┤
 │ Loops de Engenharia Orientados a Evidência                   │
 │ implementar → avaliar → corrigir → reavaliar → entregar      │
 ├──────────────────────────────────────────────────────────────┤
 │ Governança                                                   │
 │ quality floors guarded · guidance canary · análise shadow    │
 └──────────────────────────────┬───────────────────────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
         Claude Code           Codex        Outros hosts
```

O host executa. **O ContextDevKit preserva a inteligência do projeto.**

## Do vibe coder ao engenheiro sênior

| Perfil | O que o ContextDevKit acrescenta |
| --- | --- |
| **Vibe coder** | testes, revisão, quality floors, memória persistente e estrutura que o usuário talvez nem saiba pedir |
| **Desenvolvedor** | contexto, estado de tasks, workflows reutilizáveis, evidência, reports e continuidade |
| **Engenheiro sênior** | execução mais rápida, especialistas, consciência arquitetural e decisões duráveis sem retirar autoridade técnica |
| **Tech Lead** | memória compartilhada, ADRs, política de qualidade, ownership e consistência entre sessões |
| **Time AI-native** | inteligência de projeto que sobrevive à troca de modelos, agentes e hosts |

> **Use engenharia suficiente para o risco e a complexidade da mudança — nem mais, nem menos.**

## Primeiro: existe trabalho real para governar?

Antes de iniciar governança, a interação é classificada como:

```text
conversation | exploration | mutation | unclassified
```

- **conversation**: responde normalmente, sem criar estado durável;
- **exploration**: investiga em modo somente leitura;
- **mutation**: ativa o intake e a classificação de trabalho;
- **unclassified**: faz uma pergunta curta em vez de adivinhar.

Uma tentativa real de escrita é autoritativa e promove a interação para `mutation`.

```text
pedido do usuário
      │
      ▼
classificador de interação
      │
      ├── conversa ─────→ responder
      ├── exploração ───→ investigar
      ├── incerto ───────→ perguntar uma vez
      └── mutação
             │
             ▼
           intake
```

A governança começa quando o projeto vai realmente mudar, não toda vez que alguém conversa com a IA.

## Intake Envelope

Depois de confirmar uma mutação, o ContextDevKit forma um **Intake Envelope** transitório.

Esse envelope é um modelo mental para os sinais que o runtime já produz. Ele **não é um novo arquivo, receipt ou cerimônia obrigatória**.

Ele combina:

```text
interaction
existingWork
nature
executionMode
complexity / tier
domain / risk
valueIntent
decisionNeed / decisionMatch
businessMatch
reasons / evidence
```

Isso permite que diferentes modelos e hosts partam dos mesmos fatos antes de tomar decisões de engenharia.

## Business-Driven Development

O ContextDevKit diferencia o motivo durável do trabalho da forma de execução.

### Business

`Business` (`BIZ-####`) representa uma capacidade estratégica, produto, iniciativa ou decisão durável cujo resultado vale a pena preservar por muitas sessões e mudanças.

Business guarda o **porquê durável**.

### Operation

`Operation` (`OP-####`) representa manutenção, incidente, recuperação, melhoria operacional ou outro conjunto durável de trabalho dentro de uma capacidade existente.

Operation guarda uma **razão operacional durável**.

### none

`none` é um resultado normal e importante.

Uma feature focada, bug localizado, alteração documental ou mudança técnica pequena não precisa ganhar um Business ou Operation só porque o ContextDevKit existe.

Isso evita transformar a memória de governança em um depósito de burocracia.

## Ownership e forma de execução são eixos independentes

`Business | Operation | none` responde **qual contexto durável possui o motivo do trabalho**.

`direct | batch | workflow` responde **quanta coordenação a execução realmente exige**.

- **direct**: normalmente 1–3 tarefas coesas;
- **batch**: normalmente 4–12 tarefas relacionadas sem ordem forte;
- **workflow**: dependências reais, waves, ordem obrigatória, múltiplas sessões, integração coordenada, cutover/rollback ou workflow explicitamente solicitado.

Business não força Workflow. Operation não força Workflow. Vocabulário de arquitetura, ADR ou compliance também não.

## Trabalho existente antes de trabalho novo

Antes de criar novo estado governado, o intake pode resolver se a mutação pertence a algo já existente:

```text
explicit | inferred | ambiguous | new | none
```

Um item concluído não é reaberto silenciosamente. Um match ambíguo não é escolhido silenciosamente. Uma relação fraca com Business não vira ownership automático.

O matcher de Business pode **sugerir** um vínculo para uma Operation usando evidência determinística, mas não o confirma sozinho.

## Loop Engineering orientado a evidência

Para trabalho relevante, a entrega é um ciclo:

```text
IMPLEMENTAR
    ↓
AVALIAR
    ↓
FINDINGS
    ↓
CORRIGIR
    ↓
REAVALIAR
    ↓
EVIDÊNCIA NOVA
    ↓
DONE
```

Uma task rejeitada em QA pode voltar para um novo ciclo. Evidência da rodada anterior não valida automaticamente a implementação corrigida. Um Workflow concluído pode ser reaberto quando feedback posterior invalida a conclusão anterior.

Assim, `done` representa estado de engenharia sustentado por evidência, não apenas a afirmação do modelo.

## Profundidade adaptativa de engenharia

Nem toda mudança precisa dos mesmos avaliadores.

O agente ativo usa escopo, complexidade, blast radius, risco, contratos afetados, peso de domínio, critical paths, instrução do owner e evidência disponível para decidir a profundidade adequada.

Um typo pode exigir só validação focada. Uma feature material pode justificar testes e code review. Uma mudança crítica pode justificar QA completo, DDD, arquitetura, technical debt, security, integration/E2E e performance quando aplicável.

Se o owner disser explicitamente "não termine até QA, DDD, arquitetura, debt, review e testes estarem limpos", esses checks passam a fazer parte do outcome solicitado.

## Governança: quality floors sem soberania da plataforma

Os modos de enforcement são:

```text
off | shadow | canary | guarded
```

### guarded

Três domínios são `guarded` por padrão:

| Quality floor | Protege |
| --- | --- |
| **QA sign-off** | conclusão sem evidência determinística suficiente de QA |
| **DDD invariants** | violação comprovada de invariante Classe A aplicável e declarado |
| **Technical debt** | dívida nova high/critical comprovadamente introduzida pelo diff atual |

Esses floors existem para evitar que o agente declare `done` silenciosamente com uma violação determinística conhecida.

Eles não tornam o ContextDevKit dono do projeto. O owner pode configurar os modos e usar override humano com escopo e auditoria sem fingir que a evidência passou.

### canary

Canary avalia e reporta, mas não nega.

Architecture Debt, graph-first, routing, workflow presence, journey, simulations, deliberation, economy e context-pack são canary por padrão.

Architecture Debt é deliberadamente separado de Technical Debt: encontra risco estrutural e produz evidência, mas não vira um quarto guarded gate por conta própria.

### shadow

Privacy/LGPD é shadow por padrão. Ele pode observar riscos de privacidade sem inferir que contratos, bases legais, DPAs ou controles externos não existem apenas porque não estão no repositório.

## Owner sovereignty

O ContextDevKit governa o projeto sem disputar autoridade com o owner.

A configuração padrão usa `humanAuthority: owner-wins` dentro da governança, preservando os limites reais de segurança do host/plataforma.

O harness pode mostrar evidência, aplicar quality floors configurados, preservar decisões, recomendar especialistas, recusar PASS fabricado e registrar override explícito.

Ele não deve transformar score de modelo, agent routing, swarm, graph, councils
ou metodologia opcional em permissão para trabalhar. Uma instrução atual do
owner ou um workflow/skill/classificação governada pode exigir debate, review ou
coordenação paralela; essa exigência não depende de campos legados do routing.

## Especialistas são ferramentas

ContextDevKit possui agentes especializados em arquitetura, implementação, code review, domain modeling, QA, security, accessibility, DevOps, product, design, growth e outros domínios.

Routing é advisory: recomenda o executor, mas nunca autoriza a chamada.

A coordenação é condicional. Pedido explícito do owner ou um
workflow/skill/classificação governada pode tornar debate ou swarm obrigatório;
fora desses gatilhos, eles permanecem opcionais. Recomendação ausente ou
incompleta nunca cancela uma exigência ativada em outro contrato atual.

`code-reviewer`, por exemplo, é fortemente recomendado para diffs materiais e aparece explicitamente no pipeline `/ship`. Se o host não conseguir delegar, o agente ativo continua e executa a responsabilidade. A presença do subagente não é a evidência de qualidade.

## Inteligência e memória do projeto

A memória pode preservar Business, Operations, Workflows, Tasks, ADRs, Specifications, Decisions, Reports, Sessions, preferências do owner, personalização do projeto e evidência de execução.

Um pacote de Workflow mantém o contexto completo:

```text
WF-####-slug/
├── workflow.json
├── workflow-state.json
├── prd.md
├── spec.md
├── decisions.md
├── context-manifest.json
├── CONTINUATION-PROMPT.md
├── pipeline/
│   ├── tasks.json
│   └── tasks.md
└── reports/
```

JSON mantém a autoridade de máquina. Markdown é contexto autorado ou projeção humana. Reports guardam evidência factual.

## Uma autoridade por estado

| Estado | Autoridade |
| --- | --- |
| Definição do Workflow | `workflow.json` |
| Lifecycle do Workflow | `workflow-state.json` |
| Tasks e status | `pipeline/tasks.json` |
| Run transitório | `memory/runs/<run-id>/state.json` |
| Recomendações do owner | `memory/preferences/owner-preferences.json` |

Status não é inferido de Markdown ou de nome de pasta.

## Project Map e grafo estrutural

Project Map é o fast path preferido para descoberta estrutural e pode indexar source + memory configurada, inclusive memória ignorada pelo Git.

Se o grafo estiver ausente, stale, parcial ou sem resposta, o agente usa busca normal imediatamente. Graph-first significa **otimização preferida**, não **proibição de busca**.

## Continuidade de sessões longas

ContextDevKit preserva continuidade com tasks, Workflow state, reports, context manifests, memória de longa duração, continuation prompts, `run-compact`, compactação de output de testes, task compiler, run/session state e preferências do owner.

Trocar de sessão, janela de contexto, modelo ou host não deve apagar o que o projeto já sabe.

## Pipeline completo

`/ship --auto` organiza um passe completo de engenharia:

```text
scope
  ↓
design
  ↓
plan tests
  ↓
implement
  ↓
self-review
  ↓
test / QA
  ↓
quality analysis
  ↓
record decisions/evidence
  ↓
report
```

Evidência vermelha dentro do escopo deve ser corrigida; evidência que não pode ser resolvida honestamente é reportada como unresolved, nunca escondida em um PASS fabricado.

## Instalação

Requer Node.js 18 ou superior. O hot path de governança tem zero dependências de pacote em runtime.

```bash
npx contextdevkit --target /caminho/do/projeto
```

Ou, a partir do checkout:

```bash
node install.mjs --target /caminho/do/projeto
```

## Princípios

1. **Entrega acima da burocracia.**
2. **Evidência acima da cerimônia.**
3. **Governança começa com mutação.**
4. **Determinismo prova fatos.**
5. **Inteligência interpreta evidência.**
6. **A intenção do owner supera metodologia.**
7. **Trabalho pequeno continua pequeno.**
8. **Trabalho durável merece memória durável.**
9. **Um estado, uma autoridade.**
10. **Falha deve ser reportada honestamente.**

## Navegação da documentação pt-BR

### Entendimento e arquitetura

- [Arquitetura](ARCHITECTURE.md)
- [Business-Driven Development](explanation/business-driven-development.md)
- [Loop Engineering orientado a evidência](explanation/loop-engineering.md)
- [Governança e enforcement](explanation/governance-and-enforcement.md)
- [Modelo de qualidade](explanation/quality-model.md)
- [Modelo de domínio e governança](explanation/domain-model.md)
- [Valor e impacto](explanation/value-and-impact.md)

### Guias

- [Anatomia de Business, Operation e Workflow](how-to/anatomy-of-business-operation-workflow.md)
- [Executar um caso Business/Operation governado](how-to/run-a-business-case.md)
- [Auditar e testar uma mudança](how-to/audit-and-test.md)
- [Executar um Workflow](how-to/run-a-workflow.md)
- [Usar o board canônico de tasks](how-to/use-the-pipeline-board.md)

### Referência

- [Glossário](reference/glossary.md)
- [Contrato de governança](reference/governance-contract.md)
- [Configuração](reference/config.md)
- [Memória](reference/memory-model.md)
- [Agentes](reference/agents.md)
- [Hosts](reference/hosts.md)
- [Grafo](reference/graph.md)

A árvore `docs/pt-BR/` espelha a documentação pública em inglês. A documentação em inglês continua sendo a fonte canônica para nomes de APIs, arquivos, comandos e identificadores de código; a versão pt-BR preserva esses identificadores e traduz explicações, orientação e exemplos.

## Licença

MIT
