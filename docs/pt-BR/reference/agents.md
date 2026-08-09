# Referência de agentes

ContextDevKit disponibiliza especialistas para ampliar a capacidade do agente ativo. Eles são **ferramentas de engenharia**, não uma lista obrigatória de participantes nem recibos de conclusão.

## Regra de roteamento

O routing de agentes é advisory. O agente ativo escolhe especialistas com base em escopo, risco, complexidade, domínio, blast radius e evidência disponível.

Para um diff material, `code-reviewer` é fortemente recomendado e aparece como etapa explícita do pipeline completo `/ship`. Se o host não puder criar o subagente, a responsabilidade de revisão permanece com o agente ativo.

## Famílias principais

- **devteam** — arquitetura, implementação, code review, testes e domain modeling;
- **qa-team** — orquestração de QA, unit, integration, fuzz, E2E e performance;
- **security-team** — AppSec, code-security e infra-security;
- **design-team** — UX, UI, accessibility, conversion e tracking;
- **product/ops** — product-owner, DevOps e especialistas operacionais;
- **agent-forge** — design, routing, prompts, tools, governance, evals e packaging de agentes portáveis.

## Semântica de autoridade

A presença ou ausência de um especialista nunca é, por si só, uma condição de autorização. O que importa é a responsabilidade de engenharia e a evidência produzida.

Um specialist pode retornar findings, recomendações, riscos e evidência. Apenas os domínios explicitamente elegíveis ao enforcement central podem negar, e mesmo nesses casos a política `owner-wins` e os limites reais do host continuam valendo.

## Hosts

Claude Code usa os agentes canônicos em `templates/claude/agents/`. Codex e Antigravity recebem projeções nativas geradas a partir dessas fontes; o projeto evita manter autoridades duplicadas por host.

Consulte também [Hosts](hosts.md), [Contrato de governança](governance-contract.md), [Modelo de qualidade](../explanation/quality-model.md) e o [índice de idiomas](../../LANGUAGES.md).