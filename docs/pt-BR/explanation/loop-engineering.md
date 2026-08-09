# Loop Engineering orientado a evidência

O ContextDevKit trata engenharia de software como um loop iterativo de evidência, e não como um evento único de geração.

Um agente produzir código não significa que o trabalho de engenharia terminou.

```text
implementar
   ↓
avaliar
   ↓
findings
   ↓
corrigir
   ↓
reavaliar
   ↓
evidência nova
   ↓
done
```

## Agent loop vs engineering loop

O coding host já possui seu próprio agent loop:

```text
raciocinar
  ↓
chamar tool
  ↓
observar resultado
  ↓
raciocinar novamente
```

O ContextDevKit não substitui esse loop.

O loop do ContextDevKit opera no nível do projeto:

```text
objetivo
  ↓
contexto do projeto
  ↓
implementação
  ↓
avaliação de engenharia
  ↓
evidência
  ↓
correção
  ↓
nova avaliação
  ↓
conclusão
```

Como seu estado durável pertence ao projeto, esse loop pode sobreviver a compactação de contexto, nova sessão, outro agente, outro modelo ou outro host.

## Profundidade adaptativa

O ContextDevKit não exige todos os avaliadores em todas as mudanças.

O agente ativo escolhe profundidade a partir de:

- complexidade;
- escopo;
- risco;
- contratos afetados;
- blast radius;
- peso de domínio;
- critical paths;
- instrução do owner;
- evidência disponível.

Uma mudança localizada pode precisar apenas de validação focada. Uma feature material pode precisar de testes e code review. Uma mudança crítica pode justificar QA, DDD, arquitetura, Technical Debt, security, integration/E2E e performance quando aplicável.

O owner também pode declarar explicitamente um conjunto de conclusão. Nesse caso, os checks pedidos passam a fazer parte do outcome.

## Avaliadores produzem evidência

Exemplos:

```text
QA
DDD
Technical Debt
Architecture Debt
Code Review
Security
Lean Code
Performance
Accessibility
```

Nem todos têm a mesma semântica de enforcement.

### Quality floors

Três domínios são elegíveis para `guarded` por padrão:

- QA sign-off;
- invariantes DDD Classe A aplicáveis e determinísticos;
- Technical Debt nova high/critical introduzida pelo diff atual.

### Canary

Architecture Debt, orientação de code review, routing, graph observations, economy hints, simulations e outras análises normalmente geram findings para raciocínio do agente sem negar execução.

### Shadow

Privacy/LGPD permanece observacional por padrão.

## Finding não é automaticamente stop

Um finding precisa ser interpretado no contexto.

```text
finding de Architecture Debt
        ↓
afeta esta mudança?
        │
        ├── não → reportar/continuar
        │
        └── sim
             ↓
        agente avalia
             ↓
      corrigir / aceitar / escalar
```

Canary ajuda a decidir melhor; não é dono do projeto.

## QA cria um ciclo novo de verdade

Quando QA rejeita uma task, ela pode voltar de `testing` ou `done` para um backlog novo:

```text
testing / done
      ↓
  qa-reject
      ↓
    backlog
      ↓
    working
      ↓
    testing
      ↓
 evidência nova
      ↓
     done
```

Evidência do ciclo atual é limpa quando necessário. Eventos históricos permanecem como histórico.

> Evidência anterior prova a implementação anterior. Não prova automaticamente a implementação corrigida.

Se o Workflow já estava concluído, ele pode ser reaberto como parte do novo ciclo.

## Code review no loop

Um diff material deve receber uma passagem de revisão.

Quando o host suporta delegação, o ContextDevKit pode recomendar ou invocar `code-reviewer`. O pipeline completo `/ship` contém esse estágio.

Fora dele, routing continua advisory. Se o especialista não estiver disponível, o agente ativo executa a responsabilidade.

A invariante é **ter a revisão**, não **ter o subagente**.

## Conclusão baseada em evidência

O ContextDevKit diferencia estados como:

```text
passed
violated
unknown
skipped
error
```

`unknown` não é PASS. `skipped` não é PASS. Falha do evaluator não é PASS.

Ao mesmo tempo, falha de um evaluator opcional não vira automaticamente negação da plataforma. Isso evita confiança fabricada e deadlock de governança.

Somente quality floors `guarded` configurados podem negar nos momentos documentados e com predicados determinísticos completos.

## Autoridade do owner

O owner define o outcome.

O ContextDevKit fornece quality floors, recomendações adaptativas e evidência, mas não transforma score de modelo, agente nomeado, swarm ou metodologia em ownership do projeto.

Override humano com escopo registra que o owner aceitou uma condição guarded; não altera a evidência para PASS.

## Evitando loops patológicos

Um loop saudável precisa convergir.

O agente deve detectar quando:

- o mesmo finding se repete sem progresso;
- uma correção cria regressão nova;
- falta informação externa obrigatória;
- o problema está fora do escopo;
- uma decisão realmente pertence ao owner;
- o evaluator está com defeito.

Nesse ponto, a resposta correta não é retry infinito: é reportar a evidência e escalar.

## Continuidade de loops longos

ContextDevKit preserva continuidade por:

- estado canônico de tasks;
- estado do Workflow;
- reports;
- context manifests;
- project memory;
- continuation prompts;
- output compacto;
- `run-compact`;
- task compiler;
- session/run state.

O projeto deve saber onde o trabalho parou mesmo quando o modelo já não lembra da conversa original.

## Loop completo de `/ship`

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
record evidence
  ↓
report
```

Em modo automático, evidência vermelha atribuível e dentro do escopo deve ser corrigida e reavaliada. Se não puder ser resolvida honestamente, deve ser reportada como `unresolved`, nunca escondida em PASS fabricado.

## Princípio central

> **O modelo pode propor conclusão. A evidência justifica a conclusão. O owner define o outcome.**
