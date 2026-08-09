# Modelo de qualidade

O ContextDevKit 4 separa observações de autoridade. Um warning útil pode ser heurístico; uma negação precisa ser determinística, aplicável, sustentada por evidência, atual e estar na allowlist central de bloqueio.

## Três quality floors guarded

Somente três domínios podem negar por padrão:

1. **QA sign-off** protege conclusão com evidência real de testes/runner e nunca bloqueia o início da implementação.
2. **DDD invariants** protege invariantes de negócio Classe A explícitos e aplicáveis. Opinião de classificador ou mapa de domínio inferido automaticamente não é evidência suficiente.
3. **Technical Debt** protege conclusão contra dívida nova high/critical introduzida pelo diff atual. Debt existente fora do escopo não bloqueia trabalho não relacionado.

Todo denial guarded suporta override do owner com escopo. O override registra a decisão; não finge que a evidência passou.

## Architecture Debt é canary

Qualidade arquitetural é mais ampla que um predicado determinístico de conclusão.

Architecture Debt pode analisar responsabilidades, state ownership, dependency direction, contratos públicos, security, reliability, testabilidade, operações, rollback, coesão e fragmentação.

Ela é **canary por padrão**.

Pode reportar findings, ordenar preocupações, produzir evidência e orientar o agente/especialista. Não pode virar silenciosamente um quarto domínio guarded.

Uma observação estrutural só chega ao quality floor de Technical Debt quando o diff atual introduz deterministicamente dívida nova high/critical sob o predicado daquele domínio.

## Lean Code não significa código curto

Complexidade desnecessária é preocupação de engenharia, mas métricas simplistas não viram blocker.

Observações úteis incluem:

- abstração especulativa sem segundo consumidor real;
- wrapper/pass-through que adiciona salto sem proteger fronteira;
- código morto ou inalcançável;
- feature flag concluída e esquecida;
- regra de negócio duplicada;
- otimização prematura sem hot path medido;
- fragmentação artificial que aumenta navegação sem aumentar clareza.

O objetivo é a menor estrutura que preserva comportamento e fronteiras reais.

Nomes bons, validação em boundaries, testes, error handling explícito e comentários úteis não são desperdício só porque adicionam linhas.

## Tamanho de arquivo é sinal de investigação

Quantidade de linhas nunca é veredito de qualidade por si só.

Um módulo grande e coeso pode ser saudável; um módulo pequeno pode misturar autoridades, atravessar boundaries ou esconder failure mode perigoso. Fragmentar apenas para satisfazer número também cria debt.

## Code review é responsabilidade de engenharia

Diff material deve receber review de estrutura, naming, dependency direction, SRP, state ownership, waste, error handling e decisões relevantes.

Quando o host permite, `code-reviewer` é o especialista e aparece no `/ship`. Fora do pipeline, routing é advisory; se o especialista não estiver disponível, o agente ativo executa a responsabilidade.

O subagente não é evidência de qualidade. Findings e código resultante são.

## Estados de evidência

- `passed`: evidência verificada satisfaz o check;
- `violated`: evidência demonstra violação;
- `unknown`: evidência necessária não está disponível/interpretable;
- `skipped`: check não se aplica ou provider opcional está ausente;
- `error`: evaluator falhou internamente.

`unknown`, `skipped` e `error` nunca são PASS fabricado e também não negam sem o predicado completo de um domínio guarded.

## Ratchet do diff atual

Technical Debt é ratchet, não score absoluto de limpeza.

Finding bloqueia apenas quando o diff atual introduz debt nova high/critical sob o predicado guarded.

Pagar debt é registrado positivamente. Findings antigos permanecem visíveis sem impedir trabalho não relacionado.

## Evidência nova depois da correção

Evidência pertence ao ciclo/implementação que ela avaliou.

Quando QA rejeita task de `testing` ou `done`, o novo ciclo limpa evidência stale do ciclo atual antes de a task voltar por implementação e testing.

Eventos históricos permanecem, mas PASS antigo não aprova automaticamente implementação nova.

## Profundidade adaptativa

Nem toda dimensão precisa rodar em toda mudança.

O agente seleciona profundidade relevante a partir de complexidade, risco, blast radius, contratos, peso de domínio, critical paths e outcome pedido pelo owner.

Os três guarded floors permanecem fronteira de qualidade padrão; análises canary/especialistas aprofundam confiança quando o trabalho justifica.

## Relacionados

- [Loop Engineering](loop-engineering.md)
- [Governança e enforcement](governance-and-enforcement.md)
- [Arquitetura](../ARCHITECTURE.md)
- [Auditar e testar](../how-to/audit-and-test.md)
- [Configuração](../reference/config.md)
