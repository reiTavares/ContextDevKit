# Valor e impacto

O ContextDevKit transforma contexto de projeto em estado de engenharia durável e inspecionável sem transformar cerimônia em sistema de permissão.

O valor não é apenas lembrar arquivos ou executar checks. O produto fornece um substrato de engenharia no nível do projeto que sobrevive a sessões, modelos e hosts.

## Do vibe coding à engenharia sênior

| Perfil | Valor principal |
| --- | --- |
| **Vibe coder** | guardrails, testes, revisão, evidência e memória que talvez não soubesse solicitar |
| **Desenvolvedor** | contexto estruturado, task state, reports, formas de execução e continuidade |
| **Engenheiro sênior** | alavancagem com project intelligence, especialistas e qualidade sem perder autoridade |
| **Tech Lead** | memória compartilhada, ADRs, ownership, quality policy e consistência entre sessões |
| **Time AI-native** | troca de modelos/hosts sem perder inteligência de engenharia |

> **Use engenharia suficiente para o risco e a complexidade — nem mais, nem menos.**

## O que protege

- decisões e racional sobrevivem a sessões;
- Business/Operation preservam ownership durável apenas quando útil;
- Workflows/tasks têm autoridade JSON única, revisões, dependências e evidência;
- reports preservam evidência e findings;
- hooks compartilham registry pequeno e dispatcher bounded;
- docs/projeções podem ser reconstruídos e auditados contra drift;
- migração preserva dados sem manter compatibilidade executável no runtime normal.

## Silencioso até mutação

Conversa e exploração não escrevem projeto.

Mutação real ativa intake, resolução de trabalho existente e governança aplicável. Ambiguidade gera uma pergunta curta em vez de task/Business/Operation/Workflow adivinhado.

O custo de governança não é apenas CPU: é atrito cognitivo para usuário e agente.

## BDD sem inflação de Workflow

`Business | Operation | none` responde ownership durável.

`direct | batch | workflow` responde topologia de execução.

Business não força Workflow. Operation não força Workflow. `none` é normal para trabalho ordinário.

## Loops baseados em evidência

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

QA rejection pode reabrir task para ciclo novo e limpar evidência stale. Workflow concluído pode reabrir quando feedback invalida conclusão anterior.

## Governança proporcional

A maioria dos sinais é canary/shadow.

Somente QA sign-off, invariantes DDD Classe A aplicáveis e Technical Debt nova high/critical do diff atual são guarded por padrão.

Architecture Debt permanece canary e melhora raciocínio sem virar gate oculto.

## Soberania do owner

Guardrails protegem quem não sabe quais checks pedir e permanecem configuráveis para quem sabe.

O runtime usa `humanAuthority: owner-wins` dentro da fronteira de governança. Um engenheiro pode mudar modos ou aplicar override com escopo preservando a verdade de que a evidência foi aceita — não aprovada.

## Inteligência do projeto como alavancagem

Project Map, graph, ADRs, specs, reports, preferences e Workflow context reduzem redescoberta em cada nova sessão.

Graph-first é otimização, não restrição. Dados incompletos fazem fallback imediato para busca normal.

## Economia de agentes/modelos

Specialists, swarm, compact context, `run-compact`, task compiler e model recommendations são ferramentas para qualidade, tempo e tokens. Não concedem permissão apenas por existir.

## Trade-offs

O kit adiciona schemas, revisões explícitas, migração e evidência de release. Isso vale a pena para projetos com decisões consequenciais, múltiplas sessões, paralelismo ou desenvolvimento AI-assisted de longa duração.

Mudanças pequenas permanecem pequenas.

## Proposta central

> **ContextDevKit dá guardrails de engenharia aos iniciantes e alavancagem aos especialistas sem tornar nenhum deles subordinado à metodologia.**
