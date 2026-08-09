# Governança e enforcement

O ContextDevKit 4 separa quality floors determinísticos de guidance de engenharia advisory.

Governança existe para preservar qualidade, estado, evidência e decisões sem transformar metodologia no sistema de permissão.

## Governança começa quando existe mutação

Conversa e exploração somente leitura não criam trabalho governado.

Uma mutação confirmada ativa intake, resolução de trabalho existente e superfícies de governança aplicáveis. Se houver ambiguidade, o ContextDevKit faz uma pergunta curta em vez de persistir task, Business, Operation ou Workflow adivinhado.

## Um dispatcher por evento

Os quatro momentos são:

1. `prompt-preflight`
2. `write-preflight`
3. `postflight`
4. `completion`

O dispatcher centraliza deduplicação, proteção de reentrada, budget de tempo, timeout por gate e circuit breaker.

Erros internos, evidência opcional indisponível e timeouts seguem `failurePolicy: continue`: permanecem visíveis, mas não fabricam PASS nem quebram trabalho real só porque o ContextDevKit falhou.

## Modos de enforcement

### `off`

Evaluator desabilitado.

### `shadow`

Observa sem alterar o resultado. Privacy/LGPD é shadow por padrão.

### `canary`

Avalia e reporta findings sem negar a ação.

Architecture Debt, graph-first, intake guidance, journey, workflow presence, simulation, deliberation, routing, subagent scope, economy e context loading são canary por padrão.

### `guarded`

Pode negar apenas no momento documentado e com predicado completo: determinístico, aplicável e sustentado por evidência.

## Os três quality floors padrão

| Quality floor | Momento | Condição |
| --- | --- | --- |
| `qa-signoff` | completion | conclusão possui violação/falta de evidência QA necessária |
| `ddd-invariants` | write-preflight, completion | invariante Classe A declarado e aplicável foi violado deterministicamente |
| `technical-debt` | completion | diff atual introduziu Technical Debt nova high/critical |

Eles existem para impedir que o agente declare `done` silenciosamente enquanto uma violação determinística conhecida permanece.

Não representam soberania da plataforma.

O owner pode configurar modos e aplicar override humano com escopo quando aceitar conscientemente uma condição guarded.

## Soberania do owner

O runtime padrão usa:

```text
humanAuthority: owner-wins
```

Um override válido registra ator, razão, escopo, versão/hash da política, revisão-base, timestamp, expiração e outcome.

Override **não** transforma evidência falha em evidência aprovada. Ele registra que o owner aceitou a condição.

Essa autoridade também não ultrapassa limites reais de system/platform/host.

## Architecture Debt vs Technical Debt

Architecture Debt é `canary` porque análise arquitetural é ampla e pode incluir julgamento contextual/preditivo.

Ela pode encontrar dependency direction, state ownership, boundary violations, reliability, fragmentação e outros riscos estruturais.

Esses findings podem alimentar outras decisões, mas Architecture Debt não pode se transformar silenciosamente em quarto gate guarded.

Technical Debt só chega ao quality floor guarded quando existe evidência de **dívida nova high/critical introduzida pelo diff atual**.

Debt histórica não relacionada não bloqueia trabalho atual.

## Especialistas não são receipts de autorização

Routing de modelo, `code-reviewer`, `domain-modeler`, QA specialists, security, swarms e councils são ferramentas de engenharia.

A disponibilidade deles não concede nem retira permissão para trabalhar.

Um diff material pode justificar fortemente code review, mas a invariante é a responsabilidade de revisar — não a presença de um subagente nomeado.

## Estados de evidência

Evaluators distinguem:

- `passed`;
- `violated`;
- `unknown`;
- `skipped`;
- `error`.

`unknown`, `skipped` e `error` nunca são PASS fabricado.

Também não negam execução sem o predicado determinístico completo de um dos três domínios guarded.

## Governança dentro do engineering loop

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

A maioria dos evaluators melhora esse loop produzindo evidência. Os guarded floors protegem fronteiras específicas de qualidade. Nenhum deles deve virar processo por processo.

## Princípio central

> **Governança deve tornar a engenharia mais confiável sem tornar trabalho útil mais difícil de começar.**

Veja [Loop Engineering](loop-engineering.md), [Modelo de qualidade](quality-model.md) e [Contrato de governança](../reference/governance-contract.md).
